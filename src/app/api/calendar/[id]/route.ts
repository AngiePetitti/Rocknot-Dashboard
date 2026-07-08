import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import type { MarketingEvent } from '../route';

export const dynamic = 'force-dynamic';

const KEY = 'marketing_calendar_events';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<MarketingEvent>;
    const events = (await kv.get<MarketingEvent[]>(KEY)) || [];
    const idx = events.findIndex(e => e.id === params.id);
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    events[idx] = { ...events[idx], ...body, id: params.id };
    await kv.set(KEY, events);
    return NextResponse.json({ event: events[idx] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const events = (await kv.get<MarketingEvent[]>(KEY)) || [];
    const filtered = events.filter(e => e.id !== params.id);
    await kv.set(KEY, filtered);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
