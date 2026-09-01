import { NextRequest, NextResponse } from 'next/server';
import { getReorders, getDiscontinued } from '@/src/lib/chatStore';

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
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const emailTo = (process.env.RESTOCK_EMAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const emailFrom = (process.env.RESTOCK_EMAIL_FROM || 'Rocknot Dashboard <onboarding@resend.dev>').trim();
  if (!webhook && !(resendKey && emailTo.length)) {
    return NextResponse.json({
      error: 'No alert channel configured — set SLACK_RESTOCK_WEBHOOK_URL and/or RESEND_API_KEY + RESTOCK_EMAIL_TO in Vercel.',
    }, { status: 500 });
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
  const discontinued = await getDiscontinued().catch(() => []);
  // Fuzzy product+variant key — hand-logged PO names never byte-match
  // Shopify's strings (quotes, hyphens, "Default Title"). Same rule as the
  // Inventory tab.
  const normKey = (product: string, variant: string) => {
    const clean = (s: string) => s.toLowerCase().replace(/default title/g, '').replace(/[^a-z0-9]/g, '');
    return `${clean(product)}|${clean(variant)}`;
  };
  const incomingByKey = new Map<string, number>();
  for (const r of reorders.filter(r => r.status === 'open')) {
    const k = normKey(r.product, r.variant);
    incomingByKey.set(k, (incomingByKey.get(k) || 0) + r.qty);
  }
  const skipped = new Set(discontinued.map(d => normKey(d.product, d.variant)));

  // Same rule as the Inventory tab's order banner: real movers that are out
  // or nearly out, minus seasonal skips — with the recommended quantity
  // netted DOWN by units already on an open PO (fully covered items drop).
  const toOrder = items
    .filter(i => i.dailyVelocity >= 0.25 && (i.status === 'out_of_stock' || i.status === 'critical'))
    .filter(i => !skipped.has(normKey(i.product, i.variant)))
    .map(i => {
      const incoming = incomingByKey.get(normKey(i.product, i.variant)) || 0;
      return { ...i, incomingQty: incoming, reorderQty: Math.max(0, i.reorderQty - incoming) };
    })
    .filter(i => i.reorderQty > 0)
    .sort((a, b) => a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant, undefined, { numeric: true }));

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

  // Send to every configured channel; report each result.
  let slackOk: boolean | null = null;
  if (webhook) {
    const slackRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    slackOk = Boolean(slackRes?.ok);
  }

  let emailOk: boolean | null = null;
  let emailError: string | undefined;
  if (resendKey && emailTo.length) {
    // Same content as the Slack post, formatted for email.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = toOrder.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">${esc(i.product)}${i.variant ? ` — ${esc(i.variant)}` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#c2410c;font-weight:700">Order ${i.reorderQty.toLocaleString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#6b7280">${i.status === 'out_of_stock' ? 'OUT OF STOCK' : `${i.daysRemaining}d left`} · ~${Math.round(i.dailyVelocity * 7)}/wk</td>
      </tr>`).join('');
    const openHtml = openOrders.length
      ? `<p style="color:#1d4ed8;font-size:13px">🚚 Already on order: ${openOrders.map(r => `${esc(r.product)}${r.variant ? ` – ${esc(r.variant)}` : ''} ×${r.qty}${r.eta ? ` (expected ${r.eta})` : ''}`).join(' · ')}</p>`
      : '';
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto">
        <h2 style="color:#ea580c">📦 Rocknot Monday Restock — ${today}</h2>
        ${toOrder.length === 0
          ? '<p style="color:#16a34a;font-weight:600">✅ Nothing needs ordering this week — all fast sellers are stocked or already on order.</p>'
          : `<p style="color:#374151">${toOrder.length} item${toOrder.length !== 1 ? 's' : ''} to order this week (quantities cover ~90 days at current pace):</p>
             <table style="border-collapse:collapse;width:100%;font-size:13px">${rowsHtml}</table>
             <p style="color:#9ca3af;font-size:12px">Once ordered, log the quantity + dates on the dashboard's Inventory tab so it drops off next week's list.</p>`}
        ${openHtml}
        <p style="font-size:12px"><a href="https://rocknot-dashboard.vercel.app/dashboard/inventory" style="color:#7c3aed">Open the Inventory tab →</a></p>
      </div>`;
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: emailFrom,
        to: emailTo,
        subject: `📦 Monday Restock — ${toOrder.length === 0 ? 'nothing to order' : `${toOrder.length} item${toOrder.length !== 1 ? 's' : ''} to order`} (${today})`,
        html,
      }),
    }).catch(() => null);
    emailOk = Boolean(emailRes?.ok);
    if (emailRes && !emailRes.ok) emailError = await emailRes.text().catch(() => String(emailRes.status));
  }

  if (slackOk === false && emailOk !== true) {
    return NextResponse.json({ error: 'All configured channels failed', emailError }, { status: 502 });
  }
  return NextResponse.json({ ok: true, itemsToOrder: toOrder.length, openOrders: openOrders.length, slackOk, emailOk, emailError });
}
