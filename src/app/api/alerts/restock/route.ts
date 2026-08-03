import { NextRequest, NextResponse } from 'next/server';
import { getReorders } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Monday-morning restock alert. Triggered by Vercel Cron (vercel.json) with
// Authorization: Bearer <CRON_SECRET> — the middleware admits that token.
// Builds the same "To Order This Monday" list the Inventory tab shows and
// posts it to Slack via SLACK_RESTOCK_WEBHOOK_URL (a Slack incoming webhook).
// Visiting it logged-in as an admin with ?test=1 sends a test post.

interface InvItem {
  product: string; variant: string; status: string;
  dailyVelocity: number; daysRemaining: number | null; reorderQty: number; currentStock: number;
}

export async function GET(req: NextRequest) {
  const webhook = (process.env.SLACK_RESTOCK_WEBHOOK_URL || '').trim();
  if (!webhook) {
    return NextResponse.json({ error: 'SLACK_RESTOCK_WEBHOOK_URL not configured — create a Slack incoming webhook and add it to Vercel.' }, { status: 500 });
  }

  // Reuse the inventory API (forward whatever auth admitted this request).
  const invRes = await fetch(`${req.nextUrl.origin}/api/windsor/inventory`, {
    cache: 'no-store',
    headers: {
      cookie: req.headers.get('cookie') || '',
      authorization: req.headers.get('authorization') || '',
    },
  });
  const inv = await invRes.json().catch(() => null);
  if (inv?.source !== 'shopify_live') {
    return NextResponse.json({ error: 'Inventory data unavailable', detail: inv?.error || invRes.status }, { status: 502 });
  }

  // Bags are tracked separately from the SKU list — include both pools,
  // matching the Inventory tab's order banner.
  const items = [...((inv.bags as InvItem[]) ?? []), ...((inv.items as InvItem[]) ?? [])];
  const reorders = await getReorders().catch(() => []);
  const onOrder = new Set(
    reorders.filter(r => r.status === 'open').map(r => `${r.product}|${r.variant}`.toLowerCase())
  );

  // Same rule as the Inventory tab's "restock now": real movers that are out
  // or nearly out — minus anything already on order.
  const toOrder = items
    .filter(i => i.dailyVelocity >= 0.25 && (i.status === 'out_of_stock' || i.status === 'critical'))
    .filter(i => !onOrder.has(`${i.product}|${i.variant}`.toLowerCase()))
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity);

  const openOrders = reorders.filter(r => r.status === 'open');
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' });

  let text: string;
  if (toOrder.length === 0) {
    text = `*📦 Rocknot Monday Restock — ${today}*\n\n✅ Nothing needs ordering this week — all fast sellers are stocked or already on order.`;
  } else {
    const lines = toOrder.map(i =>
      `• *${i.product}${i.variant ? ` – ${i.variant}` : ''}* — order *${i.reorderQty.toLocaleString()}* (${i.status === 'out_of_stock' ? 'OUT OF STOCK' : `${i.daysRemaining}d left`}, selling ~${Math.round(i.dailyVelocity * 7)}/wk)`
    );
    text = `*📦 Rocknot Monday Restock — ${today}*\n\n*${toOrder.length} item${toOrder.length !== 1 ? 's' : ''} to order this week* (quantities cover ~90 days at current pace):\n\n${lines.join('\n')}\n\n_Once ordered, log the quantity + date on the dashboard's Inventory tab so it drops off next week's list._`;
  }
  if (openOrders.length > 0) {
    text += `\n\n🚚 *Already on order (${openOrders.length}):* ${openOrders.map(r => `${r.product}${r.variant ? ` – ${r.variant}` : ''} ×${r.qty}${r.eta ? ` (expected ${r.eta})` : ` (ordered ${r.orderedDate})`}`).join(' · ')}`;
  }

  const slackRes = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!slackRes.ok) {
    return NextResponse.json({ error: `Slack webhook failed (${slackRes.status})` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, itemsToOrder: toOrder.length, openOrders: openOrders.length });
}
