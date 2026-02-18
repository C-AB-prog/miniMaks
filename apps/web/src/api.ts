import { getTelegramWebApp } from './telegram';

const API_BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE ?? 'http://localhost:8080') as string;

// ── API Error ─────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Friendly error messages ───────────────────────────────────────
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'trial_expired') return '⏳ Пробный период истёк. Пожалуйста, оформи подписку.';
    if (e.code === 'unauthorized') return '🔒 Требуется авторизация. Открой приложение в Telegram.';
    if (e.code === 'forbidden') return '🚫 Нет доступа к этому ресурсу.';
    if (e.code === 'owner_only') return '🚫 Только владелец проекта может делать это.';
    if (e.code === 'not_found') return '🔍 Ресурс не найден.';
    if (e.code === 'validation_error') return '⚠️ Некорректные данные. Проверь введённую информацию.';
    if (e.code === 'ai_error') return '🤖 Ассистент временно недоступен. Попробуй позже.';
    return e.message || 'Произошла ошибка.';
  }
  const msg = String((e as any)?.message ?? e ?? '');
  if (msg.toLowerCase().includes('failed to fetch')) return '🌐 Не удалось подключиться к серверу.';
  return msg || 'Произошла неизвестная ошибка.';
}

// ── Fetch wrapper ─────────────────────────────────────────────────
async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const tg = getTelegramWebApp();
  const initData = tg?.initData ?? '';
  const headers = new Headers(options.headers || {});

  if (initData) headers.set('x-telegram-init-data', initData);
  const dev = import.meta.env.VITE_DEV_TG_ID;
  if (!initData && dev) headers.set('x-dev-tg-id', String(dev));
  headers.set('content-type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      json?.code ?? 'unknown_error',
      json?.error ?? `HTTP ${res.status}`,
      res.status,
      json?.details
    );
  }

  return json as T;
}

// ── API client ────────────────────────────────────────────────────
export const api = {
  // Me
  me: () => apiFetch<any>('/me'),
  subscription: () => apiFetch<any>('/me/subscription'),

  // Focuses
  listFocuses: () => apiFetch<any>('/focuses').then((r: any) => r.focuses),
  createFocus: (data: { title: string; description?: string; stage?: string; deadline_at?: string; niche?: string }) =>
    apiFetch<any>('/focuses', { method: 'POST', body: JSON.stringify(data) }).then((r: any) => r.focus),
  getFocus: (id: string) => apiFetch<any>(`/focuses/${id}`),
  updateFocus: (id: string, data: Record<string, unknown>) =>
    apiFetch<any>(`/focuses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then((r: any) => r.focus),
  deleteFocus: (id: string) => apiFetch<any>(`/focuses/${id}`, { method: 'DELETE' }),

  // Tasks
  listTasks: (focusId: string, assigned: 'me' | 'all' = 'me') =>
    apiFetch<any>(`/focuses/${focusId}/tasks?assigned=${assigned}`).then((r: any) => r.tasks),
  createTask: (focusId: string, data: { title: string; description?: string; priority?: string; due_at?: string; assigned_to_user_id?: string }) =>
    apiFetch<any>(`/focuses/${focusId}/tasks`, { method: 'POST', body: JSON.stringify(data) }).then((r: any) => r.task),
  updateTask: (taskId: string, data: Record<string, unknown>) =>
    apiFetch<any>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }).then((r: any) => r.task),
  deleteTask: (taskId: string) => apiFetch<any>(`/tasks/${taskId}`, { method: 'DELETE' }),
  addComment: (taskId: string, text: string) =>
    apiFetch<any>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ text }) }).then((r: any) => r.comment),

  // Invites & Members
  createInvite: (focusId: string, opts?: { expires_at?: string; max_uses?: number }) =>
    apiFetch<any>(`/focuses/${focusId}/invites`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  joinByCode: (code: string) =>
    apiFetch<any>(`/invites/${code}/join`, { method: 'POST' }),
  listMembers: (focusId: string) =>
    apiFetch<any>(`/focuses/${focusId}/members`).then((r: any) => r.members),

  // AI Assistant
  getThread: (focusId: string) => apiFetch<any>(`/focuses/${focusId}/assistant/thread`),
  sendMessage: (focusId: string, content: string) =>
    apiFetch<any>(`/focuses/${focusId}/assistant/message`, { method: 'POST', body: JSON.stringify({ content }) }),
  planToTasks: (focusId: string, tasks: unknown[]) =>
    apiFetch<any>(`/focuses/${focusId}/assistant/plan_to_tasks`, { method: 'POST', body: JSON.stringify({ tasks }) })
};
