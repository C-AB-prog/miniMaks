import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import crypto from 'node:crypto';
import { isActive } from '../lib/subscription.js';

const createInviteSchema = z.object({
  expires_at: z.string().datetime().optional().nullable(),
  max_uses: z.number().int().positive().optional().nullable()
});

function makeCode() {
  return crypto.randomBytes(4).toString('hex');
}

export async function inviteRoutes(app: FastifyInstance) {
  app.post('/focuses/:id/invites', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) return reply.code(402).send({ ok: false, error: 'trial_expired' });

    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } } });
    if (!member || member.role !== 'owner') return reply.code(403).send({ ok: false, error: 'owner_only' });

    const body = createInviteSchema.parse(req.body ?? {});
    const invite = await prisma.focusInvite.create({
      data: {
        focus_id: focusId,
        code: makeCode(),
        created_by_user_id: req.auth.user.id,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
        max_uses: body.max_uses ?? null
      }
    });
    return { ok: true, invite };
  });

  app.post('/invites/:code/join', async (req: any, reply) => {
    const code = String(req.params.code);
    const invite = await prisma.focusInvite.findUnique({ where: { code } });
    if (!invite) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (invite.expires_at && invite.expires_at.getTime() < Date.now()) return reply.code(410).send({ ok: false, error: 'expired' });
    if (invite.max_uses && invite.uses_count >= invite.max_uses) return reply.code(409).send({ ok: false, error: 'max_uses' });

    await prisma.$transaction(async (tx) => {
      await tx.focusMember.upsert({
        where: { focus_id_user_id: { focus_id: invite.focus_id, user_id: req.auth.user.id } },
        create: { focus_id: invite.focus_id, user_id: req.auth.user.id, role: 'member' },
        update: {}
      });
      await tx.focusInvite.update({ where: { id: invite.id }, data: { uses_count: { increment: 1 } } });
    });

    return { ok: true, focus_id: invite.focus_id };
  });

  app.get('/focuses/:id/members', async (req: any, reply) => {
    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } } });
    if (!member) return reply.code(403).send({ ok: false, error: 'forbidden' });

    const members = await prisma.focusMember.findMany({ where: { focus_id: focusId }, include: { user: true } });
    return {
      ok: true,
      members: members.map(m => ({
        user_id: m.user_id,
        role: m.role,
        username: m.user.username,
        first_name: m.user.first_name,
        last_name: m.user.last_name
      }))
    };
  });
}
