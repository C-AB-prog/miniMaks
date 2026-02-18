import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DEADLINE_DAYS = Number(process.env.DEADLINE_REMINDER_DAYS ?? 1); // remind N days before

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

export const NOTIFICATION_QUEUE = 'notifications';

// ── Notification Worker ───────────────────────────────────────────
new Worker(
  NOTIFICATION_QUEUE,
  async (job) => {
    const { tg_id, text, type, user_id } = job.data as any;
    try {
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
      console.log(`[worker] Sent notification type=${type} to tg_id=${tg_id}`);
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

// ── Deadline Reminder Cron (runs every day at 9:00 AM UTC) ────────
cron.schedule('0 9 * * *', async () => {
  console.log('[cron] Running deadline reminder job...');

  const windowStart = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + DEADLINE_DAYS + 1);
  windowStart.setDate(windowStart.getDate() + DEADLINE_DAYS - 1);

  // Find tasks with deadlines coming up soon
  const tasks = await prisma.task.findMany({
    where: {
      due_at: { gte: windowStart, lte: windowEnd },
      status: { notIn: ['done', 'canceled'] },
      assigned_to: { isNot: null }
    },
    include: {
      assigned_to: true,
      focus: { select: { title: true } }
    }
  });

  console.log(`[cron] Found ${tasks.length} tasks with upcoming deadlines`);

  for (const task of tasks) {
    const user = task.assigned_to!;
    if (!user.tg_id) continue;

    const dueDate = task.due_at!.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const text = `⏰ *Напоминание о дедлайне*\n\nЗадача: *${task.title}*\nПроект: ${task.focus.title}\nДедлайн: ${dueDate}\n\nНе забудь выполнить задачу вовремя!`;

    try {
      // Log notification
      const log = await prisma.notificationLog.create({
        data: {
          user_id: user.id,
          type: 'deadline_reminder',
          payload: { task_id: task.id, due_at: task.due_at },
          status: 'queued'
        }
      });

      // Send via Telegram
      await bot.telegram.sendMessage(Number(user.tg_id), text, { parse_mode: 'Markdown' });

      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent', sent_at: new Date() }
      });
    } catch (e: any) {
      console.error(`[cron] Failed to send reminder to user ${user.id}:`, e?.message);
    }
  }

  console.log('[cron] Deadline reminder job complete.');
});

// ── Overdue task cron (runs every day at 10:00 AM UTC) ───────────
cron.schedule('0 10 * * *', async () => {
  console.log('[cron] Running overdue task check...');

  const tasks = await prisma.task.findMany({
    where: {
      due_at: { lt: new Date() },
      status: { notIn: ['done', 'canceled'] },
      assigned_to: { isNot: null }
    },
    include: {
      assigned_to: true,
      focus: { select: { title: true } }
    }
  });

  for (const task of tasks) {
    const user = task.assigned_to!;
    if (!user.tg_id) continue;

    const text = `🚨 *Просроченная задача*\n\nЗадача: *${task.title}*\nПроект: ${task.focus.title}\n\nСрок выполнения уже прошёл. Пожалуйста, обнови статус задачи.`;

    try {
      await bot.telegram.sendMessage(Number(user.tg_id), text, { parse_mode: 'Markdown' });
    } catch (e: any) {
      console.error(`[cron] Failed to notify user ${user.id} about overdue task:`, e?.message);
    }
  }
});

console.log('✅ Worker started. Queue:', NOTIFICATION_QUEUE);
