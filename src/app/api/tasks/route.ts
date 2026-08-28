import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Internal task manager (Tasks tab) — Kanban board persisted in the Google
// Sheet via docStore. Whole-team read/write; each request loads, mutates and
// re-saves the list server-side so edits from two people don't clobber each
// other's unrelated tasks.

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;       // YYYY-MM-DD
  priority: 'low' | 'medium' | 'high';
  status: TaskStatus;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  completedAt?: string;
  order: number;          // position within its column
}

const DOC = 'tasks';
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'] as const;

async function load(): Promise<Task[]> {
  try {
    const raw = await loadDoc(DOC);
    const list = raw ? (JSON.parse(raw) as Task[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function requireUser(): Promise<{ author?: string } | NextResponse> {
  if (!authConfigured()) return {};
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Sign in to manage tasks' }, { status: 401 });
  return { author: session.user.name || session.user.email || undefined };
}

function clean(input: Record<string, unknown>): Partial<Task> {
  const out: Partial<Task> = {};
  if (typeof input.title === 'string') out.title = input.title.slice(0, 200).trim();
  if (typeof input.description === 'string') out.description = input.description.slice(0, 2000).trim();
  if (typeof input.assignee === 'string') out.assignee = input.assignee.slice(0, 60).trim();
  if (typeof input.dueDate === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate === '')) out.dueDate = input.dueDate;
  if (PRIORITIES.includes(input.priority as typeof PRIORITIES[number])) out.priority = input.priority as Task['priority'];
  if (STATUSES.includes(input.status as TaskStatus)) out.status = input.status as TaskStatus;
  if (typeof input.order === 'number' && Number.isFinite(input.order)) out.order = input.order;
  return out;
}

export async function GET() {
  const tasks = await load();
  return NextResponse.json({ tasks });
}

// Create
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const fields = clean(body);
  if (!fields.title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  try {
    const tasks = await load();
    const status = fields.status || 'todo';
    const now = new Date().toISOString();
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: fields.title,
      description: fields.description || undefined,
      assignee: fields.assignee || undefined,
      dueDate: fields.dueDate || undefined,
      priority: fields.priority || 'medium',
      status,
      createdAt: now,
      updatedAt: now,
      ...(auth.author ? { createdBy: auth.author } : {}),
      order: Math.max(0, ...tasks.filter(t => t.status === status).map(t => t.order + 1)),
    };
    tasks.push(task);
    await saveDoc(DOC, JSON.stringify(tasks));
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

// Update (move between columns, edit fields, reorder)
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const tasks = await load();
    const task = tasks.find(t => t.id === id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const fields = clean(body);
    const wasDone = task.status === 'done';
    Object.assign(task, fields, { updatedAt: new Date().toISOString() });
    if (fields.dueDate === '') task.dueDate = undefined;
    if (fields.assignee === '') task.assignee = undefined;
    if (task.status === 'done' && !wasDone) task.completedAt = new Date().toISOString();
    if (task.status !== 'done') task.completedAt = undefined;
    await saveDoc(DOC, JSON.stringify(tasks));
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

// Delete
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const tasks = (await load()).filter(t => t.id !== id);
    await saveDoc(DOC, JSON.stringify(tasks));
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
