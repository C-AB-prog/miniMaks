import { FastifyRequest } from 'fastify';
import { env } from './env.js';
import { verifyTelegramInitData, extractTelegramUser } from '@ba/shared';
import { prisma } from './db.js';

export type AuthContext = {
  user: { id: string; tg_id: bigint; username?: string | null; first_name?: string | null; last_name?: string | null };
};

export async function authenticate(req: FastifyRequest): Promise<AuthContext | null> {
  const devTgId = req.headers['x-dev-tg-id'];
  if (env.NODE_ENV !== 'production' && devTgId) {
    const tgIdNum = Number(devTgId);
    if (Number.isFinite(tgIdNum)) {
      return { user: await upsertUser(BigInt(tgIdNum), {}) };
    }
  }

  const initData = String(req.headers['x-telegram-init-data'] ?? '');
  const v = verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok || !v.data) return null;

  const tgUser = extractTelegramUser(v.data);
  if (!tgUser) return null;

  const user = await upsertUser(BigInt(tgUser.id), {
    username: tgUser.username ?? null,
    first_name: tgUser.first_name ?? null,
    last_name: tgUser.last_name ?? null
  });

  return { user };
}

async function upsertUser(tgId: bigint, profile: { username?: string | null; first_name?: string | null; last_name?: string | null }) {
  const u = await prisma.user.upsert({
    where: { tg_id: tgId },
    create: {
      tg_id: tgId,
      username: profile.username,
      first_name: profile.first_name,
      last_name: profile.last_name
    },
    update: {
      username: profile.username,
      first_name: profile.first_name,
      last_name: profile.last_name,
      last_seen_at: new Date()
    }
  });
  return u;
}
