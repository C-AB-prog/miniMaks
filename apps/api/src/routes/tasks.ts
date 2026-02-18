import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { isActive } from '../lib/subscription.js';
import { logEvent } from '../lib/events.js';
import { Errors } from '../lib/errors.js';

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(['low','medium','high','urgent']).optional(),
  status: z.enum(['todo','in_progress','done','canceled']).optional(),
  due_at: z.string().datetime().optional().nullable(),
  assigned_to_user_id: z.string().uuid().optional().nullable()
});

const patchTaskSchema = createTaskSchema.partial();

async function assertMember(focusId: string, userId: string) {
  return prisma.focusMember.findUnique({
    where: { focus_id_user_id: { focus_id: focusId, user_id: userId } }
  });
}

export async function taskRoutes(app: FastifyInstance) {
  // GET /focuses/:id/tasks
  app.get('/focuses/:id/tasks', async (req: any) => {
    const focusId = String(req.params.id);
    const member = await assertMember(focusId, req.auth.user.id);
    if (!member) throw Errors.forbidden();
    const q = req.query ?? {};
    const where: any = { focus_id: focusId };
    if (q.assigned !== 'all') where.assigned_to_user_id = req.auth.user.id;
    if (q.status) where.status = q.status;
    if (q.priority) where.priority = q.priority;
    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
      include: {
        subtasks: true,
        comments: { include: { author: { select: { id: true, username: true, first_name: true } } } }
      }
    });
    return { ok: true, tasks };
  });

  // POST /focuses/:id/tasks
  app.post('/focuses/:id/tasks', async (req: any, reply) => {
    const active = await isActive(req.auth.user.id);
    if (!active) throw Errors.trialExpired();
    const focusId = String(req.params.id);
    const member = await assertMember(focusId, req.auth.user.id);
    if (!member) throw Errors.forbidden();
    if (member.role !== 'owner') throw Errors.ownerOnly();
    const body = createTaskSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        focus_id: focusId,
        created_by_user_id: req.auth.user.id,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority ?? 'medium',
        status: body.status ?? 'todo',
        due_at: body.due_at ? new Date(body.due_at) : null,
        assigned_to_user_id: body.assigned_to_user_id ?? null
      },
      include: { subtasks: true }
    });
    await logEvent({ event_name: 'create_task', user_id: req.auth.user.id, focus_id: focusId, props: { task_id: task.id } });
    return reply.code(201).send({ ok: true, task });
  });

  // PATCH /tasks/:id
  app.patch('/tasks/:id', async (req: any) => {
    const active = await isActive(req.auth.user.id);
    if (!active) throw Errors.trialExpired();
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw Errors.notFound('Task');
    const member = await assertMember(task.focus_id, req.auth.user.id);
    if (!member) throw Errors.forbidden();
    const body = patchTaskSchema.parse(req.body);

    // Members can only update limited fields on their own tasks
    if (member.role !== 'owner') {
      if (task.assigned_to_user_id !== req.auth.user.id) throw Errors.notAssignee();
      const updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          ...(body.status && { status: body.status, completed_at: body.status === 'done' ? new Date() : null }),
          ...(body.due_at !== undefined && { due_at: body.due_at ? new Date(body.due_at) : null }),
          ...(body.description !== undefined && { description: body.description })
        }
      });
      return { ok: true, task: updated };
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.status !== undefined && { status: body.status, completed_at: body.status === 'done' ? new Date() : null }),
        ...(body.due_at !== undefined && { due_at: body.due_at ? new Date(body.due_at) : null }),
        ...(body.assigned_to_user_id !== undefined && { assigned_to_user_id: body.assigned_to_user_id })
      },
      include: { subtasks: true }
    });

    await logEvent({ event_name: 'update_task', user_id: req.auth.user.id, focus_id: task.focus_id, props: { task_id: task.id } });
    return { ok: true, task: updated };
  });

  // DELETE /tasks/:id
  app.delete('/tasks/:id', async (req: any) => {
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw Errors.notFound('Task');
    const member = await assertMember(task.focus_id, req.auth.user.id);
    if (!member) throw Errors.forbidden();
    if (member.role !== 'owner') throw Errors.ownerOnly();
    await prisma.task.delete({ where: { id: taskId } });
    await logEvent({ event_name: 'delete_task', user_id: req.auth.user.id, focus_id: task.focus_id, props: { task_id: task.id } });
    return { ok: true };
  });

  // POST /tasks/:id/comments
  app.post('/tasks/:id/comments', async (req: any, reply) => {
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw Errors.notFound('Task');
    const member = await assertMember(task.focus_id, req.auth.user.id);
    if (!member) throw Errors.forbidden();
    const body = z.object({ text: z.string().min(1) }).parse(req.body);
    const comment = await prisma.taskComment.create({
      data: { task_id: taskId, author_user_id: req.auth.user.id, text: body.text },
      include: { author: { select: { id: true, username: true, first_name: true } } }
    });
    return reply.code(201).send({ ok: true, comment });
  });
}
