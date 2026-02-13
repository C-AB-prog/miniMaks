import { Queue } from 'bullmq';
import { env } from './env.js';
import { redis } from './redis.js';

export const notificationQueue = new Queue('notifications', {
  connection: redis,
  defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } }
});

export type NotifyJob = {
  userTgId: string;
  type: string;
  text: string;
  payload?: unknown;
};

export async function enqueueNotify(job: NotifyJob, opts?: { delayMs?: number; priority?: number }) {
  await notificationQueue.add('send', job, {
    delay: opts?.delayMs,
    priority: opts?.priority
  });
}
