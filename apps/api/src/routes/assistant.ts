import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { isActive } from '../lib/subscription.js';
import { logEvent } from '../lib/events.js';
import { callBusinessAssistant } from '../lib/openai.js';

const sendMessageSchema = z.object({
  content: z.string().min(1)
});

const planToTasksSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    priority: z.enum(['low','medium','high','urgent']).optional(),
    status: z.enum(['todo','in_progress','done','canceled']).optional(),
    due_at: z.string().datetime().optional().nullable(),
    assigned_to_user_id: z.string().uuid().optional().nullable(),
    subtasks: z.array(z.object({ title: z.string().min(1) })).optional()
  }))
});

export async function assistantRoutes(app: FastifyInstance) {
  app.get('/focuses/:id/assistant/thread', async (req: any, reply) => {
    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } } });
    if (!member) return reply.code(403).send({ ok: false, error: 'forbidden' });
    const thread = await prisma.assistantThread.findFirst({ where: { focus_id: focusId }, orderBy: { created_at: 'asc' } });
    if (!thread) return { ok: true, thread: null, messages: [] };
    const messages = await prisma.assistantMessage.findMany({ where: { thread_id: thread.id }, orderBy: { created_at: 'asc' } });
    return { ok: true, thread, messages };
  });

  app.post('/focuses/:id/assistant/message', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) return reply.code(402).send({ ok: false, error: 'trial_expired' });

    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } } });
    if (!member) return reply.code(403).send({ ok: false, error: 'forbidden' });

    const body = sendMessageSchema.parse(req.body);
    const thread = await prisma.assistantThread.findFirst({ where: { focus_id: focusId }, orderBy: { created_at: 'asc' } });
    if (!thread) return reply.code(500).send({ ok: false, error: 'missing_thread' });

    await prisma.assistantMessage.create({ data: { thread_id: thread.id, role: 'user', content: body.content } });
    await logEvent({ event_name: 'ai_message_sent', user_id: req.auth.user.id, focus_id: focusId });

    // Собираем контекст: проект + последние сообщения
    const focus = await prisma.focus.findUnique({ where: { id: focusId } });
    const last = await prisma.assistantMessage.findMany({
      where: { thread_id: thread.id },
      orderBy: { created_at: 'desc' },
      take: 16
    });

    const history = last
      .reverse()
      .map((m) => ({ role: m.role as any, content: m.content }));

    const contextPreamble = `Контекст проекта (используй только это, не придумывай):\n` +
      `Название: ${focus?.title ?? ''}\n` +
      `Описание: ${focus?.description ?? ''}\n` +
      `Стадия: ${focus?.stage ?? ''}\n` +
      `Дедлайн проекта: ${focus?.deadline_at ? new Date(focus.deadline_at).toISOString().slice(0, 10) : 'не указан'}\n` +
      `Роль пользователя: ${member.role}`;

    const ai = await callBusinessAssistant([
      { role: 'user', content: contextPreamble },
      ...history
    ]);

    const meta: any = {
      kind: 'ai_response',
      suggested_tasks: ai.tasks ?? [],
      followup_questions: ai.followup_questions ?? []
    };

    const msg = await prisma.assistantMessage.create({
      data: { thread_id: thread.id, role: 'assistant', content: ai.reply, meta }
    });

    await logEvent({ event_name: 'ai_message_received', user_id: req.auth.user.id, focus_id: focusId, props: { has_tasks: (ai.tasks?.length ?? 0) > 0 } });

    return { ok: true, message: msg };
  });

  app.post('/focuses/:id/assistant/plan_to_tasks', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) return reply.code(402).send({ ok: false, error: 'trial_expired' });

    const focusId = String(req.params.id);
    const member = await prisma.focusMember.findUnique({ where: { focus_id_user_id: { focus_id: focusId, user_id: req.auth.user.id } } });
    if (!member) return reply.code(403).send({ ok: false, error: 'forbidden' });
    if (member.role !== 'owner') return reply.code(403).send({ ok: false, error: 'owner_only' });

    const body = planToTasksSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const tasks = [] as any[];
      for (const t of body.tasks) {
        const task = await tx.task.create({
          data: {
            focus_id: focusId,
            created_by_user_id: req.auth.user.id,
            title: t.title,
            description: t.description ?? null,
            priority: t.priority ?? 'medium',
            status: t.status ?? 'todo',
            due_at: t.due_at ? new Date(t.due_at) : null,
            assigned_to_user_id: t.assigned_to_user_id ?? null
          }
        });
        if (t.subtasks?.length) {
          await tx.subTask.createMany({
            data: t.subtasks.map(st => ({ task_id: task.id, title: st.title }))
          });
        }
        tasks.push(task);
      }
      return tasks;
    });

    await logEvent({ event_name: 'bulk_tasks_created', user_id: req.auth.user.id, focus_id: focusId, props: { count: created.length } });
    return { ok: true, tasks: created };
  });
}
