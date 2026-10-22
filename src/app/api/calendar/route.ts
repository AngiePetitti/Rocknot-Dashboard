import { NextRequest, NextResponse } from 'next/server';
import { getEvents, saveEvents, TYPE_COLORS, type MarketingEvent } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

// Re-export the type so existing imports (`@/src/app/api/calendar/route`) work.
export type { MarketingEvent } from '@/src/lib/calendarStore';

export async function GET() {
  try {
    const events = await getEvents();
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json({ error: String(err), events: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<MarketingEvent> & { events?: Partial<MarketingEvent>[] };
    // Batch mode ({ events: [...] }): one load-modify-save for the whole list,
    // because parallel single posts to the sheet-backed store clobber each other.
    const inputs = Array.isArray(body.events) ? body.events : [body];
    const bad = inputs.find(e => !e.title || !e.date || !e.type);
    if (bad || !inputs.length) {
      return NextResponse.json({ error: 'title, date, and type are required for every event' }, { status: 400 });
    }
    const events = await getEvents();
    const created: MarketingEvent[] = inputs.map(e => ({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: e.title!,
      date: e.date!,
      endDate: e.endDate,
      type: e.type!,
      channel: e.channel,
      status: e.status || 'planned',
      description: e.description,
      color: e.color || TYPE_COLORS[e.type!],
    }));
    events.push(...created);
    await saveEvents(events);
    return NextResponse.json(Array.isArray(body.events) ? { events: created, created: created.length } : { event: created[0] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
