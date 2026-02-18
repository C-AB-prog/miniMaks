import { FastifyInstance } from 'fastify';
import { getSubscription } from '../lib/subscription.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (req: any) => {
    return {
      ok: true,
      user: {
        id: req.auth.user.id,
        tg_id: req.auth.user.tg_id.toString(),
        username: req.auth.user.username,
        first_name: req.auth.user.first_name,
        last_name: req.auth.user.last_name
      }
    };
  });

  app.get('/me/subscription', async (req: any) => {
    const sub = await getSubscription(req.auth.user.id);
    return { ok: true, subscription: sub };
  });
}
