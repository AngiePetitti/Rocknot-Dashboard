import { NextRequest, NextResponse } from 'next/server';
import { saveDoc, loadDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Lifecycle + test notes for creative briefs, keyed by brief id.
// status: new (default) | skipped | production | completed
export interface BriefStatus { status?: string; notes?: string; updatedAt?: string }

export async function GET() {
  try {
    const raw = await loadDoc('brief_statuses');
    return NextResponse.json({ statuses: raw ? JSON.parse(raw) : {} });
  } catch {
    return NextResponse.json({ statuses: {} });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const raw = await loadDoc('brief_statuses');
    const statuses: Record<string, BriefStatus> = raw ? JSON.parse(raw) : {};
    const cur = statuses[id] || {};
    if (typeof body.status === 'string' && ['new', 'skipped', 'production', 'completed'].includes(body.status)) {
      cur.status = body.status;
    }
    if (typeof body.notes === 'string') cur.notes = body.notes.slice(0, 4000);
    cur.updatedAt = new Date().toISOString();
    statuses[id] = cur;
    await saveDoc('brief_statuses', JSON.stringify(statuses));
    return NextResponse.json({ ok: true, statuses });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
