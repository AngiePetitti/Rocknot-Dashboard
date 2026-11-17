import { NextRequest, NextResponse } from 'next/server';
import { backInStockEmail, commitDetection, detectRestocks, emailConfigured, loadStock, ownerEmails, sendEmail, DEFAULT_RESERVE_WEEKS } from '@/src/lib/wholesaleRelease';
import { isChatStoreConfigured } from '@/src/lib/chatStore';
import { showrooms } from '@/src/lib/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Daily back-in-stock alert (Vercel Cron, vercel.json, Bearer CRON_SECRET).
// Emails the owners every item that was out of stock on the previous run and
// has units today, with the quantity, its sales pace, the DTC hold and what
// could go to wholesale. Nothing is sent to the sales rep from here.
//   ?dry=1  → report what it would send, without emailing or saving.
export async function GET(req: NextRequest) {
  // The cron runs on every client's deployment; only brands with a wholesale showroom use it.
  if (!showrooms().length) return NextResponse.json({ ok: true, skipped: 'This dashboard has no wholesale showroom.' });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const to = ownerEmails();
  if (!dry && !(emailConfigured() && to.length)) {
    return NextResponse.json({ error: 'No recipients — set RESEND_API_KEY and BACK_IN_STOCK_EMAIL_TO (comma-separated) in Vercel.' }, { status: 500 });
  }
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'The dashboard\'s private sheet is not connected, so yesterday\'s stock cannot be remembered.' }, { status: 500 });
  try {
    const stock = await loadStock(req);
    const d = await detectRestocks(stock);
    const summary = { hadBaseline: d.hadBaseline, outOfStockNow: d.outNow.length, restocked: d.restocked.map(i => ({ product: i.product, variant: i.variant, stock: i.stock })) };
    if (dry) return NextResponse.json({ ok: true, dry: true, ...summary });
    // Email first: if it fails, the baseline stays put and tomorrow's run reports the same items.
    if (d.restocked.length) await sendEmail({ to, ...backInStockEmail(d.restocked, DEFAULT_RESERVE_WEEKS) });
    await commitDetection(d);
    return NextResponse.json({ ok: true, emailed: d.restocked.length > 0, ...summary });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
