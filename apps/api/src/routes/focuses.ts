import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { ensureTrialStarted, isActive } from '../lib/subscription.js';
import { logEvent } from '../lib/events.js';

const createFocusSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  deadline_at: z.string().datetime().optional().nullable(),
  success_metric: z.string().optional().nullable(),
  budget: z.number().optional().nullable(),
  niche: z.string().optional().nullable()
});

export async function focusRoutes(app: FastifyInstance) {
  app.get('/focuses', async (req: any) => {
    const userId = req.auth.user.id;
    const memberships = await prisma.focusMember.findMany({
      where: { user_id: userId },
      include: { focus: true }
    });
    return { ok: true, focuses: memberships.map(m => ({ ...m.focus, role: m.role })) };
  });

  app.post('/focuses', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) return reply.code(402).send({ ok: false, error: 'trial_expired' });

    const body = createFocusSchema.parse(req.body);
    // Start trial on first focus creation
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
        members: {
          create: { user_id: req.auth.user.id, role: 'owner' }
        },
        assistant_threads: {
          create: {}
        }
      }
    });

    await logEvent({ event_name: 'create_focus', user_id: req.auth.user.id, focus_id: focus.id });
    return { ok: true, focus };
  });

  app.get('/focuses/:id', async (req: any, reply) => {
    const focusId = String(req.params.id);
    const userId = req.auth.user.id;
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: userId } } });
    if (!member) return reply.code(403).send({ ok: false, error: 'forbidden' });
    const focus = await prisma.focus.findUnique({ where: { id: focusId } });
    return { ok: true, focus, role: member.role };
  });
}
