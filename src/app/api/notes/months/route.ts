import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Monthly performance log — one free-form note per month ("what happened in
// August": launches, stockouts, ad account issues, promos, PR hits…) so a
// revenue move up or down always has its story next to it.

export interface MonthNote { text: string; updatedAt: string; author?: string }
type NotesMap = Record<string, MonthNote>;

const DOC = 'month_notes';

async function load(): Promise<NotesMap> {
  try {
    const raw = await loadDoc(DOC);
    return raw ? (JSON.parse(raw) as NotesMap) : {};
  } catch {
    return {};
  }
}

export async function GET() {
  return NextResponse.json({ notes: await load() });
}

export async function PUT(req: NextRequest) {
  let author: string | undefined;
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Sign in to edit notes' }, { status: 401 });
    author = session.user.name || session.user.email || undefined;
  }
  let body: { month?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  const text = String(body.text ?? '').slice(0, 6000).trim();

  try {
    const notes = await load();
    if (text) {
      notes[month] = { text, updatedAt: new Date().toISOString(), ...(author ? { author } : {}) };
    } else {
      delete notes[month];
    }
    await saveDoc(DOC, JSON.stringify(notes));
    return NextResponse.json({ ok: true, notes });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
