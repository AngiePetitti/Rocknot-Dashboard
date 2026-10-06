import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { loadDoc } from '@/src/lib/docStore';
import { getKV, setKV, isChatStoreConfigured } from '@/src/lib/chatStore';
import { notifyUser, assigneeMatches, pushConfigured } from '@/src/lib/push';
import { getClient } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

// Morning task digest for the signed-in person: "N overdue · M due today",
// once per day. Triggered by the dashboard on its first load of the day
// (no server-side scheduler needed).
export async function POST(req: NextRequest) {
  if (!authConfigured()) return NextResponse.json({ ok: false, reason: 'auth not configured' });
  const s = await getServerSession(authOptions);
  const email = s?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!pushConfigured() || !isChatStoreConfigured()) return NextResponse.json({ ok: false, reason: 'push not configured' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const marker = `push_digest_${today}_${email}`;
  try { if (await getKV(marker)) return NextResponse.json({ ok: true, alreadySent: true }); } catch { /* send anyway */ }
  let tasks: Array<{ title: string; status: string; assignee?: string; dueDate?: string }> = [];
  try { const raw = await loadDoc('tasks'); tasks = raw ? JSON.parse(raw) : []; } catch { tasks = []; }
  const mine = tasks.filter(t => t.status !== 'done' && t.assignee && assigneeMatches(t.assignee, s?.user?.name || undefined, email));
  const overdue = mine.filter(t => t.dueDate && t.dueDate < today);
  const dueToday = mine.filter(t => t.dueDate === today);
  if (!overdue.length && !dueToday.length) { await setKV(marker, 'none').catch(() => {}); return NextResponse.json({ ok: true, nothingDue: true }); }
  const parts = [overdue.length ? `${overdue.length} overdue` : '', dueToday.length ? `${dueToday.length} due today` : ''].filter(Boolean).join(' · ');
  const first = [...overdue, ...dueToday][0];
  const sent = await notifyUser(email, 'tasks', {
    title: `${getClient().name}: ${parts}`,
    body: first ? `${first.title}${[...overdue, ...dueToday].length > 1 ? ` and ${[...overdue, ...dueToday].length - 1} more` : ''}` : parts,
    url: `${req.nextUrl.origin}/dashboard/tasks`, tag: `digest-${today}`,
  });
  await setKV(marker, String(sent)).catch(() => {});
  return NextResponse.json({ ok: true, sent, overdue: overdue.length, dueToday: dueToday.length });
}
