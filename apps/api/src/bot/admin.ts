import { Telegraf, Markup } from 'telegraf';
import { env } from '../lib/env.js';
import { prisma } from '../lib/db.js';

function isAdmin(tgId: number) {
  return env.ADMIN_TG_IDS.includes(String(tgId));
}

type Filters = { period: 'today' | '7d' | '30d'; segment: 'all' | 'trial' | 'expired'; };
const session = new Map<number, Filters>();

function getFilters(tgId: number): Filters {
  return session.get(tgId) ?? { period: '7d', segment: 'all' };
}

async function calcOverview(filters: Filters) {
  const now = new Date();
  const start = new Date(now);
  if (filters.period === 'today') {
    start.setHours(0,0,0,0);
  } else if (filters.period === '7d') {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }

  const [users, focuses, tasks, aiMsgs, errors, trialStarted, trialExpired] = await Promise.all([
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'first_open' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'create_focus' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'create_task' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'ai_message_sent' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'error_api' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'trial_started' } }),
    prisma.eventLog.count({ where: { ts: { gte: start }, event_name: 'trial_expired' } })
  ]);

  return { start, users, focuses, tasks, aiMsgs, errors, trialStarted, trialExpired };
}

function panelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Overview', 'adm:tab=overview'), Markup.button.callback('👤 Users', 'adm:tab=users'), Markup.button.callback('🎯 Focuses', 'adm:tab=focuses')],
    [Markup.button.callback('🤖 AI', 'adm:tab=ai'), Markup.button.callback('🔔 Notifs', 'adm:tab=notifs'), Markup.button.callback('💳 Trial', 'adm:tab=trial')],
    [Markup.button.callback('🧪 Funnel', 'adm:tab=funnel'), Markup.button.callback('📈 Retention', 'adm:tab=retention'), Markup.button.callback('⚙️ Settings', 'adm:tab=settings')],
    [Markup.button.callback('⏱ Period', 'adm:period'), Markup.button.callback('🧩 Segment', 'adm:segment'), Markup.button.callback('🔄 Refresh', 'adm:refresh')]
  ]);
}

async function renderOverview(tgId: number) {
  const f = getFilters(tgId);
  const o = await calcOverview(f);
  return `🛠 Admin Console\n\nFilters: ⏱ ${f.period} | 🧩 ${f.segment}\nFrom: ${o.start.toISOString().slice(0,10)}\n\n📌 Key metrics\n• first_open: ${o.users}\n• focuses created: ${o.focuses}\n• tasks created: ${o.tasks}\n• AI messages: ${o.aiMsgs}\n• errors: ${o.errors}\n\n💳 Trial\n• started: ${o.trialStarted}\n• expired: ${o.trialExpired}`;
}

async function renderUsers(tgId: number) {
  const f = getFilters(tgId);
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (f.period === '30d' ? 30 : f.period === '7d' ? 7 : 1));

  const users = await prisma.user.findMany({
    orderBy: { last_seen_at: 'desc' },
    take: 10,
    include: { subscription: true, _count: { select: { focus_members: true, tasks_created: true } } }
  });

  const lines = users.map(u => {
    const sub = u.subscription?.status ?? 'none';
    return `• ${u.username ?? u.first_name ?? u.tg_id.toString()} | sub=${sub} | focuses=${u._count.focus_members} | tasks_created=${u._count.tasks_created}`;
  });

  return `👤 Users (top 10 by last seen)\nFilters: ⏱ ${f.period} | 🧩 ${f.segment}\n\n${lines.join('\n')}`;
}

async function renderFocuses(tgId: number) {
  const focuses = await prisma.focus.findMany({ orderBy: { updated_at: 'desc' }, take: 10, include: { _count: { select: { tasks: true, members: true } } } });
  const lines = focuses.map(f => `• ${f.title} | ${f.status} | members=${f._count.members} | tasks=${f._count.tasks}`);
  return `🎯 Focuses (top 10 by recent)\n\n${lines.join('\n')}`;
}

export function buildBot() {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.command('admin', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId || !isAdmin(tgId)) return ctx.reply('Access denied');
    const text = await renderOverview(tgId);
    await ctx.reply(text, panelKeyboard());
  });

  bot.on('callback_query', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId || !isAdmin(tgId)) return ctx.answerCbQuery('Access denied', { show_alert: true });
    const data = String((ctx.callbackQuery as any).data ?? '');

    if (data === 'adm:period') {
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        [Markup.button.callback('Today', 'adm:set_period=today'), Markup.button.callback('7d', 'adm:set_period=7d'), Markup.button.callback('30d', 'adm:set_period=30d')],
        [Markup.button.callback('⬅️ Back', 'adm:refresh')]
      ]).reply_markup);
      return ctx.answerCbQuery();
    }

    if (data.startsWith('adm:set_period=')) {
      const period = data.split('=')[1] as any;
      session.set(tgId, { ...getFilters(tgId), period });
      const text = await renderOverview(tgId);
      await ctx.editMessageText(text, panelKeyboard());
      return ctx.answerCbQuery('Updated');
    }

    if (data === 'adm:segment') {
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        [Markup.button.callback('All', 'adm:set_segment=all'), Markup.button.callback('Trial', 'adm:set_segment=trial'), Markup.button.callback('Expired', 'adm:set_segment=expired')],
        [Markup.button.callback('⬅️ Back', 'adm:refresh')]
      ]).reply_markup);
      return ctx.answerCbQuery();
    }

    if (data.startsWith('adm:set_segment=')) {
      const segment = data.split('=')[1] as any;
      session.set(tgId, { ...getFilters(tgId), segment });
      const text = await renderOverview(tgId);
      await ctx.editMessageText(text, panelKeyboard());
      return ctx.answerCbQuery('Updated');
    }

    if (data === 'adm:refresh' || data === 'adm:tab=overview') {
      const text = await renderOverview(tgId);
      await ctx.editMessageText(text, panelKeyboard());
      return ctx.answerCbQuery();
    }

    if (data === 'adm:tab=users') {
      const text = await renderUsers(tgId);
      await ctx.editMessageText(text, panelKeyboard());
      return ctx.answerCbQuery();
    }

    if (data === 'adm:tab=focuses') {
      const text = await renderFocuses(tgId);
      await ctx.editMessageText(text, panelKeyboard());
      return ctx.answerCbQuery();
    }

    // Placeholders
    if (data.startsWith('adm:tab=')) {
      await ctx.answerCbQuery('v2: coming soon');
      return;
    }

    return ctx.answerCbQuery();
  });

  return bot;
}
