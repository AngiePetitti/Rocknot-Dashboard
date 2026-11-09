import { NextRequest, NextResponse } from 'next/server';
import { getKV, getKVStrict, setKV } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// Team member names for the Tasks tab's assignee dropdown — saved once, then
// pickable forever.

async function read(): Promise<string[]> {
  const raw = await getKV('task_assignees').catch(() => null);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

// Writers must never save over a failed read — a Sheets 429 would otherwise
// come back as an "empty" list and the write would wipe every saved name.
async function readStrict(): Promise<string[]> {
  const raw = await getKVStrict('task_assignees');
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function GET() {
  return NextResponse.json({ assignees: await read() });
}

export async function POST(req: NextRequest) {
  const { name } = await req.json().catch(() => ({}));
  const clean = String(name || '').slice(0, 60).trim();
  if (!clean) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  let list: string[];
  try { list = await readStrict(); } catch {
    return NextResponse.json({ error: 'Storage is busy — try again in a moment' }, { status: 503 });
  }
  if (!list.some(n => n.toLowerCase() === clean.toLowerCase())) {
    list.push(clean);
    list.sort((a, b) => a.localeCompare(b));
    await setKV('task_assignees', JSON.stringify(list));
  }
  return NextResponse.json({ ok: true, assignees: list });
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') || '';
  let stored: string[];
  try { stored = await readStrict(); } catch {
    return NextResponse.json({ error: 'Storage is busy — try again in a moment' }, { status: 503 });
  }
  const list = stored.filter(n => n.toLowerCase() !== name.toLowerCase());
  await setKV('task_assignees', JSON.stringify(list));
  return NextResponse.json({ ok: true, assignees: list });
}
