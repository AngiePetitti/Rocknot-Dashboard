'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/src/components/Header';

type TaskStatus = 'todo' | 'in_progress' | 'done';
type Priority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;
  priority: Priority;
  status: TaskStatus;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  completedAt?: string;
  order: number;
}

const COLUMNS: { key: TaskStatus; label: string; accent: string; bg: string }[] = [
  { key: 'todo', label: '📋 To Do', accent: '#93c5fd', bg: 'bg-blue-50/50' },
  { key: 'in_progress', label: '🔨 In Progress', accent: '#fcd34d', bg: 'bg-amber-50/50' },
  { key: 'done', label: '✅ Done', accent: '#86efac', bg: 'bg-green-50/50' },
];

const PRIORITY_META: Record<Priority, { label: string; dot: string; chip: string }> = {
  high: { label: 'High', dot: '#ef4444', chip: 'bg-red-50 text-red-600 border-red-200' },
  medium: { label: 'Medium', dot: '#f59e0b', chip: 'bg-amber-50 text-amber-600 border-amber-200' },
  low: { label: 'Low', dot: '#9ca3af', chip: 'bg-gray-50 text-gray-500 border-gray-200' },
};

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function dueMeta(dueDate: string | undefined, status: TaskStatus): { text: string; cls: string } | null {
  if (!dueDate) return null;
  const today = todayStr();
  const nice = new Date(dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (status === 'done') return { text: nice, cls: 'text-gray-400' };
  if (dueDate < today) return { text: `${nice} · overdue`, cls: 'text-red-600 font-semibold' };
  if (dueDate === today) return { text: `${nice} · today`, cls: 'text-amber-600 font-semibold' };
  return { text: nice, cls: 'text-gray-400' };
}

export default function TasksContent() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [filterAssignee, setFilterAssignee] = useState('');

  // New-task form
  const [nTitle, setNTitle] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nAssignee, setNAssignee] = useState('');
  const [nDue, setNDue] = useState('');
  const [nPriority, setNPriority] = useState<Priority>('medium');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.tasks)) setTasks(d.tasks); setLoaded(true); })
      .catch(() => { setError('Could not load tasks'); setLoaded(true); });
  }, []);

  const assignees = useMemo(
    () => Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean) as string[])).sort(),
    [tasks]
  );

  const visible = useMemo(
    () => filterAssignee ? tasks.filter(t => (t.assignee || '') === filterAssignee) : tasks,
    [tasks, filterAssignee]
  );

  async function api(method: string, body?: Record<string, unknown>, query?: string) {
    setError(null);
    try {
      const res = await fetch(`/api/tasks${query || ''}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Request failed');
      if (Array.isArray(d.tasks)) setTasks(d.tasks);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    }
  }

  async function createTask() {
    if (!nTitle.trim()) return;
    setSaving(true);
    const ok = await api('POST', {
      title: nTitle, description: nDesc, assignee: nAssignee, dueDate: nDue, priority: nPriority,
    });
    setSaving(false);
    if (ok) {
      setNTitle(''); setNDesc(''); setNDue(''); setNPriority('medium');
      setAdding(false);
    }
  }

  function moveTask(id: string, status: TaskStatus) {
    // Optimistic: reflect the move instantly, persist behind it.
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    api('PUT', { id, status });
  }

  async function updateTask(id: string, fields: Record<string, unknown>) {
    await api('PUT', { id, ...fields });
  }

  async function deleteTask(id: string) {
    if (!confirm('Delete this task?')) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    await api('DELETE', undefined, `?id=${encodeURIComponent(id)}`);
  }

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const overdueCount = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < todayStr()).length;

  return (
    <div>
      <Header title="Tasks" subtitle={`Internal task board · ${tasks.length - doneCount} open${overdueCount ? ` · ${overdueCount} overdue` : ''}`}>
        <button
          onClick={() => setAdding(a => !a)}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {adding ? 'Close' : '+ New task'}
        </button>
      </Header>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      {/* ── New task form ── */}
      {adding && (
        <div className="bg-white border border-violet-200 rounded-2xl p-4 mb-5 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              autoFocus
              value={nTitle}
              onChange={e => setNTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTask(); }}
              placeholder="Task title *"
              className="sm:col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <textarea
              value={nDesc}
              onChange={e => setNDesc(e.target.value)}
              placeholder="Details (optional)"
              rows={2}
              className="sm:col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <input
              value={nAssignee}
              onChange={e => setNAssignee(e.target.value)}
              placeholder="Assignee"
              list="task-assignees"
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <datalist id="task-assignees">
              {assignees.map(a => <option key={a} value={a} />)}
            </datalist>
            <input
              type="date"
              value={nDue}
              onChange={e => setNDue(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <div className="flex items-center gap-2 sm:col-span-2">
              {(['high', 'medium', 'low'] as Priority[]).map(p => (
                <button
                  key={p}
                  onClick={() => setNPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${nPriority === p ? PRIORITY_META[p].chip : 'bg-white text-gray-400 border-gray-200'}`}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
              <button
                onClick={createTask}
                disabled={saving || !nTitle.trim()}
                className="ml-auto px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl"
              >
                {saving ? 'Adding…' : 'Add task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assignee filter ── */}
      {assignees.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilterAssignee('')}
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${!filterAssignee ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200'}`}
          >
            Everyone
          </button>
          {assignees.map(a => (
            <button
              key={a}
              onClick={() => setFilterAssignee(f => f === a ? '' : a)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${filterAssignee === a ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200'}`}
            >
              {a}
            </button>
          ))}
        </div>
      )}

      {/* ── Board ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {COLUMNS.map(col => {
          const colTasks = visible
            .filter(t => t.status === col.key)
            .sort((a, b) => {
              // Overdue/soonest due first, then priority, then position.
              const pd = { high: 0, medium: 1, low: 2 };
              return (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
                || pd[a.priority] - pd[b.priority]
                || a.order - b.order;
            });
          return (
            <div
              key={col.key}
              onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver(o => (o === col.key ? null : o))}
              onDrop={e => {
                e.preventDefault();
                setDragOver(null);
                if (dragId) { moveTask(dragId, col.key); setDragId(null); }
              }}
              className={`rounded-2xl border-2 p-3 min-h-[160px] transition-colors ${col.bg} ${dragOver === col.key ? 'border-violet-300' : 'border-transparent'}`}
              style={{ borderTopColor: col.accent, borderTopWidth: 3 }}
            >
              <div className="flex items-center justify-between px-1 mb-2">
                <h2 className="text-sm font-bold text-gray-700">{col.label}</h2>
                <span className="text-xs font-semibold text-gray-400 bg-white rounded-full px-2 py-0.5 border border-gray-100">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map(t => {
                  const due = dueMeta(t.dueDate, t.status);
                  const isOpen = expanded === t.id;
                  const colIdx = COLUMNS.findIndex(c => c.key === col.key);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      className={`bg-white rounded-xl border border-gray-100 shadow-sm p-3 cursor-grab active:cursor-grabbing ${dragId === t.id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_META[t.priority].dot }} title={`${PRIORITY_META[t.priority].label} priority`} />
                        <button onClick={() => setExpanded(isOpen ? null : t.id)} className="text-left flex-1">
                          <p className={`text-sm font-semibold ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.title}</p>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 pl-4 flex-wrap">
                        {t.assignee && (
                          <span className="text-[11px] font-semibold bg-violet-50 text-violet-700 border border-violet-100 rounded-full px-2 py-0.5">{t.assignee}</span>
                        )}
                        {due && <span className={`text-[11px] ${due.cls}`}>📅 {due.text}</span>}
                      </div>

                      {isOpen && (
                        <div className="mt-2 pl-4 space-y-2">
                          {t.description && <p className="text-xs text-gray-500 whitespace-pre-wrap">{t.description}</p>}
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              defaultValue={t.assignee || ''}
                              placeholder="Assignee"
                              list="task-assignees"
                              onBlur={e => { if (e.target.value !== (t.assignee || '')) updateTask(t.id, { assignee: e.target.value }); }}
                              className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-300"
                            />
                            <input
                              type="date"
                              defaultValue={t.dueDate || ''}
                              onBlur={e => { if (e.target.value !== (t.dueDate || '')) updateTask(t.id, { dueDate: e.target.value }); }}
                              className="px-2 py-1 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-300"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            {(['high', 'medium', 'low'] as Priority[]).map(p => (
                              <button
                                key={p}
                                onClick={() => updateTask(t.id, { priority: p })}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${t.priority === p ? PRIORITY_META[p].chip : 'bg-white text-gray-300 border-gray-100'}`}
                              >
                                {PRIORITY_META[p].label}
                              </button>
                            ))}
                            <button
                              onClick={() => deleteTask(t.id)}
                              className="ml-auto text-[11px] text-gray-300 hover:text-red-500 font-semibold"
                            >
                              Delete
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-300">
                            Added {new Date(t.createdAt).toLocaleDateString()}{t.createdBy ? ` by ${t.createdBy}` : ''}
                            {t.completedAt ? ` · done ${new Date(t.completedAt).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                      )}

                      {/* Mobile / no-drag move buttons */}
                      <div className="flex items-center gap-1.5 mt-2 pl-4">
                        {colIdx > 0 && (
                          <button
                            onClick={() => moveTask(t.id, COLUMNS[colIdx - 1].key)}
                            className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1"
                          >
                            ← {COLUMNS[colIdx - 1].label.replace(/^\S+\s/, '')}
                          </button>
                        )}
                        {colIdx < COLUMNS.length - 1 && (
                          <button
                            onClick={() => moveTask(t.id, COLUMNS[colIdx + 1].key)}
                            className="text-[11px] font-semibold text-violet-600 hover:text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-2 py-1 ml-auto"
                          >
                            {COLUMNS[colIdx + 1].label.replace(/^\S+\s/, '')} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {loaded && !colTasks.length && (
                  <p className="text-xs text-gray-300 text-center py-6">{col.key === 'todo' ? 'No tasks — add one above' : 'Nothing here'}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-400 mt-4">
        Drag cards between columns (or use the move buttons on mobile). Tap a title to edit details. Tasks are
        shared with the whole team and saved to your Sheet.
      </p>
    </div>
  );
}
