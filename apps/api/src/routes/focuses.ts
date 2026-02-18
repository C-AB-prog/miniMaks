import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { ensureTrialStarted, isActive } from '../lib/subscription.js';
import { logEvent } from '../lib/events.js';
import { Errors } from '../lib/errors.js';

const createFocusSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  deadline_at: z.string().datetime().optional().nullable(),
  success_metric: z.string().optional().nullable(),
  budget: z.number().optional().nullable(),
  niche: z.string().optional().nullable()
});

const patchFocusSchema = createFocusSchema.partial().extend({
  status: z.enum(['active', 'paused', 'archived']).optional()
});

export async function focusRoutes(app: FastifyInstance) {
  app.get('/focuses', async (req: any) => {
    const userId = req.auth.user.id;
    const memberships = await prisma.focusMember.findMany({
      where: { user_id: userId },
      include: {
        focus: { include: { _count: { select: { tasks: true, members: true } } } }
      },
      orderBy: { focus: { updated_at: 'desc' } }
    });
    return { ok: true, focuses: memberships.map(m => ({ ...m.focus, role: m.role })) };
  });

  app.post('/focuses', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) throw Errors.trialExpired();
    const body = createFocusSchema.parse(req.body);
    await ensureTrialStarted(req.auth.user.id);
    const focus = await prisma.focus.create({
      data: {
        owner_user_id: req.auth.user.id,
        title: body.title,
        description: body.description ?? null,
        stage: body.stage ?? null,
        deadline_at: body.deadline_at ? new Date(body.deadline_at) : null,
        success_metric: body.success_metric ?? null,
        budget: body.budget ?? null,
        niche: body.niche ?? null,
        members: { create: { user_id: req.auth.user.id, role: 'owner' } },
        assistant_threads: { create: {} }
      },
      include: { _count: { select: { tasks: true, members: true } } }
    });
    await logEvent({ event_name: 'create_focus', user_id: req.auth.user.id, focus_id: focus.id });
    return reply.code(201).send({ ok: true, focus });
  });

  app.get('/focuses/:id', async (req: any) => {
    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({
      where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } }
    });
    if (!member) throw Errors.forbidden();
    const focus = await prisma.focus.findUnique({
      where: { id: focusId },
      include: {
        members: { include: { user: { select: { id: true, tg_id: true, username: true, first_name: true, last_name: true } } } },
        kpis: true,
        _count: { select: { tasks: true } }
      }
    });
    if (!focus) throw Errors.notFound('Focus');
    return { ok: true, focus, role: member.role };
  });

  app.patch('/focuses/:id', async (req: any) => {
    const active = await isActive(req.auth.user.id);
    if (!active) throw Errors.trialExpired();
    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({
      where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } }
    });
    if (!member) throw Errors.forbidden();
    if (member.role !== 'owner') throw Errors.ownerOnly();
    const body = patchFocusSchema.parse(req.body);
    const focus = await prisma.focus.update({
      where: { id: focusId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.stage !== undefined && { stage: body.stage }),
        ...(body.deadline_at !== undefined && { deadline_at: body.deadline_at ? new Date(body.deadline_at) : null }),
        ...(body.success_metric !== undefined && { success_metric: body.success_metric }),
        ...(body.budget !== undefined && { budget: body.budget }),
        ...(body.niche !== undefined && { niche: body.niche }),
        ...(body.status !== undefined && { status: body.status })
      }
    });
    await logEvent({ event_name: 'update_focus', user_id: req.auth.user.id, focus_id: focus.id });
    return { ok: true, focus };
  });

  app.delete('/focuses/:id', async (req: any) => {
    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({
      where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } }
    });
    if (!member) throw Errors.forbidden();
    if (member.role !== 'owner') throw Errors.ownerOnly();
    await prisma.focus.delete({ where: { id: focusId } });
    await logEvent({ event_name: 'delete_focus', user_id: req.auth.user.id, focus_id: focusId });
    return { ok: true };
  });
}
