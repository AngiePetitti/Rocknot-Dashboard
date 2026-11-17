import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { isRestricted } from '@/src/lib/access';
import { getClient } from '@/src/lib/client';
import { getKV, setKV } from '@/src/lib/chatStore';
import { DEFAULT_RESERVE_WEEKS, REP_EMAIL_KEY, ReleaseRow, emailConfigured, loadEvents, loadStock, ownerEmails, releaseEmail, saveEvents, sendEmail } from '@/src/lib/wholesaleRelease';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_RX = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

// Outside logins (agency partners, showroom sales) never reach this route:
// the middleware keeps them to their own tabs. The session check repeats it.
async function teamSession() {
  const session = await getServerSession(authOptions).catch(() => null);
  return { session, blocked: isRestricted(session?.user?.role) };
}

// Recently restocked items with today's stock and sales pace, for the review page.
export async function GET(req: NextRequest) {
  const { blocked } = await teamSession();
  if (blocked) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const [events, stock, repEmail] = await Promise.all([loadEvents(), loadStock(req), getKV(REP_EMAIL_KEY)]);
    const byKey = new Map(stock.map(i => [i.key, i]));
    const rows: ReleaseRow[] = events.map(e => ({ ...e, stock: byKey.get(e.key)?.stock ?? 0, weeklySales: byKey.get(e.key)?.weeklySales ?? 0 }));
    return NextResponse.json({
      rows, reserveWeeks: DEFAULT_RESERVE_WEEKS,
      rep: { name: getClient().showrooms?.[0]?.rep?.name || 'the sales rep', email: repEmail || '' },
      copied: ownerEmails(), emailReady: emailConfigured(),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) });
  }
}

// Send the revised list to the sales rep. Body: { to, note, items: [{ key, qty }] }.
export async function POST(req: NextRequest) {
  const { session, blocked } = await teamSession();
  if (blocked) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json() as { to?: string; note?: string; items?: Array<{ key?: string; qty?: number }> };
    const to = (body.to || '').trim().toLowerCase();
    if (!EMAIL_RX.test(to)) return NextResponse.json({ error: 'Enter the sales rep\'s email address.' }, { status: 400 });
    const wanted = new Map((body.items || []).filter(i => i.key && Number(i.qty) > 0).map(i => [String(i.key), Math.floor(Number(i.qty))]));
    if (!wanted.size) return NextResponse.json({ error: 'Choose at least one item with a quantity above zero.' }, { status: 400 });

    const [events, stock] = await Promise.all([loadEvents(), loadStock(req)]);
    const byKey = new Map(stock.map(i => [i.key, i]));
    // Only items on the review list, and never more than is on the shelf right now.
    const items = events.filter(e => wanted.has(e.key)).map(e => ({ key: e.key, product: e.product, variant: e.variant, qty: wanted.get(e.key)!, stock: byKey.get(e.key)?.stock ?? 0 }));
    const over = items.find(i => i.qty > i.stock);
    if (over) return NextResponse.json({ error: `${over.product}${over.variant ? ` (${over.variant})` : ''} has ${over.stock} on hand now, fewer than the ${over.qty} offered. Lower the quantity and send again.` }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: 'Those items are no longer on the review list.' }, { status: 400 });

    const repName = getClient().showrooms?.[0]?.rep?.name || 'there';
    const sender = session?.user?.email || undefined;
    await sendEmail({ to: [to], cc: ownerEmails().filter(e => e.toLowerCase() !== to), replyTo: sender, ...releaseEmail(items, String(body.note || '').slice(0, 2000), repName) });

    const now = new Date().toISOString();
    const sent = new Map(items.map(i => [i.key, i.qty]));
    // Bookkeeping after a delivered email: a failure here must not read as "not sent".
    let saved = true;
    try {
      await saveEvents(events.map(e => (sent.has(e.key) ? { ...e, releasedAt: now, releasedQty: sent.get(e.key) } : e)));
      await setKV(REP_EMAIL_KEY, to);
    } catch { saved = false; }
    return NextResponse.json({ ok: true, sent: items.length, to, saved });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
