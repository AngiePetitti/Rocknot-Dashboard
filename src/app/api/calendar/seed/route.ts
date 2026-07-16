import { NextResponse } from 'next/server';
import { getEvents, saveEvents, TYPE_COLORS, MarketingEvent } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

// One-time seed: August & September 2026 product launches (dates TBD — parked
// on the 1st of each month until real dates are set). Idempotent: skips any
// event whose title already exists. Remove this route after running it.

const LAUNCHES: { title: string; month: '2026-08' | '2026-09' }[] = [
  // AUG
  { title: 'Lyla - Blush', month: '2026-08' },
  { title: 'Underarm Bag - White / Black', month: '2026-08' },
  { title: 'Confetti Maya', month: '2026-08' },
  { title: 'Ori Hobo - Off White', month: '2026-08' },
  { title: 'Orea Necklace - Silver', month: '2026-08' },
  { title: 'New Straw - Champagne', month: '2026-08' },
  { title: 'New Straw - Black / Gun', month: '2026-08' },
  { title: 'Eden Anti Gold', month: '2026-08' },
  // SEPT
  { title: 'Underarm Bag - Blue', month: '2026-09' },
  { title: 'Lace - Cobalt Blue', month: '2026-09' },
  { title: 'Swing - Cobalt Blue', month: '2026-09' },
  { title: 'Ring Bag - Brown', month: '2026-09' },
  { title: 'Ring Bag - Black', month: '2026-09' },
  { title: 'Lace 20" - Amber / Crystal / Gun', month: '2026-09' },
  { title: 'Mag Crown 20" - Amber / Crystal / Gun', month: '2026-09' },
  { title: 'Chocolate Brown Suede Duo', month: '2026-09' },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function GET() {
  try {
    const events = await getEvents();
    const existing = new Set(events.map(e => norm(e.title)));
    const added: string[] = [];
    const skipped: string[] = [];

    for (const l of LAUNCHES) {
      if (existing.has(norm(l.title))) { skipped.push(l.title); continue; }
      const monthName = l.month === '2026-08' ? 'August' : 'September';
      const ev: MarketingEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: l.title,
        date: `${l.month}-01`,
        type: 'launch',
        status: 'planned',
        description: `${monthName} launch — date TBD`,
        color: TYPE_COLORS.launch,
      };
      events.push(ev);
      existing.add(norm(l.title));
      added.push(l.title);
    }

    if (added.length) await saveEvents(events);

    // Show what else sits in Aug/Sept so stale plans are easy to spot.
    const augSept = events
      .filter(e => e.date >= '2026-08-01' && e.date <= '2026-09-30')
      .map(e => `${e.date}: ${e.title} (${e.type}${e.status ? ', ' + e.status : ''})`)
      .sort();

    return NextResponse.json({ added: added.length, addedTitles: added, skipped, augSeptOnCalendar: augSept });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
