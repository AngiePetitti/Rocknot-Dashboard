import { NextResponse } from 'next/server';
import { getEvents, saveEvents, TYPE_COLORS, type MarketingEvent } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';

// One-time loader for the July–October product-release roadmap. Open
// /api/calendar/seed once and it inserts these into the Google Sheet (skipping
// any whose title already exists, so it's safe to hit more than once).
const MONTHS: Record<string, string[]> = {
  '2026-07-01': ['Eternity - Confetti', 'Max Belt Bag - Beige', 'Fringe Drop Earrings - Crystal, Gun, Champagne', 'Gali - Champ / Champ', 'Gali - Crystal / Ivory', 'Duo - Ivory Lace', 'Crystal Knot Bracelet Set - Champs', 'Rope Set - Champs'],
  '2026-08-01': ['Lyla - Blush', 'Confetti Maya', 'Ori Hobo - Off White', 'Underarm Bag - White / Black', 'Orea Necklace - Silver', 'Eden Anti Gold'],
  '2026-09-01': ['Underarm Bag - Blue', 'Lace - Cobalt Blue', 'Swing - Cobalt Blue', 'Ring Bag - Brown', 'Ring Bag - Black', 'Lace 20" - Amber / Crystal / Gun', 'Mag Crown 20" - Amber / Crystal / Gun', 'Chocolate Brown', 'Suede Duo'],
  '2026-10-01': ['Statement Strings', 'Metallic Blue - straps and eden', 'Denim Drawstring', 'Candles?'],
};
const BACKLOG = ['Faux Fur Bags', 'Large Transformer Tote', 'Rope and rhinestone bag', 'Guitar Straps', 'Candle sticks'];

export async function GET() {
  try {
    const existing = await getEvents();
    const have = new Set(existing.map(e => e.title.trim().toLowerCase()));
    const toAdd: MarketingEvent[] = [];
    const mk = (title: string, date: string, note: string) => {
      if (have.has(title.trim().toLowerCase())) return;
      toAdd.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title, date, type: 'launch', status: 'planned',
        description: note, color: TYPE_COLORS.launch,
      });
      have.add(title.trim().toLowerCase());
    };
    for (const [date, items] of Object.entries(MONTHS)) for (const t of items) mk(t, date, 'Placeholder date — set exact release date');
    for (const t of BACKLOG) mk(t, '', 'Backlog — unscheduled, no month yet');

    if (toAdd.length) await saveEvents([...existing, ...toAdd]);
    return NextResponse.json({ added: toAdd.length, skipped: (Object.values(MONTHS).flat().length + BACKLOG.length) - toAdd.length, totalNow: existing.length + toAdd.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
