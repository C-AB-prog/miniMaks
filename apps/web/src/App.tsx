import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

type Me = { ok: true; user: { id: string; tg_id: string; name: string }; is_in_telegram: boolean };
type Focus = { id: string; title: string; role: 'owner' | 'member' };
type Task = {
  id: string;
  title: string;
  done: boolean;
  priority?: 'low' | 'normal' | 'high';
  due_at?: string | null;
  assigned_to_user_id?: string | null;
};
type ThreadMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string; created_at: string };

type Screen =
  | { name: 'home' }
  | { name: 'focus'; focusId: string; tab: 'tasks' | 'assistant' };

function cx(...arr: Array<string | false | undefined | null>) {
  return arr.filter(Boolean).join(' ');
}

function prettifyError(e: unknown) {
  const msg = String((e as any)?.message ?? e ?? '');
  if (msg.toLowerCase().includes('failed to fetch')) return 'Не удалось подключиться к серверу. Проверь домен API и HTTPS.';
  if (msg.toLowerCase().includes('unauthorized')) return 'Требуется авторизация Telegram. Открой мини‑приложение внутри Telegram.';
  return msg || 'Произошла ошибка.';
}

function formatTime(d: string | Date) {
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [focuses, setFocuses] = useState<Focus[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Home
  const [newFocusTitle, setNewFocusTitle] = useState('');
  const [creatingFocus, setCreatingFocus] = useState(false);

  // Focus
  const activeFocus = useMemo(() => {
    if (screen.name !== 'focus') return null;
    return focuses.find((f) => f.id === screen.focusId) ?? null;
  }, [screen, focuses]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  // Assistant
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  };

  async function loadHome() {
    setLoading(true);
    setError(null);
    try {
      const m = await api.me();
      setMe(m);
      const fs = await api.listFocuses();
      setFocuses(fs);
    } catch (e) {
      setError(prettifyError(e));
    } finally {
      setLoading(false);
    }
  }

  async function openFocus(focusId: string, tab: 'tasks' | 'assistant' = 'tasks') {
    setScreen({ name: 'focus', focusId, tab });
    setError(null);
    setLoading(true);
    try {
      const [t, thread] = await Promise.all([api.listTasks(focusId), api.getAssistantThread(focusId)]);
      setTasks(t);
      setMessages(thread.messages);
      scrollChatToBottom();
    } catch (e) {
      setError(prettifyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHome();
  }, []);

  // ---------- Actions ----------

  async function createFocus() {
    const title = newFocusTitle.trim();
    if (!title) return;
    setCreatingFocus(true);
    setError(null);
    try {
      const f = await api.createFocus(title);
      setFocuses((prev) => [f, ...prev]);
      setNewFocusTitle('');
      await openFocus(f.id, 'tasks');
    } catch (e) {
      setError(prettifyError(e));
    } finally {
      setCreatingFocus(false);
    }
  }

  async function createTask() {
    if (screen.name !== 'focus') return;
    const title = taskTitle.trim();
    if (!title) return;
    setCreatingTask(true);
    setError(null);
    try {
      const t = await api.createTask(screen.focusId, title);
      setTasks((prev) => [t, ...prev]);
      setTaskTitle('');
    } catch (e) {
      setError(prettifyError(e));
    } finally {
      setCreatingTask(false);
    }
  }

  async function toggleTask(t: Task) {
    if (screen.name !== 'focus') return;
    setError(null);
    // optimistic
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: x.status === 'done' ? 'todo' : 'done' } : x)));
    try {
      const updated = await api.updateTask(screen.focusId, t.id, {
        status: t.status === 'done' ? 'todo' : 'done'
      });
      setTasks((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      // rollback
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setError(prettifyError(e));
    }
  }

  async function sendToAssistant() {
    if (screen.name !== 'focus') return;
    const text = assistantInput.trim();
    if (!text) return;
    setAssistantBusy(true);
    setError(null);

    const tempId = `local_${Date.now()}`;
    const optimisticUserMsg: ThreadMessage = {
      id: tempId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);
    setAssistantInput('');
    scrollChatToBottom();

    try {
      const res = await api.sendMessage(screen.focusId, text);
      // server returns the whole thread now
      setMessages(res.thread.messages);
      if (res.tasks_added?.length) {
        // refresh tasks list (assistant can create tasks)
        const t = await api.listTasks(screen.focusId);
        setTasks(t);
      }
      scrollChatToBottom();
    } catch (e) {
      // keep user msg, but show error
      setError(prettifyError(e));
      // mark message as unsent
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, content: `${m.content}\n\n(Не отправилось: ${prettifyError(e)})` } : m))
      );
    } finally {
      setAssistantBusy(false);
    }
  }

  // ---------- UI ----------

  const headerSubtitle = useMemo(() => {
    if (!me) return 'Подключаемся…';
    return `${me.name} • ${me.role === 'owner' ? 'владелец' : 'участник'}`;
  }, [me]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brandMark">BA</div>
          <div>
            <div className="brandTitle">Бизнес ассистент</div>
            <div className="brandSub">{screen.name === 'home' ? headerSubtitle : activeFocus?.title ?? 'Проект'}</div>
          </div>
        </div>
        <div className="topbarActions">
          {screen.name !== 'home' ? (
            <button
              className="iconBtn"
              onClick={() => {
                setScreen({ name: 'home' });
                setError(null);
                setTasks([]);
                setMessages([]);
              }}
              title="Назад"
            >
              ←
            </button>
          ) : (
            <button className="iconBtn" onClick={loadHome} title="Обновить">
              ↻
            </button>
          )}
        </div>
      </div>

      <div className="content">
        {error ? <div className="alert">{error}</div> : null}

        {loading ? (
          <div className="skeleton">
            <div className="skLine" />
            <div className="skCard" />
            <div className="skCard" />
          </div>
        ) : null}

        {!loading && screen.name === 'home' ? (
          <>
            <div className="hero">
              <div className="heroTitle">План на неделю — в 10 минут</div>
              <div className="heroText">
                Создай проект, добавь задачи, а ассистент поможет разложить всё по шагам и приоритетам.
              </div>
            </div>

            <div className="card">
              <div className="cardTitle">Создать проект</div>
              <div className="row gap">
                <input
                  className="input"
                  placeholder="Например: Запуск кофейни"
                  value={newFocusTitle}
                  onChange={(e) => setNewFocusTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createFocus();
                  }}
                />
                <button className="btn" disabled={creatingFocus} onClick={createFocus}>
                  {creatingFocus ? 'Создаю…' : 'Создать'}
                </button>
              </div>
              <div className="hint">Проект = направление бизнеса. Внутри — задачи и чат с ассистентом.</div>
            </div>

            <div className="sectionHeader">
              <div>Мои проекты</div>
              <div className="muted">{focuses.length}</div>
            </div>

            {focuses.length === 0 ? (
              <div className="empty">Пока нет проектов. Создай первый — и начнём.</div>
            ) : (
              <div className="list">
                {focuses.map((f) => (
                  <button key={f.id} className="focusCard" onClick={() => openFocus(f.id, 'tasks')}>
                    <div className="focusCardTop">
                      <div className="focusTitle">{f.title}</div>
                      <span className={cx('pill', f.status === 'active' ? 'pillGreen' : 'pillGray')}>
                        {f.status === 'active' ? 'Активен' : 'Пауза'}
                      </span>
                    </div>
                    <div className="focusMeta">Роль: {f.role === 'owner' ? 'владелец' : 'участник'}</div>
                    <div className="focusOpen">Открыть →</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {!loading && screen.name === 'focus' && activeFocus ? (
          <>
            <div className="tabs">
              <button
                className={cx('tab', screen.tab === 'tasks' && 'tabActive')}
                onClick={() => setScreen({ ...screen, tab: 'tasks' })}
              >
                Задачи
              </button>
              <button
                className={cx('tab', screen.tab === 'assistant' && 'tabActive')}
                onClick={() => setScreen({ ...screen, tab: 'assistant' })}
              >
                Ассистент
              </button>
            </div>

            {screen.tab === 'tasks' ? (
              <>
                <div className="card">
                  <div className="cardTitle">Новая задача</div>
                  <div className="row gap">
                    <input
                      className="input"
                      placeholder="Например: Посчитать экономику кофе‑точки"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createTask();
                      }}
                    />
                    <button className="btn" disabled={creatingTask} onClick={createTask}>
                      {creatingTask ? 'Добавляю…' : 'Добавить'}
                    </button>
                  </div>
                </div>

                <div className="sectionHeader">
                  <div>Список задач</div>
                  <div className="muted">{tasks.length}</div>
                </div>

                {tasks.length === 0 ? (
                  <div className="empty">Пока задач нет. Добавь первую — или попроси ассистента составить план.</div>
                ) : (
                  <div className="list">
                    {tasks.map((t) => (
                      <div key={t.id} className="taskCard">
                        <button className={cx('check', t.status === 'done' && 'checkDone')} onClick={() => toggleTask(t)}>
                          {t.status === 'done' ? '✓' : ''}
                        </button>
                        <div className="taskBody">
                          <div className={cx('taskTitle', t.status === 'done' && 'taskTitleDone')}>{t.title}</div>
                          <div className="taskMeta">
                            {t.priority === 'high' ? 'Приоритет: высокий' : t.priority === 'low' ? 'Приоритет: низкий' : 'Приоритет: средний'}
                            {t.due_at ? ` • дедлайн: ${new Date(t.due_at).toLocaleDateString('ru-RU')}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="chat">
                  {messages.length === 0 ? (
                    <div className="empty">Напиши ассистенту: «Сделай план по проекту и разбей на задачи».</div>
                  ) : (
                    <div className="chatList">
                      {messages.map((m) => (
                        <div key={m.id} className={cx('bubbleRow', m.role === 'assistant' ? 'left' : 'right')}>
                          <div className={cx('bubble', m.role === 'assistant' ? 'bubbleA' : 'bubbleU')}>
                            <div className="bubbleText">{m.content}</div>
                            <div className="bubbleTime">{formatTime(m.created_at)}</div>
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  )}

                  <div className="chatComposer">
                    <textarea
                      className="textarea"
                      placeholder="Напиши сообщение…"
                      value={assistantInput}
                      onChange={(e) => setAssistantInput(e.target.value)}
                      rows={2}
                    />
                    <button className="btn" disabled={assistantBusy} onClick={sendToAssistant}>
                      {assistantBusy ? 'Думаю…' : 'Отправить'}
                    </button>
                  </div>
                  <div className="hint">
                    Подсказка: можно попросить ассистента «Составь план на 7 дней», «Собери список задач с приоритетами», «Сделай чек‑лист запуска».
                  </div>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>

      <div className="footer">
        <div className="footerInner">© {new Date().getFullYear()} • Business Assistant</div>
      </div>
    </div>
  );
}
