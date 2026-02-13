import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

export const NOTIFICATION_QUEUE = 'notifications';

new Worker(
  NOTIFICATION_QUEUE,
  async (job) => {
    const { tg_id, text, type, user_id } = job.data as any;
    try {
      // ✅ FIX: Telegram Bot API теперь использует link_preview_options
      // Telegraf типы могут ругаться — поэтому cast as any, но API реально работает.
      await bot.telegram.sendMessage(
        Number(tg_id),
        text,
        { link_preview_options: { is_disabled: true } } as any
      );

      if (user_id) {
        await prisma.notificationLog.updateMany({
          where: { user_id, status: 'queued', type },
          data: { status: 'sent', sent_at: new Date() }
        });
      }
      return { ok: true };
    } catch (e: any) {
      if (user_id) {
        await prisma.notificationLog.updateMany({
          where: { user_id, status: 'queued', type },
          data: { status: 'failed', error: String(e?.message ?? e) }
        });
      }
      throw e;
    }
  },
  { connection: redis }
);

console.log('Worker started. Queue:', NOTIFICATION_QUEUE);

// Example: schedule jobs can be added later from API with BullMQ delayed jobs.
