/**
 * ===================================================
 * CENTRALIZED ERROR HANDLING
 * ===================================================
 * All application errors extend AppError.
 * The global Fastify error handler (registered in main.ts)
 * converts them to consistent JSON responses.
 */

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'trial_expired'
  | 'owner_only'
  | 'not_assignee'
  | 'internal_error'
  | 'ai_error';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ── Convenience constructors ────────────────────────────────────────

export const Errors = {
  unauthorized: (msg = 'unauthorized') =>
    new AppError('unauthorized', 401, msg),

  forbidden: (msg = 'forbidden') =>
    new AppError('forbidden', 403, msg),

  ownerOnly: () =>
    new AppError('owner_only', 403, 'Only the project owner can do this'),

  notAssignee: () =>
    new AppError('not_assignee', 403, 'Only the task assignee can do this'),

  notFound: (entity = 'Resource') =>
    new AppError('not_found', 404, `${entity} not found`),

  conflict: (msg: string) =>
    new AppError('conflict', 409, msg),

  gone: (msg: string) =>
    new AppError('gone', 410, msg),

  trialExpired: () =>
    new AppError('trial_expired', 402, 'Trial period has expired. Please upgrade.'),

  validation: (msg: string, details?: unknown) =>
    new AppError('validation_error', 422, msg, details),

  internal: (msg = 'internal_error') =>
    new AppError('internal_error', 500, msg),

  aiError: (msg: string) =>
    new AppError('ai_error', 502, msg),
};

// ── Fastify error handler ───────────────────────────────────────────

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logEvent } from './events.js';

export async function globalErrorHandler(
  err: FastifyError | AppError | ZodError | Error,
  req: FastifyRequest & { auth?: { user?: { id?: string } } },
  reply: FastifyReply
) {
  // Zod validation errors → 422
  if (err instanceof ZodError) {
    return reply.code(422).send({
      ok: false,
      code: 'validation_error',
      error: 'Invalid request data',
      details: err.flatten().fieldErrors
    });
  }

  // Our domain errors
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      req.log.error({ err, url: req.url }, err.message);
    }
    return reply.code(err.httpStatus).send({
      ok: false,
      code: err.code,
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {})
    });
  }

  // Fastify built-in errors (e.g. 404 from route not found)
  const status = (err as FastifyError).statusCode ?? 500;
  if (status < 500) {
    return reply.code(status).send({
      ok: false,
      code: 'request_error',
      error: err.message
    });
  }

  // Unexpected errors
  req.log.error({ err, url: req.url }, 'Unhandled error');

  try {
    await logEvent({
      event_name: 'error_api',
      user_id: req.auth?.user?.id ?? null,
      props: { route: req.url, message: err.message, stack: err.stack?.slice(0, 500) }
    });
  } catch {
    // never throw inside error handler
  }

  return reply.code(500).send({
    ok: false,
    code: 'internal_error',
    error: 'Something went wrong. Please try again.'
  });
}
