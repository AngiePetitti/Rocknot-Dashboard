import { NextRequest, NextResponse } from 'next/server';
import { getKV, setKV } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// Team member names for the Tasks tab's assignee dropdown — saved once, then
// pickable forever.

async function read(): Promise<string[]> {
  const raw = await getKV('task_assignees').catch(() => null);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function GET() {
  return NextResponse.json({ assignees: await read() });
}

export async function POST(req: NextRequest) {
  const { name } = await req.json().catch(() => ({}));
  const clean = String(name || '').slice(0, 60).trim();
  if (!clean) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  const list = await read();
  if (!list.some(n => n.toLowerCase() === clean.toLowerCase())) {
    list.push(clean);
    list.sort((a, b) => a.localeCompare(b));
    await setKV('task_assignees', JSON.stringify(list));
  }
  return NextResponse.json({ ok: true, assignees: list });
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') || '';
  const list = (await read()).filter(n => n.toLowerCase() !== name.toLowerCase());
  await setKV('task_assignees', JSON.stringify(list));
  return NextResponse.json({ ok: true, assignees: list });
}
