import { NextRequest, NextResponse } from 'next/server';
import { getEvents, saveEvents, type MarketingEvent } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<MarketingEvent>;
    const events = await getEvents();
    const idx = events.findIndex(e => e.id === params.id);
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    events[idx] = { ...events[idx], ...body, id: params.id };
    await saveEvents(events);
    return NextResponse.json({ event: events[idx] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const events = await getEvents();
    const filtered = events.filter(e => e.id !== params.id);
    await saveEvents(filtered);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
