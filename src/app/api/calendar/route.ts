import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

export interface MarketingEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  type: 'deadline' | 'launch' | 'sale' | 'influencer' | 'content' | 'photo_shoot' | 'other';
  description?: string;
  color: string;
}

const KEY = 'marketing_calendar_events';

const TYPE_COLORS: Record<MarketingEvent['type'], string> = {
  deadline: '#ef4444',
  launch: '#8b5cf6',
  sale: '#f59e0b',
  influencer: '#ec4899',
  content: '#3b82f6',
  photo_shoot: '#06b6d4',
  other: '#6b7280',
};

export async function GET() {
  try {
    const events = (await kv.get<MarketingEvent[]>(KEY)) || [];
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

    const events = (await kv.get<MarketingEvent[]>(KEY)) || [];
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
    await kv.set(KEY, events);
    return NextResponse.json({ event: newEvent });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
