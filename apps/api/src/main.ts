import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './lib/env.js';
import { authenticate } from './lib/auth.js';
import { meRoutes } from './routes/me.js';
import { focusRoutes } from './routes/focuses.js';
import { taskRoutes } from './routes/tasks.js';
import { assistantRoutes } from './routes/assistant.js';
import { inviteRoutes } from './routes/invites.js';
import { buildBot } from './bot/admin.js';
import { logEvent } from './lib/events.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.WEB_ORIGIN,
  credentials: true
});

// auth hook
app.addHook('preHandler', async (req: any, reply) => {
  // Public endpoints
  if (req.routeOptions.url?.startsWith('/health')) return;
  if (req.routeOptions.url?.startsWith('/bot/webhook')) return;

  const auth = await authenticate(req);
  if (!auth) return reply.code(401).send({ ok: false, error: 'unauthorized' });
  req.auth = auth;

  // first_open event (once per day per user would be ideal; keeping simple)
  await logEvent({ event_name: 'first_open', user_id: auth.user.id });
});

app.get('/health', async () => ({ ok: true }));

await meRoutes(app);
await focusRoutes(app);
await inviteRoutes(app);
await taskRoutes(app);
await assistantRoutes(app);

// basic error logging
app.setErrorHandler(async (err, req: any, reply) => {
  app.log.error(err);

  // ✅ FIX: err может быть unknown, поэтому message берём безопасно
  const message = err instanceof Error ? err.message : String(err);

  try {
    await logEvent({
      event_name: 'error_api',
      user_id: req?.auth?.user?.id ?? null,
      props: { route: req?.routeOptions?.url, message }
    });
  } catch {
    // ignore
  }

  reply.code(500).send({ ok: false, error: 'internal_error' });
});

// Bot webhook
const bot = buildBot();
app.post('/bot/webhook', async (req: any, reply) => {
  const secret = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return reply.code(401).send({ ok: false });
  }
  await bot.handleUpdate(req.body);
  reply.send({ ok: true });
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });
app.log.info(`API listening on :${env.PORT}`);
