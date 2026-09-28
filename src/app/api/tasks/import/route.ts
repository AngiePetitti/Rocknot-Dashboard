import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { loadDoc, saveDoc } from '@/src/lib/docStore';
import { extractActionItems, ActionItem } from '@/src/lib/callNotes';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Call notes → tasks on THIS dashboard's board.
//   POST { notes, source?, callDate?, people?, dryRun: true }  → { items }      (preview)
//   POST { items, source?, callDate? }                          → { created }    (create the reviewed list)
//   POST { notes, source?, callDate? }                          → { created }    (extract + create in one go — the daily routine)
// Auth: a signed-in team member, or the CRON_SECRET bearer for the routine.

interface StoredTask {
  id: string; title: string; description?: string; assignee?: string; dueDate?: string;
  priority: 'low' | 'medium' | 'high'; status: 'todo' | 'in_progress' | 'done';
  createdAt: string; createdBy?: string; updatedAt: string; order: number;
}

async function authorFor(req: NextRequest): Promise<string | null | NextResponse> {
  const cron = (process.env.CRON_SECRET || '').trim();
  if (cron && req.headers.get('authorization') === `Bearer ${cron}`) return 'Call notes (auto)';
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Sign in to import tasks' }, { status: 401 });
  if (session.user.role === 'partner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return session.user.name || session.user.email || null;
}

export async function POST(req: NextRequest) {
  const author = await authorFor(req);
  if (author instanceof NextResponse) return author;
  const body = await req.json().catch(() => ({})) as {
    notes?: string; items?: ActionItem[]; source?: string; callDate?: string; people?: string[]; dryRun?: boolean;
  };
  const source = typeof body.source === 'string' ? body.source.slice(0, 120).trim() : '';
  const callDate = typeof body.callDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.callDate) ? body.callDate : '';

  try {
    let items: ActionItem[] = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      if (typeof body.notes !== 'string' || !body.notes.trim()) return NextResponse.json({ error: 'Paste the call notes first' }, { status: 400 });
      items = await extractActionItems(body.notes, { source, callDate, people: body.people });
      if (body.dryRun) return NextResponse.json({ items });
    }
    if (!items.length) return NextResponse.json({ created: [], note: 'No action items found in those notes.' });

    const raw = await loadDoc('tasks');
    const tasks: StoredTask[] = raw ? (JSON.parse(raw) as StoredTask[]) : [];
    const now = new Date().toISOString();
    let order = Math.max(0, ...tasks.map(t => t.order + 1));
    const from = source || callDate ? `From call${source ? `: ${source}` : ''}${callDate ? ` (${callDate})` : ''}` : '';
    const created: StoredTask[] = [];
    for (const it of items) {
      const title = String(it.title || '').slice(0, 200).trim();
      if (!title) continue;
      // Skip an open task with the same title — re-importing the same notes must not double up.
      if (tasks.some(t => t.status !== 'done' && t.title.toLowerCase() === title.toLowerCase())) continue;
      const t: StoredTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        description: [it.description, from].filter(Boolean).join('\n') || undefined,
        assignee: it.assignee || undefined,
        dueDate: it.dueDate || undefined,
        priority: it.priority === 'high' || it.priority === 'low' ? it.priority : 'medium',
        status: 'todo',
        createdAt: now, updatedAt: now, order: order++,
        ...(author ? { createdBy: author } : {}),
      };
      tasks.push(t); created.push(t);
    }
    await saveDoc('tasks', JSON.stringify(tasks));
    return NextResponse.json({ created, skipped: items.length - created.length });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
