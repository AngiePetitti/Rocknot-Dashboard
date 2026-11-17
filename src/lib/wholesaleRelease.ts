// Back-in-stock → wholesale release.
//
//   1. A daily cron (/api/alerts/back-in-stock) compares today's inventory
//      with the list of items that were out of stock on the previous run and
//      emails the owners what came back, with quantities.
//   2. The owners open the Wholesale Release page, decide what (and how many
//      units) to open to wholesale, and send that revised list to the
//      showroom's sales rep.
//
// DTC comes first: every item holds back enough stock to cover the store's
// own sales for a number of weeks, and only the remainder is suggested for
// wholesale. The owners can change every quantity before anything is sent.
import type { NextRequest } from 'next/server';
import { getClient } from '@/src/lib/client';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

const SNAPSHOT_DOC = 'bis_out_of_stock';
const EVENTS_DOC = 'bis_restocks';
export const REP_EMAIL_KEY = 'wholesale_rep_email';
/** Restocks stay on the review page this long. */
const KEEP_DAYS = 30;

export const DEFAULT_RESERVE_WEEKS = (() => {
  const n = Number(process.env.WHOLESALE_DTC_RESERVE_WEEKS);
  return Number.isFinite(n) && n >= 0 ? n : 8;
})();

export interface StockItem { key: string; product: string; variant: string; stock: number; weeklySales: number }
export interface RestockEvent {
  key: string; product: string; variant: string;
  /** When the cron first saw it back (ISO). */
  detectedAt: string;
  /** Units on hand at that moment. */
  qty: number;
  /** Set once it has gone out to the sales rep. */
  releasedAt?: string; releasedQty?: number;
}
export interface ReleaseRow extends RestockEvent { stock: number; weeklySales: number }

/** Same fuzzy product+variant key the Inventory tab and Monday restock alert use. */
export function itemKey(product: string, variant: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/default title/g, '').replace(/[^a-z0-9]/g, '');
  return `${clean(product)}|${clean(variant)}`;
}
export const itemName = (i: { product: string; variant: string }) => `${i.product}${i.variant && !/^default title$/i.test(i.variant) ? ` — ${i.variant}` : ''}`;

/** Units held back for the store's own customers: N weeks of current sales, rounded up. */
export function dtcHold(weeklySales: number, reserveWeeks: number): number {
  return Math.ceil(Math.max(0, weeklySales) * Math.max(0, reserveWeeks));
}
/** What is left for wholesale after the DTC hold. */
export function wholesaleSuggestion(stock: number, weeklySales: number, reserveWeeks: number): number {
  return Math.max(0, Math.floor(stock) - dtcHold(weeklySales, reserveWeeks));
}

/** Current stock and sales pace for every item, from the Inventory tab's own API (forwarding the caller's auth). */
export async function loadStock(req: NextRequest): Promise<StockItem[]> {
  const res = await fetch(`${req.nextUrl.origin}/api/windsor/inventory`, {
    cache: 'no-store',
    headers: { cookie: req.headers.get('cookie') || '', authorization: req.headers.get('authorization') || '' },
  });
  const inv = await res.json().catch(() => null) as { source?: string; error?: string; items?: RawItem[]; bags?: RawItem[] } | null;
  if (inv?.source !== 'shopify_live') throw new Error(`Inventory data unavailable: ${inv?.error || `HTTP ${res.status}`}`);
  const out = new Map<string, StockItem>();
  // Bags first: Rocknot's bag-only listings hold the true physical bag counts.
  for (const i of [...(inv.bags ?? []), ...(inv.items ?? [])]) {
    const key = itemKey(i.product, i.variant);
    if (out.has(key)) continue;
    out.set(key, { key, product: i.product, variant: i.variant, stock: Number(i.currentStock) || 0, weeklySales: (Number(i.dailyVelocity) || 0) * 7 });
  }
  return Array.from(out.values());
}
interface RawItem { product: string; variant: string; currentStock: number; dailyVelocity: number }

async function loadJson<T>(doc: string): Promise<T | null> {
  const raw = await loadDoc(doc);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function loadEvents(): Promise<RestockEvent[]> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  return ((await loadJson<RestockEvent[]>(EVENTS_DOC)) || []).filter(e => e.detectedAt >= cutoff);
}
export async function saveEvents(events: RestockEvent[]): Promise<void> {
  await saveDoc(EVENTS_DOC, JSON.stringify(events));
}

export interface Detection {
  /** False on the very first run: there was nothing to compare with, so only the baseline is saved. */
  hadBaseline: boolean;
  restocked: StockItem[];
  outNow: string[];
}
/** Items that were out of stock on the previous run and have units today. Reads only. */
export async function detectRestocks(stock: StockItem[]): Promise<Detection> {
  const prev = await loadJson<{ at: string; keys: string[] }>(SNAPSHOT_DOC);
  const wasOut = new Set(prev?.keys || []);
  return {
    hadBaseline: Boolean(prev),
    restocked: stock.filter(i => i.stock > 0 && wasOut.has(i.key)).sort((a, b) => itemName(a).localeCompare(itemName(b), undefined, { numeric: true })),
    outNow: stock.filter(i => i.stock <= 0).map(i => i.key),
  };
}
/** Record this run: today's out-of-stock list becomes the baseline and the restocks join the review list. */
export async function commitDetection(d: Detection): Promise<void> {
  if (d.restocked.length) {
    const now = new Date().toISOString();
    const fresh = new Set(d.restocked.map(i => i.key));
    // A second restock of the same item replaces its earlier entry.
    const kept = (await loadEvents()).filter(e => !fresh.has(e.key));
    await saveEvents([...d.restocked.map(i => ({ key: i.key, product: i.product, variant: i.variant, detectedAt: now, qty: i.stock })), ...kept]);
  }
  await saveDoc(SNAPSHOT_DOC, JSON.stringify({ at: new Date().toISOString(), keys: d.outNow }));
}

// ── Email ────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const td = 'padding:8px 10px;border-bottom:1px solid #f1f5f9';
const th = 'padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:2px solid #e5e7eb';

/** The owners' addresses: BACK_IN_STOCK_EMAIL_TO, else the Monday restock list. */
export function ownerEmails(): string[] {
  return (process.env.BACK_IN_STOCK_EMAIL_TO || process.env.RESTOCK_EMAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
}
export function emailConfigured(): boolean { return Boolean((process.env.RESEND_API_KEY || '').trim()); }

export async function sendEmail(msg: { to: string[]; cc?: string[]; replyTo?: string; subject: string; html: string }): Promise<void> {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('Email is not set up — add RESEND_API_KEY in Vercel.');
  const from = (process.env.RESTOCK_EMAIL_FROM || `${getClient().alerts.fromName} <onboarding@resend.dev>`).trim();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: msg.to, ...(msg.cc?.length ? { cc: msg.cc } : {}), ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), subject: msg.subject, html: msg.html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`The email service refused the message: ${(await res.text().catch(() => '')).slice(0, 300) || `HTTP ${res.status}`}`);
}

const longDate = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' });

/** Internal alert: what came back, and how much of it DTC needs first. */
export function backInStockEmail(items: StockItem[], reserveWeeks: number): { subject: string; html: string } {
  const client = getClient();
  const rep = client.showrooms?.[0]?.rep?.name || 'the sales rep';
  const units = items.reduce((s, i) => s + i.stock, 0);
  const rows = items.map(i => {
    const hold = Math.min(i.stock, dtcHold(i.weeklySales, reserveWeeks));
    const offer = wholesaleSuggestion(i.stock, i.weeklySales, reserveWeeks);
    return `<tr>
      <td style="${td};font-weight:600;color:#1f2937">${esc(itemName(i))}</td>
      <td style="${td};text-align:right;font-weight:700;color:#047857">${i.stock.toLocaleString()}</td>
      <td style="${td};text-align:right;color:#6b7280">${i.weeklySales >= 0.05 ? `~${i.weeklySales.toFixed(1)}/wk` : 'no recent sales'}</td>
      <td style="${td};text-align:right;color:#6b7280">${hold.toLocaleString()}</td>
      <td style="${td};text-align:right;font-weight:700;color:${offer ? '#6d28d9' : '#9ca3af'}">${offer ? offer.toLocaleString() : 'keep for DTC'}</td>
    </tr>`;
  }).join('');
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;color:#374151">
    <h2 style="color:#047857;margin-bottom:4px">${esc(client.name)}: back in stock, ${esc(longDate())}</h2>
    <p style="margin-top:0">${items.length} item${items.length === 1 ? '' : 's'} came back in stock (${units.toLocaleString()} units). DTC is covered first: each item holds ${reserveWeeks} weeks of its current sales, and only what is left is suggested for wholesale.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr><th style="${th}">Item</th><th style="${th};text-align:right">On hand</th><th style="${th};text-align:right">Selling</th><th style="${th};text-align:right">Hold for DTC</th><th style="${th};text-align:right">Could open to wholesale</th></tr>
      ${rows}
    </table>
    <p style="margin:20px 0"><a href="${client.dashboardUrl}/dashboard/wholesale-release" style="background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px">Review and send to ${esc(rep)}</a></p>
    <p style="color:#9ca3af;font-size:12px">Nothing has been sent to ${esc(rep)}. On the review page you choose the items, change any quantity, and send the revised list.</p>
  </div>`;
  return { subject: `Back in stock: ${items.length} item${items.length === 1 ? '' : 's'}, ${units.toLocaleString()} units (${longDate()})`, html };
}

/** The revised list that goes to the sales rep: items and the units open to wholesale, nothing else. */
export function releaseEmail(items: Array<{ product: string; variant: string; qty: number }>, note: string, repName: string): { subject: string; html: string } {
  const client = getClient();
  const rows = items.map(i => `<tr>
      <td style="${td};font-weight:600;color:#1f2937">${esc(itemName(i))}</td>
      <td style="${td};text-align:right;font-weight:700;color:#1f2937">${i.qty.toLocaleString()}</td>
    </tr>`).join('');
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#374151">
    <h2 style="color:#111827;margin-bottom:4px">${esc(client.name)}: back in stock and open for wholesale</h2>
    <p style="margin-top:0">Hi ${esc(repName)}, these items are back and available to offer buyers. Quantities are the units open to wholesale as of ${esc(longDate())}; orders fill in the order they are written.</p>
    ${note.trim() ? `<p style="background:#f9fafb;border-radius:8px;padding:10px 12px;white-space:pre-line">${esc(note.trim())}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr><th style="${th}">Item</th><th style="${th};text-align:right">Units available</th></tr>
      ${rows}
    </table>
  </div>`;
  return { subject: `${client.name}: ${items.length} item${items.length === 1 ? '' : 's'} back in stock for wholesale (${longDate()})`, html };
}
