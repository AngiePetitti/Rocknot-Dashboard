import { NextResponse } from 'next/server';
import { getEvents, saveEvents, TYPE_COLORS, MarketingEvent, EventType } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

// One-time seed: Sept–Nov 2026 launch plan (capsules + drops). Idempotent:
// skips any event whose title already exists. Also retires the old parked
// "date TBD" September placeholders this plan supersedes.
// Remove this route after running it.

const PLAN: { title: string; date: string; type?: EventType; description?: string }[] = [
  // SEPTEMBER
  {
    title: 'Cobalt Capsule',
    date: '2026-09-11',
    description: 'Capsule drop: Dalia Bag, Swing Strap, Lace Strap, Petite Crown Strap',
  },
  { title: 'Ro Sling Bag - Black', date: '2026-09-18' },
  {
    title: 'Ro Sling Bag - Brown + Amber drop',
    date: '2026-09-18',
    description: 'Date TBC: Sept 18 or Sept 25. Includes Amber Lace, Amber Chain, Amber Swing',
  },
  {
    title: 'Midnight Capsule components needed',
    date: '2026-09-30',
    type: 'deadline',
    description: 'Spiral 100 - 30" and Chain 100 - 30" needed by September for the November Midnight Capsule',
  },

  // OCTOBER
  {
    title: 'Chocolate Capsule',
    date: '2026-10-02',
    description: 'Capsule drop: Swing Strap, 20" Lace Strap, Chain Strap, Edge/Suede (TBC), Duo Suede Bag, Lia Rhinestone Shoulder Bag, Fia Suede Bag, Hezi Patent Bag, Ori Suede',
  },
  { title: 'Statement Strings', date: '2026-10-09' },
  {
    title: 'Mosaic Capsule',
    date: '2026-10-23',
    description: 'Capsule drop: Lia Rhinestone Shoulder Bag, Chain Strap, Magnum Crown, Suede Evy',
  },
  {
    title: 'Pink Sugar Capsule',
    date: '2026-10-30',
    description: 'Capsule drop: Eternity Strap, Eden Bag, Lace Strap, Chain Strap',
  },

  // NOVEMBER (dates TBD — parked on Nov 1)
  {
    title: 'Midnight Capsule',
    date: '2026-11-01',
    description: 'November launch — date TBD. Eternity Strap, Spiral 100 - 30" (need by Sept), Chain 100 - 30" (need by Sept), Eden Bag, Fia Denim, Patent Black Leather Fia',
  },
  {
    title: 'Red Drop',
    date: '2026-11-01',
    description: 'November launch — date TBD. Red Dalia, Swing Strap Red, Red Dutch',
  },
  {
    title: 'Metallic Duos',
    date: '2026-11-01',
    description: 'November — no confirmation yet',
  },
  {
    title: 'Shilo Cotton',
    date: '2026-11-01',
    description: 'November — no confirmation yet',
  },
];

// Old parked September placeholders this plan replaces (seeded earlier as
// "date TBD" on 2026-09-01).
const RETIRE = [
  'Underarm Bag - Blue',
  'Lace - Cobalt Blue',
  'Swing - Cobalt Blue',
  'Ring Bag - Brown',
  'Ring Bag - Black',
  'Lace 20" - Amber / Crystal / Gun',
  'Mag Crown 20" - Amber / Crystal / Gun',
  'Chocolate Brown Suede Duo',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function GET() {
  try {
    let events = await getEvents();

    // Retire the superseded Sept placeholders (only the TBD-parked ones).
    const retireSet = new Set(RETIRE.map(norm));
    const removed = events
      .filter(e => retireSet.has(norm(e.title)) && /date tbd/i.test(e.description || ''))
      .map(e => e.title);
    events = events.filter(e => !(retireSet.has(norm(e.title)) && /date tbd/i.test(e.description || '')));

    const existing = new Set(events.map(e => norm(e.title)));
    const added: string[] = [];
    const skipped: string[] = [];

    for (const l of PLAN) {
      if (existing.has(norm(l.title))) { skipped.push(l.title); continue; }
      const type: EventType = l.type || 'launch';
      const ev: MarketingEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: l.title,
        date: l.date,
        type,
        status: 'planned',
        description: l.description,
        color: TYPE_COLORS[type],
      };
      events.push(ev);
      existing.add(norm(l.title));
      added.push(l.title);
    }

    if (added.length || removed.length) await saveEvents(events);

    const seasonOnCalendar = events
      .filter(e => e.date >= '2026-09-01' && e.date <= '2026-11-30')
      .map(e => `${e.date}: ${e.title} (${e.type}${e.status ? ', ' + e.status : ''})`)
      .sort();

    return NextResponse.json({ added: added.length, addedTitles: added, removedOldPlaceholders: removed, skipped, seasonOnCalendar });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
