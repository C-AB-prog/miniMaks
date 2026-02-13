import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { getTelegramWebApp } from './telegram';

type Project = any;
type Task = any;
type Msg = any;

type Tab = 'projects' | 'tasks' | 'assistant';

export default function App() {
  const tg = useMemo(() => getTelegramWebApp(), []);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [tab, setTab] = useState<Tab>('projects');

  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [assistantInput, setAssistantInput] = useState('');
  const [busy, setBusy] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tg?.ready?.();
    tg?.expand?.();

    (async () => {
      try {
        const m = await api.me();
        setMe(m.user);
        const p = await api.listFocuses();
        setProjects(p.focuses);
      } catch (e: any) {
        setError(humanError(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null);
      setTasks([]);
      setMessages([]);
      setTab('projects');
      return;
    }

    (async () => {
      try {
        const p = await api.getFocus(activeProjectId);
        setActiveProject(p);
        const t = await api.listTasks(activeProjectId, p.role === 'owner' ? 'all' : 'me');
        setTasks(t.tasks);
        const th = await api.getThread(activeProjectId);
        setMessages(th.messages ?? []);
        setTab('tasks');
      } catch (e: any) {
        setError(humanError(e));
      }
    })();
  }, [activeProjectId]);

  useEffect(() => {
    // автопрокрутка чата
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, tab]);

  async function refreshProjects() {
    const p = await api.listFocuses();
    setProjects(p.focuses);
  }

  async function refreshTasksAndThread() {
    if (!activeProjectId) return;
    const t = await api.listTasks(activeProjectId, activeProject?.role === 'owner' ? 'all' : 'me');
    setTasks(t.tasks);
    const th = await api.getThread(activeProjectId);
    setMessages(th.messages ?? []);
  }

  async function createProject() {
    const title = newProjectTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api.createFocus({ title });
      setNewProjectTitle('');
      await refreshProjects();
    } catch (e: any) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    if (!activeProjectId) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTask(activeProjectId, { title });
      setNewTaskTitle('');
      await refreshTasksAndThread();
    } catch (e: any) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(task: any) {
    setBusy(true);
    setError(null);
    try {
      const next = task.status === 'done' ? 'todo' : 'done';
      await api.patchTask(task.id, { status: next });
      await refreshTasksAndThread();
    } catch (e: any) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendAssistant() {
    if (!activeProjectId) return;
    const content = assistantInput.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      setAssistantInput('');
      await api.sendMessage(activeProjectId, content);
      await refreshTasksAndThread();
    } catch (e: any) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  const latestSuggestion = useMemo(() => {
    // ищем последнее сообщение ассистента с предложенными задачами
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const tasks = m?.meta?.suggested_tasks;
      if (m?.role === 'assistant' && Array.isArray(tasks) && tasks.length) return tasks;
    }
    return null;
  }, [messages]);

  async function applySuggestedTasks() {
    if (!activeProjectId || !latestSuggestion) return;
    if (activeProject?.role !== 'owner') {
      setError('Создавать задачи из плана может только владелец проекта.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Приводим предложения к формату API
      const payload = latestSuggestion.map((t: any) => ({
        title: String(t.title ?? '').trim(),
        description: t.description ?? null,
        priority: t.priority ?? 'medium',
        status: 'todo',
        due_at: t.due_at ?? null
      })).filter((t: any) => t.title);

      await api.planToTasks(activeProjectId, payload);
      await refreshTasksAndThread();
      setTab('tasks');
    } catch (e: any) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="screen">
        <Header title="Бизнес ассистент" subtitle="Ошибка" />
        <div className="container">
          <div className="alert alert-danger">
            <div className="alert-title">Не получилось загрузить</div>
            <div className="alert-text">{error}</div>
          </div>
          <div className="card">
            <div className="muted">
              Если открываешь в обычном браузере, укажи <b>VITE_DEV_TG_ID</b> в <b>apps/web/.env</b>.
              В Telegram это не нужно.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="screen">
        <Header title="Бизнес ассистент" subtitle="Загружаю…" />
        <div className="container">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  const inProject = Boolean(activeProjectId);

  return (
    <div className="screen">
      <Header
        title="Бизнес ассистент"
        subtitle={inProject ? `Проект • ${activeProject?.role === 'owner' ? 'владелец' : 'участник'}` : 'Мои проекты'}
        right={
          inProject ? (
            <button className="iconBtn" onClick={() => setActiveProjectId(null)} aria-label="Назад">
              ←
            </button>
          ) : (
            <div className="avatar" title={me?.username ? `@${me.username}` : 'Пользователь'}>
              {String(me?.username ?? 'U').slice(0, 1).toUpperCase()}
            </div>
          )
        }
      />

      <div className="container">
        {!inProject ? (
          <>
            <div className="hero">
              <div className="hero-title">Сделаем план и доведём до результата</div>
              <div className="hero-sub">Создай проект, а дальше — задачи и чат с ассистентом внутри.</div>
            </div>

            <div className="card card-accent">
              <div className="card-title">Создать проект</div>
              <div className="row">
                <input
                  className="input"
                  placeholder="Например: Запуск кофейни"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                />
                <button className="btn" onClick={createProject} disabled={busy}>
                  Создать
                </button>
              </div>
              <div className="hint">Проект = цель/направление бизнеса. Внутри — задачи и ассистент.</div>
            </div>

            <div className="sectionTitle">Мои проекты</div>
            <div className="grid">
              {projects.map((p) => (
                <button key={p.id} className="projectCard" onClick={() => setActiveProjectId(p.id)}>
                  <div className="projectTop">
                    <div className="projectName">{p.title}</div>
                    <span className={`badge ${badgeClass(p.status)}`}>{statusRu(p.status)}</span>
                  </div>
                  <div className="projectMeta">
                    <span>Роль: {p.role === 'owner' ? 'владелец' : 'участник'}</span>
                    <span>•</span>
                    <span>Открыть →</span>
                  </div>
                </button>
              ))}
              {!projects.length && (
                <div className="empty">
                  <div className="empty-title">Пока нет проектов</div>
                  <div className="empty-sub">Создай первый — и начни общение с ассистентом.</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="projectHeader">
              <div>
                <div className="projectHeaderTitle">{activeProject?.focus?.title ?? ''}</div>
                <div className="projectHeaderSub">Статус: {statusRu(activeProject?.focus?.status)} • Роль: {activeProject?.role === 'owner' ? 'владелец' : 'участник'}</div>
              </div>
              <div className="chips">
                <button className={`chip ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>Задачи</button>
                <button className={`chip ${tab === 'assistant' ? 'active' : ''}`} onClick={() => setTab('assistant')}>Ассистент</button>
              </div>
            </div>

            {tab === 'tasks' && (
              <div className="card">
                <div className="card-title">Задачи</div>

                {activeProject?.role === 'owner' ? (
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Новая задача"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                    />
                    <button className="btn" onClick={createTask} disabled={busy}>Добавить</button>
                  </div>
                ) : (
                  <div className="hint">В этом проекте ты участник. Создавать задачи может только владелец.</div>
                )}

                <div className="taskList">
                  {tasks.map((t) => (
                    <div key={t.id} className="taskRow">
                      <button className={`check ${t.status === 'done' ? 'on' : ''}`} onClick={() => toggleDone(t)} aria-label="Готово">
                        {t.status === 'done' ? '✓' : ''}
                      </button>
                      <div className="taskBody">
                        <div className={`taskTitle ${t.status === 'done' ? 'done' : ''}`}>{t.title}</div>
                        <div className="taskMeta">
                          <span>{statusRu(t.status)}</span>
                          <span>•</span>
                          <span>{priorityRu(t.priority)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!tasks.length && (
                    <div className="empty">
                      <div className="empty-title">Пока задач нет</div>
                      <div className="empty-sub">Создай задачу или попроси ассистента предложить план действий.</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'assistant' && (
              <div className="card">
                <div className="card-title">Ассистент</div>
                <div className="hint">Опиши цель или проблему. Ассистент ответит и может предложить задачи.</div>

                {latestSuggestion && (
                  <div className="suggestion">
                    <div className="suggestion-title">Есть предложение задач</div>
                    <div className="suggestion-list">
                      {latestSuggestion.slice(0, 4).map((t: any, idx: number) => (
                        <div key={idx} className="suggestion-item">• {t.title}</div>
                      ))}
                      {latestSuggestion.length > 4 && <div className="muted">и ещё {latestSuggestion.length - 4}…</div>}
                    </div>
                    <button className="btn" onClick={applySuggestedTasks} disabled={busy}>
                      Создать задачи из предложения
                    </button>
                  </div>
                )}

                <div className="chat">
                  {messages.map((m) => (
                    <div key={m.id} className={`bubble ${m.role === 'user' ? 'me' : 'ai'}`}>
                      <div className="bubble-role">{m.role === 'user' ? 'Вы' : 'Ассистент'}</div>
                      <div className="bubble-text">{m.content}</div>
                      {Array.isArray(m?.meta?.followup_questions) && m.meta.followup_questions.length ? (
                        <div className="bubble-qs">
                          <div className="bubble-qs-title">Уточняющие вопросы:</div>
                          {m.meta.followup_questions.map((q: string, i: number) => (
                            <div key={i} className="bubble-q">• {q}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!messages.length && (
                    <div className="empty">
                      <div className="empty-title">Начни диалог</div>
                      <div className="empty-sub">Например: «Хочу открыть кофейню. С чего начать?»</div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <input
                    className="input"
                    placeholder="Например: упали продажи, что делать?"
                    value={assistantInput}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendAssistant();
                    }}
                  />
                  <button className="btn" onClick={sendAssistant} disabled={busy}>
                    Отправить
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Низ: аккуратная панель (в проекте скрываем, чтобы не занимала место) */}
      {!inProject && (
        <div className="bottomBar">
          <button className={`bottomItem ${tab === 'projects' ? 'active' : ''}`} onClick={() => setTab('projects')}>
            <span className="bottomIcon">📁</span>
            <span>Проекты</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{subtitle}</div>
      </div>
      <div className="topbar-right">{right}</div>
    </div>
  );
}

function humanError(e: any): string {
  const msg = String(e?.message ?? e ?? '');
  if (msg.includes('Failed to fetch')) {
    return 'Не удалось подключиться к серверу. Проверь VITE_API_URL (должен быть публичный URL порта 8080), а в apps/api/.env — WEB_ORIGIN (публичный 5173).';
  }
  if (msg.includes('trial_expired')) {
    return 'Пробный период закончился (trial_expired). Для теста увеличь срок в subscription.ts или сбрось пользователя.';
  }
  if (msg.includes('unauthorized')) {
    return 'Не удалось авторизоваться. Открой приложение из Telegram или укажи VITE_DEV_TG_ID для теста в браузере.';
  }
  return msg;
}

function statusRu(status: string): string {
  switch (status) {
    case 'active':
      return 'Активен';
    case 'paused':
      return 'Пауза';
    case 'done':
      return 'Завершён';
    case 'archived':
      return 'Архив';
    case 'todo':
      return 'К выполнению';
    case 'in_progress':
      return 'В работе';
    case 'canceled':
      return 'Отменено';
    default:
      return status || '—';
  }
}

function priorityRu(p: string): string {
  switch (p) {
    case 'low':
      return 'Низкий приоритет';
    case 'medium':
      return 'Средний приоритет';
    case 'high':
      return 'Высокий приоритет';
    case 'urgent':
      return 'Срочно';
    default:
      return p || '—';
  }
}

function badgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'badge-green';
    case 'paused':
      return 'badge-orange';
    case 'done':
      return 'badge-blue';
    case 'archived':
      return 'badge-gray';
    default:
      return 'badge-gray';
  }
}
