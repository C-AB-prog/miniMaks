import { prisma } from './db.js';

export async function getSubscription(userId: string) {
  return prisma.subscription.findUnique({ where: { user_id: userId } });
}

export async function ensureTrialStarted(userId: string) {
  const existing = await prisma.subscription.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  const started = new Date();
  const expires = new Date(started.getTime() + 7 * 24 * 60 * 60 * 1000);
  return prisma.subscription.create({
    data: {
      user_id: userId,
      trial_started_at: started,
      trial_expires_at: expires,
      status: 'trial_active'
    }
  });
}

export async function isActive(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { user_id: userId } });
  if (!sub) return true; // allow until trial starts
  if (sub.status === 'paid') return true;
  if (sub.status === 'trial_active') {
    if (sub.trial_expires_at.getTime() > Date.now()) return true;
    await prisma.subscription.update({ where: { user_id: userId }, data: { status: 'trial_expired' } });
    return false;
  }
  return false;
}
