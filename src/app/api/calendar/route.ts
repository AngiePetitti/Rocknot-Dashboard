import { NextRequest, NextResponse } from 'next/server';
import { getEvents, saveEvents, TYPE_COLORS, type MarketingEvent } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

// Re-export so existing imports (`@/src/app/api/calendar/route`) keep working.
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
    const body = await req.json() as Partial<MarketingEvent>;
    if (!body.title || !body.date || !body.type) {
      return NextResponse.json({ error: 'title, date, and type are required' }, { status: 400 });
    }

    const events = await getEvents();
    const newEvent: MarketingEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: body.title,
      date: body.date,
      endDate: body.endDate,
      type: body.type,
      description: body.description,
      color: body.color || TYPE_COLORS[body.type],
    };
    events.push(newEvent);
    await saveEvents(events);
    return NextResponse.json({ event: newEvent });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
