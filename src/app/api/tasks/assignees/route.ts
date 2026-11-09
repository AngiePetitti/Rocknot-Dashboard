import { NextRequest, NextResponse } from 'next/server';
import { getKV, getKVStrict, setKV } from '@/src/lib/chatStore';
import { getClient } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

// Team member names for the Tasks tab's assignee dropdown — saved once, then
// pickable forever. Core team members are baked in per client so their chips
// survive even if the stored list is ever lost; removing one is remembered in
// a separate "removed" key rather than by editing the defaults.

const DEFAULT_TEAM: Record<string, string[]> = {
  rocknot: ['Angie', 'Celine', 'Design', 'Eleazar', 'Retention'],
};

function defaults(): string[] {
  return DEFAULT_TEAM[getClient().id] || [];
}

async function readList(key: string, strict: boolean): Promise<string[]> {
  const raw = strict ? await getKVStrict(key) : await getKV(key).catch(() => null);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function merge(saved: string[], removed: string[]): string[] {
  const gone = new Set(removed.map(n => n.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...defaults(), ...saved]) {
    const k = n.toLowerCase();
    if (gone.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export async function GET() {
  const [saved, removed] = await Promise.all([
    readList('task_assignees', false),
    readList('task_assignees_removed', false),
  ]);
  return NextResponse.json({ assignees: merge(saved, removed) });
}

export async function POST(req: NextRequest) {
  const { name } = await req.json().catch(() => ({}));
  const clean = String(name || '').slice(0, 60).trim();
  if (!clean) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  // Writers must never save over a failed read — a Sheets 429 would otherwise
  // come back as an "empty" list and the write would wipe every saved name.
  let saved: string[], removed: string[];
  try {
    [saved, removed] = await Promise.all([
      readList('task_assignees', true),
      readList('task_assignees_removed', true),
    ]);
  } catch {
    return NextResponse.json({ error: 'Storage is busy — try again in a moment' }, { status: 503 });
  }
  if (!saved.some(n => n.toLowerCase() === clean.toLowerCase())) {
    saved.push(clean);
    saved.sort((a, b) => a.localeCompare(b));
    await setKV('task_assignees', JSON.stringify(saved));
  }
  const stillRemoved = removed.filter(n => n.toLowerCase() !== clean.toLowerCase());
  if (stillRemoved.length !== removed.length) {
    await setKV('task_assignees_removed', JSON.stringify(stillRemoved));
    removed = stillRemoved;
  }
  return NextResponse.json({ ok: true, assignees: merge(saved, removed) });
}

export async function DELETE(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') || '').trim();
  let saved: string[], removed: string[];
  try {
    [saved, removed] = await Promise.all([
      readList('task_assignees', true),
      readList('task_assignees_removed', true),
    ]);
  } catch {
    return NextResponse.json({ error: 'Storage is busy — try again in a moment' }, { status: 503 });
  }
  const list = saved.filter(n => n.toLowerCase() !== name.toLowerCase());
  if (list.length !== saved.length) await setKV('task_assignees', JSON.stringify(list));
  if (name && defaults().some(n => n.toLowerCase() === name.toLowerCase()) &&
      !removed.some(n => n.toLowerCase() === name.toLowerCase())) {
    removed = [...removed, name];
    await setKV('task_assignees_removed', JSON.stringify(removed));
  }
  return NextResponse.json({ ok: true, assignees: merge(list, removed) });
}
