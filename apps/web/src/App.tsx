import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, friendlyError } from './api';

// ── Types ─────────────────────────────────────────────────────────
type Me = { user: { id: string; tg_id: string; first_name?: string; username?: string } };
type Focus = {
  id: string; title: string; status: string; role: 'owner' | 'member';
  _count?: { tasks: number; members: number };
};
type Task = {
  id: string; title: string; status: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_at?: string | null;
  assigned_to_user_id?: string | null;
};
type Member = { user_id: string; role: string; username?: string | null; first_name?: string | null };
type Msg = {
  id: string; role: 'user' | 'assistant'; content: string; created_at: string;
  meta?: { suggested_tasks?: { title: string; priority?: string }[] };
};
type Tab = 'tasks' | 'ai' | 'team';
type Screen = { name: 'home' } | { name: 'project'; focusId: string; tab: Tab };

// ── Helpers ───────────────────────────────────────────────────────
function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

function userName(me: Me | null) {
  if (!me) return '...';
  return me.user.first_name || me.user.username || `tg${me.user.tg_id}`;
}

function dueLabel(d: string): { text: string; cls: string } | null {
  try {
    const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    if (diff < 0)  return { text: 'просрочено', cls: 'red' };
    if (diff === 0) return { text: 'сегодня', cls: 'amb' };
    if (diff === 1) return { text: 'завтра', cls: 'amb' };
    return { text: new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), cls: '' };
  } catch { return null; }
}

function fmtTime(d: string) {
  try { return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function memberInitial(m: Member) {
  const name = m.first_name || m.username || m.user_id;
  return name.charAt(0).toUpperCase();
}

function memberDisplay(m: Member) {
  return m.first_name || (m.username ? `@${m.username}` : `User …${m.user_id.slice(-4)}`);
}

const PRIO_CLS: Record<string, string> = { urgent: 'pu', high: 'ph', medium: 'pm', low: 'pl' };
const PRIO_LBL: Record<string, string> = { urgent: '🔥 срочно', high: '⬆️ высокий', low: '⬇️ низкий' };

// ── App ───────────────────────────────────────────────────────────
export default function App() {
  const [me, setMe]           = useState<Me | null>(null);
  const [focuses, setFocuses] = useState<Focus[]>([]);
  const [screen, setScreen]   = useState<Screen>({ name: 'home' });
  const [pageKey, setPageKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Home
  const [newTitle, setNewTitle]   = useState('');
  const [creating, setCreating]   = useState(false);
  const [joinCode, setJoinCode]   = useState('');
  const [joining, setJoining]     = useState(false);

  // Project
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [members, setMembers]     = useState<Member[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [genInvite, setGenInvite] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [msgs, setMsgs]           = useState<Msg[]>([]);
  const [aiInput, setAiInput]     = useState('');
  const [aiBusy, setAiBusy]       = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const activeFocus = useMemo(
    () => screen.name === 'project' ? focuses.find(f => f.id === screen.focusId) ?? null : null,
    [screen, focuses]
  );
  const taskStats = useMemo(() => {
    const done = tasks.filter(t => t.status === 'done').length;
    return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }, [tasks]);

  const scrollChat = () => setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: 'smooth' }), 60);

  // ── Load home ─────────────────────────────────────────────────
  async function loadHome() {
    setLoading(true); setError(null);
    try {
      const [m, fs] = await Promise.all([api.me(), api.listFocuses()]);
      setMe(m as Me);
      setFocuses((fs as Focus[]) || []);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  // ── Open project ──────────────────────────────────────────────
  async function openProject(focusId: string, tab: Tab = 'tasks') {
    setScreen({ name: 'project', focusId, tab });
    setPageKey(k => k + 1);
    setError(null); setLoading(true);
    setTasks([]); setMembers([]); setMsgs([]); setInviteCode(null);
    try {
      const [t, thread, mems] = await Promise.all([
        api.listTasks(focusId, 'all'),
        api.getThread(focusId),
        api.listMembers(focusId),
      ]);
      setTasks((t as Task[]) || []);
      setMsgs((thread as any).messages || []);
      setMembers((mems as Member[]) || []);
      scrollChat();
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  function goHome() {
    setScreen({ name: 'home' }); setPageKey(k => k + 1);
    setError(null); setTasks([]); setMsgs([]); setMembers([]);
  }

  useEffect(() => { loadHome(); }, []);

  // ── Create project ────────────────────────────────────────────
  async function createProject() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true); setError(null);
    try {
      const f = await api.createFocus({ title });
      setFocuses(prev => [f as Focus, ...prev]);
      setNewTitle('');
      await openProject((f as Focus).id);
    } catch (e) { setError(friendlyError(e)); }
    finally { setCreating(false); }
  }

  // ── Join by code ──────────────────────────────────────────────
  async function joinProject() {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true); setError(null);
    try {
      const res: any = await api.joinByCode(code);
      setJoinCode('');
      await loadHome();
      if (res.focus_id) await openProject(res.focus_id);
    } catch (e) { setError(friendlyError(e)); }
    finally { setJoining(false); }
  }

  // ── Add task ──────────────────────────────────────────────────
  async function addTask() {
    if (screen.name !== 'project') return;
    const title = taskTitle.trim();
    if (!title) return;
    setAddingTask(true); setError(null);
    try {
      const t = await api.createTask(screen.focusId, { title });
      setTasks(prev => [t as Task, ...prev]);
      setTaskTitle('');
    } catch (e) { setError(friendlyError(e)); }
    finally { setAddingTask(false); }
  }

  // ── Toggle task ───────────────────────────────────────────────
  async function toggleTask(t: Task) {
    const next = t.status === 'done' ? 'todo' : 'done';
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    try {
      const updated = await api.updateTask(t.id, { status: next });
      setTasks(prev => prev.map(x => x.id === t.id ? updated as Task : x));
    } catch (e) {
      setTasks(prev => prev.map(x => x.id === t.id ? t : x));
      setError(friendlyError(e));
    }
  }

  // ── Send AI message ───────────────────────────────────────────
  async function sendAi() {
    if (screen.name !== 'project' || !aiInput.trim() || aiBusy) return;
    const text = aiInput.trim();
    setAiBusy(true); setError(null);
    const tmp: Msg = { id: `tmp_${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() };
    setMsgs(prev => [...prev, tmp]);
    setAiInput(''); scrollChat();
    try {
      const res: any = await api.sendMessage(screen.focusId, text);
      if (res.message) setMsgs(prev => [...prev.filter(m => m.id !== tmp.id), res.message]);
      scrollChat();
    } catch (e) {
      setMsgs(prev => prev.filter(m => m.id !== tmp.id));
      setError(friendlyError(e));
    } finally { setAiBusy(false); }
  }

  // ── Add AI suggested task ─────────────────────────────────────
  async function addSuggested(title: string) {
    if (screen.name !== 'project') return;
    try {
      const t = await api.createTask(screen.focusId, { title });
      setTasks(prev => [t as Task, ...prev]);
    } catch (e) { setError(friendlyError(e)); }
  }

  // ── Generate invite code ──────────────────────────────────────
  async function generateInvite() {
    if (screen.name !== 'project') return;
    setGenInvite(true);
    try {
      const res: any = await api.createInvite(screen.focusId);
      setInviteCode(res.invite?.code ?? null);
    } catch (e) { setError(friendlyError(e)); }
    finally { setGenInvite(false); }
  }

  function copyCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  // ── Render ────────────────────────────────────────────────────
  const isOwner = activeFocus?.role === 'owner';

  return (
    <div className="app">

      {/* ═══════ TOPBAR ═══════ */}
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">BA</div>
          <div>
            <div className="brandName">
              {screen.name === 'home' ? 'miniMaks' : (activeFocus?.title ?? 'Проект')}
            </div>
            <div className="brandSub">
              {screen.name === 'home'
                ? `Привет, ${userName(me)} 👋`
                : activeFocus?.role === 'owner' ? '👑 Владелец' : '👤 Участник'}
            </div>
          </div>
        </div>
        {screen.name === 'project'
          ? <button className="iconBtn" onClick={goHome}>←</button>
          : <button className="iconBtn" onClick={loadHome}>↻</button>
        }
      </header>

      <div className="content" key={pageKey}>

        {/* Alert */}
        {error && <div className="alert">⚠️ {error}</div>}

        {/* Skeleton */}
        {loading && (
          <div className="skeleton">
            <div className="skLine" />
            <div className="skCard" />
            <div className="skCard" />
          </div>
        )}

        {/* ══════════════════════════════════
            HOME — только проекты
            ══════════════════════════════════ */}
        {!loading && screen.name === 'home' && (
          <div className="pageIn">
            {/* Hero */}
            <div className="hero">
              <div className="heroBadge"><span className="dot" /> Business Assistant</div>
              <h1 className="heroTitle">Управляй проектами<br /><span>эффективно</span></h1>
              <p className="heroText">Создавай проекты, зови команду по коду и общайся с ИИ-ассистентом.</p>
            </div>

            {/* Stats */}
            {focuses.length > 0 && (
              <div className="statsRow">
                <div className="statCard">
                  <span className="statNum" style={{ color: 'var(--teal)' }}>{focuses.length}</span>
                  <span className="statLbl">Проектов</span>
                </div>
                <div className="statCard">
                  <span className="statNum" style={{ color: 'var(--violet)' }}>
                    {focuses.reduce((s, f) => s + (f._count?.tasks ?? 0), 0)}
                  </span>
                  <span className="statLbl">Задач</span>
                </div>
                <div className="statCard">
                  <span className="statNum" style={{ color: 'var(--green)' }}>
                    {focuses.filter(f => f.status === 'active').length}
                  </span>
                  <span className="statLbl">Активных</span>
                </div>
              </div>
            )}

            {/* Create project */}
            <div className="card">
              <div className="cardLabel">Создать проект</div>
              <div className="row">
                <input
                  className="input"
                  placeholder="Название проекта..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createProject()}
                />
                <button className="btn btnPrimary" disabled={creating || !newTitle.trim()} onClick={createProject}>
                  {creating ? '...' : '+ Создать'}
                </button>
              </div>
            </div>

            {/* Join by code */}
            <div className="joinCard">
              <div className="cardLabel" style={{ marginBottom: 8 }}>Войти по коду приглашения</div>
              <div className="row">
                <input
                  className="input"
                  placeholder="Введи код (например: a1b2c3d4)"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.trim())}
                  onKeyDown={e => e.key === 'Enter' && joinProject()}
                />
                <button className="btn btnGhost" disabled={joining || !joinCode} onClick={joinProject}>
                  {joining ? '...' : 'Войти'}
                </button>
              </div>
            </div>

            {/* Projects list */}
            <div className="secHead">
              <span className="secTitle">Мои проекты</span>
              <span className="secBadge">{focuses.length}</span>
            </div>

            {focuses.length === 0 ? (
              <div className="empty">
                <span className="emptyIco">🚀</span>
                Проектов ещё нет. Создай первый или войди по коду приглашения.
              </div>
            ) : (
              <div className="projList">
                {focuses.map(f => (
                  <button key={f.id} className="projCard" onClick={() => openProject(f.id)}>
                    <div className="projTop">
                      <span className="projName">{f.title}</span>
                      <span className={cx('pill', f.status === 'active' ? 'pillGreen' : 'pillGray')}>
                        {f.status === 'active' ? 'active' : f.status}
                      </span>
                    </div>
                    <div className="projMeta">
                      {f._count?.tasks ?? 0} задач · {f._count?.members ?? 1} чел. · {f.role === 'owner' ? 'владелец' : 'участник'}
                    </div>
                    <div className="projArrow">Открыть →</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════
            PROJECT — задачи / ИИ / команда
            ══════════════════════════════════ */}
        {!loading && screen.name === 'project' && activeFocus && (
          <div className="pageIn">

            {/* Tabs */}
            <div className="tabs">
              <button
                className={cx('tab', screen.tab === 'tasks' && 'tabActive')}
                onClick={() => setScreen({ ...screen, tab: 'tasks' })}
              >📋 Задачи</button>
              <button
                className={cx('tab', screen.tab === 'ai' && 'tabActive')}
                onClick={() => setScreen({ ...screen, tab: 'ai' })}
              >🤖 ИИ</button>
              <button
                className={cx('tab', screen.tab === 'team' && 'tabActive')}
                onClick={() => setScreen({ ...screen, tab: 'team' })}
              >👥 Команда</button>
            </div>

            {/* ─── TASKS TAB ─── */}
            {screen.tab === 'tasks' && (
              <>
                {/* Progress */}
                {tasks.length > 0 && (
                  <div className="progWrap">
                    <div className="progRow">
                      <span className="progLabel">Прогресс</span>
                      <span className="progPct">{taskStats.pct}%</span>
                    </div>
                    <div className="pbar">
                      <div className="pfill" style={{ width: `${taskStats.pct}%` }} />
                    </div>
                    <div className="progSub">{taskStats.done} из {taskStats.total} выполнено</div>
                  </div>
                )}

                {/* Add task (owner only) */}
                {isOwner && (
                  <div className="card">
                    <div className="cardLabel">Новая задача</div>
                    <div className="row">
                      <input
                        className="input"
                        placeholder="Название задачи..."
                        value={taskTitle}
                        onChange={e => setTaskTitle(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addTask()}
                      />
                      <button className="btn btnPrimary" disabled={addingTask || !taskTitle.trim()} onClick={addTask}>
                        {addingTask ? '...' : '+'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Tasks list */}
                <div className="secHead">
                  <span className="secTitle">Задачи</span>
                  <span className="secBadge">{tasks.length}</span>
                </div>

                {tasks.length === 0 ? (
                  <div className="empty">
                    <span className="emptyIco">✅</span>
                    {isOwner
                      ? 'Добавь первую задачу или попроси ИИ составить план.'
                      : 'Владелец проекта пока не добавил задачи.'}
                  </div>
                ) : (
                  <div className="taskList">
                    {tasks.map(t => {
                      const dl = t.due_at ? dueLabel(t.due_at) : null;
                      return (
                        <div key={t.id} className={cx('taskCard', PRIO_CLS[t.priority ?? 'medium'])}>
                          <button
                            className={cx('check', t.status === 'done' && 'checkDone')}
                            onClick={() => toggleTask(t)}
                          >{t.status === 'done' ? '✓' : ''}</button>
                          <div className="taskBody">
                            <div className={cx('taskTitle', t.status === 'done' && 'taskTitleDone')}>
                              {t.title}
                            </div>
                            <div className="taskTags">
                              {t.priority && PRIO_LBL[t.priority] && (
                                <span className={cx('taskTag', t.priority === 'urgent' ? 'red' : t.priority === 'high' ? 'amb' : '')}>
                                  {PRIO_LBL[t.priority]}
                                </span>
                              )}
                              {dl && <span className={cx('taskTag', dl.cls)}>🗓 {dl.text}</span>}
                              {t.status === 'done' && <span className="taskTag grn">✓ готово</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* ─── AI TAB ─── */}
            {screen.tab === 'ai' && (
              <div className="chatWrap">
                {msgs.length === 0 && !aiBusy ? (
                  <div className="empty">
                    <span className="emptyIco">🤖</span>
                    Спроси ассистента: «Составь план», «Разбей задачи по приоритетам», «Что сделать первым?»
                  </div>
                ) : (
                  <div className="chatList">
                    {msgs.map(m => (
                      <div key={m.id} className={cx('bRow', m.role === 'assistant' ? 'bLeft' : 'bRight')}>
                        <div className={cx('bubble', m.role === 'assistant' ? 'bubbleA' : 'bubbleU')}>
                          <div className="bText">{m.content}</div>
                          <div className="bTime">{fmtTime(m.created_at)}</div>
                          {m.role === 'assistant' && (m.meta?.suggested_tasks?.length ?? 0) > 0 && (
                            <div>
                              <div className="aiSugLabel">💡 Предложенные задачи</div>
                              {m.meta!.suggested_tasks!.map((st, i) => (
                                <div key={i} className="aiSug">
                                  <span>{st.title}</span>
                                  <button className="aiSugBtn" onClick={() => addSuggested(st.title)}>+ В задачи</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {aiBusy && (
                      <div className="bRow bLeft">
                        <div className="bubble bubbleA typing">
                          <div className="tdot" /><div className="tdot" /><div className="tdot" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>
                )}
                <div className="composer">
                  <textarea
                    className="textarea"
                    placeholder="Напиши ассистенту... (Enter — отправить)"
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAi(); } }}
                    rows={2}
                  />
                  <button
                    className="btn btnPrimary"
                    style={{ alignSelf: 'flex-end', padding: '8px 13px' }}
                    disabled={aiBusy || !aiInput.trim()}
                    onClick={sendAi}
                  >{aiBusy ? '...' : '↑'}</button>
                </div>
                <p className="hint" style={{ textAlign: 'center' }}>Shift+Enter — перенос строки</p>
              </div>
            )}

            {/* ─── TEAM TAB ─── */}
            {screen.tab === 'team' && (
              <>
                {/* Invite block (owner only) */}
                {isOwner && (
                  <div className="inviteBox">
                    <div className="cardLabel">Пригласить в команду</div>
                    {inviteCode ? (
                      <>
                        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                          Поделись этим кодом с участником — он введёт его на главной странице:
                        </p>
                        <span className="inviteCode">{inviteCode}</span>
                        <button className={cx('copyBtn', copied && 'copied')} onClick={copyCode}>
                          {copied ? '✓ Скопировано!' : '📋 Скопировать код'}
                        </button>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                          Сгенерируй код приглашения и отправь участнику. Он зайдёт на главную и введёт код.
                        </p>
                        <button className="btn btnPrimary" style={{ width: '100%' }} disabled={genInvite} onClick={generateInvite}>
                          {genInvite ? 'Генерирую...' : '🔑 Сгенерировать код'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Members */}
                <div className="secHead">
                  <span className="secTitle">Участники</span>
                  <span className="secBadge">{members.length}</span>
                </div>

                {members.length === 0 ? (
                  <div className="empty">
                    <span className="emptyIco">👥</span>
                    {isOwner ? 'Пригласи участников через код выше.' : 'Участники не загружены.'}
                  </div>
                ) : (
                  <div className="memberList">
                    {members.map(m => (
                      <div key={m.user_id} className="memberCard">
                        <div className="memberAvatar">{memberInitial(m)}</div>
                        <span className="memberName">{memberDisplay(m)}</span>
                        <span className={cx('memberRole', m.role === 'owner' && 'owner')}>
                          {m.role === 'owner' ? 'Владелец' : 'Участник'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </div>

      <footer style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
        miniMaks © {new Date().getFullYear()}
      </footer>
    </div>
  );
}
