import { NextResponse } from 'next/server';
import { getReorders, addReorder } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// One-time seed: Orly's email confirmation (2026-09-01) + the Ran Feng
// packing slip dated 2026-08-28 (DHL, ~11 boxes, arriving this week).
// The slip's "Gali chain top Golden Shadow L/M/S ×24/25/25" are the three
// Champagne Bubbles entries ALREADY on the tracker — not repeated here.
// Idempotent: skips any product+variant that already has an open PO.
// Remove this route after running it.

const ETA_SLIP = '2026-09-05'; // "arriving this week"

const ORDERS: { product: string; variant: string; qty: number; orderedDate: string; orderedBy: string; eta?: string }[] = [
  // ── From the packing slip (in transit via DHL) ──
  { product: 'Crystal Stone Necklace', variant: 'Crystal · 29"', qty: 50, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Knot Necklace', variant: 'Golden Shadow · 13"', qty: 250, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Knot Necklace', variant: 'Golden Shadow · 16"', qty: 250, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Gali Chain Top', variant: 'Crystal / White Ribbon · L', qty: 18, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Gali Chain Top', variant: 'Crystal / White Ribbon · XL', qty: 15, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'EDGE STRAP', variant: 'Crystal / C154 · 36"', qty: 40, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'EDGE STRAP', variant: 'Crystal / C154 · 46"', qty: 40, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'EDGE STRAP', variant: 'Gunmetal / J5 · 36"', qty: 20, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'EDGE STRAP', variant: 'Gunmetal / J5 · 30"', qty: 20, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Petite Crown Strap', variant: 'Gunmetal · 56"', qty: 56, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'LACE STRAP', variant: 'Sapphire · 46"', qty: 11, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'LACE STRAP', variant: 'Sapphire · 30"', qty: 16, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },
  { product: 'Bow Key Chain', variant: 'Amethyst', qty: 40, orderedDate: '2026-08-28', orderedBy: 'packing slip', eta: ETA_SLIP },

  // ── Confirmed ordered by Orly (email, no packing slip yet — no ETA) ──
  { product: 'GEM Strap - Crystal', variant: '14" WRISTLET', qty: 96, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'Adhesive Phone Wallet', variant: 'Cream', qty: 87, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'Multi Strand Cuff Bracelet - Champagne Bubbles', variant: '6.5"', qty: 104, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'Multi Strand Necklace - Champagne Bubbles', variant: '20"', qty: 53, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'ZOE Tassel Necklace - Champagne Bubbles', variant: '', qty: 46, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'EDGE STRAP - Gunmetal / Camo', variant: '36" SHOULDER', qty: 26, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'CRYSTAL KNOT Necklace - Champagne Bubbles', variant: '16" (5" extender chain)', qty: 24, orderedDate: '2026-09-01', orderedBy: 'orly' },
  { product: 'LACE STRAP - Champagne Bubbles', variant: '30" SHOULDER', qty: 23, orderedDate: '2026-09-01', orderedBy: 'orly' },
  // Orly: "I ordered but not this much" — qty logged at the recommended 204;
  // EDIT this row to the real quantity when known.
  { product: 'Eternity Strap - Confetti', variant: '', qty: 204, orderedDate: '2026-09-01', orderedBy: 'orly (qty TBC — edit!)' },
  // Rolling production ("he's just making more of all constantly") — logged so
  // the order list nets them out; no ETA.
  { product: 'Gali Chain Top - Crystal / Black', variant: 'S', qty: 190, orderedDate: '2026-09-01', orderedBy: 'orly (rolling)' },
  { product: 'Gali Chain Top - Champagne Bubbles', variant: 'M', qty: 98, orderedDate: '2026-09-01', orderedBy: 'orly (rolling)' },
];

export async function GET() {
  try {
    const existing = await getReorders();
    const openKeys = new Set(
      existing.filter(r => r.status === 'open').map(r => `${r.product}|${r.variant}`.toLowerCase())
    );
    const added: string[] = [];
    const skipped: string[] = [];
    for (const o of ORDERS) {
      const key = `${o.product}|${o.variant}`.toLowerCase();
      if (openKeys.has(key)) { skipped.push(`${o.product} · ${o.variant}`); continue; }
      await addReorder(o);
      openKeys.add(key);
      added.push(`${o.product}${o.variant ? ` · ${o.variant}` : ''} ×${o.qty}`);
    }
    return NextResponse.json({ added: added.length, addedItems: added, skippedAlreadyOpen: skipped });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
