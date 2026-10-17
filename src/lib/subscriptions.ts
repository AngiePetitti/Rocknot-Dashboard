// Subscriptions tab data. Loop's renewal orders land in Shopify as their own
// sales channel, so renewal revenue, renewal orders and subscribers renewing
// come straight from ShopifyQL — no Loop credentials needed. Active
// subscribers, cancellations and churn need Loop's own API (LOOP_API_TOKEN)
// and are reported as not yet connected until then.
import { shopifyql } from '@/src/lib/shopifyql';
import { getClient, storeOnlyWhere } from '@/src/lib/client';
import { todayPst } from '@/src/lib/timeframes';

const num = (v: string | undefined) => { const n = parseFloat(v || '0'); return Number.isFinite(n) ? n : 0; };
const lit = (s: string) => `'${s.replace(/'/g, "\\'")}'`;

export interface SubTotals {
  renewalRevenue: number;   // net sales of renewal orders
  renewalOrders: number;
  subscribersRenewing: number; // distinct customers with a renewal in the range
  avgRenewalValue: number;
  shareOfStoreNet: number;  // renewal net ÷ store net sales (0–1)
}
export interface SubMonth { month: string; renewalRevenue: number; renewalOrders: number; subscribers: number }
export type Direction = 'up' | 'down' | 'flat' | 'unknown';
export interface SubSignal { tone: 'good' | 'warn' | 'bad' | 'info'; title: string; detail: string }

export interface SubscriptionData {
  channel: string;
  range: { from: string; to: string };
  totals: SubTotals;
  prior: { range: { from: string; to: string }; totals: SubTotals } | null;
  monthly: SubMonth[];
  /** Last 3 complete months vs the 3 before, per measure. */
  trend: { revenue: Direction; revenuePct: number | null; subscribers: Direction; subscribersPct: number | null };
  signals: SubSignal[];
  loopConnected: boolean;
}

async function totalsFor(channel: string, from: string, to: string): Promise<SubTotals> {
  const where = storeOnlyWhere();
  const [subRows, storeRows] = await Promise.all([
    shopifyql(`FROM sales SHOW orders, net_sales, customers WHERE sales_channel = ${lit(channel)} SINCE ${from} UNTIL ${to}`, { timeoutMs: 15000 }),
    shopifyql(`FROM sales SHOW net_sales ${where} SINCE ${from} UNTIL ${to}`, { timeoutMs: 15000 }),
  ]);
  const r = subRows[0] || {};
  const renewalRevenue = num(r.net_sales);
  const renewalOrders = Math.round(num(r.orders));
  const storeNet = num((storeRows[0] || {}).net_sales);
  return {
    renewalRevenue: Math.round(renewalRevenue),
    renewalOrders,
    subscribersRenewing: Math.round(num(r.customers)),
    avgRenewalValue: renewalOrders > 0 ? Math.round((renewalRevenue / renewalOrders) * 100) / 100 : 0,
    shareOfStoreNet: storeNet > 0 ? renewalRevenue / storeNet : 0,
  };
}

function firstOfMonth(date: string, monthsBack: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

function direction(recent: number, earlier: number): { dir: Direction; pct: number | null } {
  if (earlier <= 0) return { dir: recent > 0 ? 'up' : 'unknown', pct: null };
  const pct = Math.round(((recent - earlier) / earlier) * 1000) / 10;
  return { dir: pct > 3 ? 'up' : pct < -3 ? 'down' : 'flat', pct };
}

export async function fetchSubscriptions(from: string, to: string, prior: { from: string; to: string } | null): Promise<SubscriptionData> {
  const cfg = getClient().subscriptions;
  if (!cfg) throw new Error('This dashboard has no subscription channel configured.');
  const today = todayPst();
  const since = firstOfMonth(today, 12);
  const [totals, priorTotals, monthRows] = await Promise.all([
    totalsFor(cfg.shopifyChannel, from, to),
    prior ? totalsFor(cfg.shopifyChannel, prior.from, prior.to) : Promise.resolve(null),
    shopifyql(`FROM sales SHOW orders, net_sales, customers WHERE sales_channel = ${lit(cfg.shopifyChannel)} TIMESERIES month SINCE ${since} UNTIL ${today}`, { timeoutMs: 15000 }),
  ]);
  const monthly: SubMonth[] = monthRows.map(r => ({
    month: String(r.month || r.day || '').slice(0, 7),
    renewalRevenue: Math.round(num(r.net_sales)),
    renewalOrders: Math.round(num(r.orders)),
    subscribers: Math.round(num(r.customers)),
  })).filter(m => m.month).sort((a, b) => a.month.localeCompare(b.month));

  // Trend: last 3 COMPLETE months against the 3 before them.
  const thisMonth = today.slice(0, 7);
  const complete = monthly.filter(m => m.month < thisMonth);
  const last3 = complete.slice(-3), prev3 = complete.slice(-6, -3);
  const sum = (xs: SubMonth[], k: 'renewalRevenue' | 'subscribers') => xs.reduce((s, m) => s + m[k], 0);
  const enough = last3.length === 3 && prev3.length === 3;
  const rev = enough ? direction(sum(last3, 'renewalRevenue'), sum(prev3, 'renewalRevenue')) : { dir: 'unknown' as Direction, pct: null };
  const subs = enough ? direction(sum(last3, 'subscribers'), sum(prev3, 'subscribers')) : { dir: 'unknown' as Direction, pct: null };

  const signals: SubSignal[] = [];
  if (rev.dir === 'up') signals.push({ tone: 'good', title: 'Renewal revenue is growing', detail: `Last 3 full months are up ${rev.pct}% on the 3 before.` });
  if (rev.dir === 'down') signals.push({ tone: 'bad', title: 'Renewal revenue is shrinking', detail: `Last 3 full months are down ${Math.abs(rev.pct ?? 0)}% on the 3 before — check cancellations and failed payments in Loop.` });
  if (subs.dir === 'down') signals.push({ tone: 'bad', title: 'Fewer subscribers are renewing', detail: `Subscribers renewing fell ${Math.abs(subs.pct ?? 0)}% (last 3 full months vs the 3 before). More are cancelling or pausing than joining.` });
  if (subs.dir === 'up') signals.push({ tone: 'good', title: 'More subscribers are renewing', detail: `Up ${subs.pct}% over the last 3 full months — new sign-ups are outpacing cancellations.` });
  if (rev.dir === 'up' && subs.dir !== 'up' && subs.dir !== 'unknown') signals.push({ tone: 'info', title: 'Growth is coming from order value, not subscribers', detail: 'Revenue is up while the subscriber count is not — upsells or price changes, not new subscribers.' });
  if (priorTotals && priorTotals.avgRenewalValue > 0 && totals.avgRenewalValue < priorTotals.avgRenewalValue * 0.9) signals.push({ tone: 'warn', title: 'Renewal order value dropped', detail: `Average renewal is $${totals.avgRenewalValue.toFixed(2)} vs $${priorTotals.avgRenewalValue.toFixed(2)} in the comparison period — check discount stacking or downgrades.` });
  if (totals.shareOfStoreNet > 0) signals.push({ tone: 'info', title: `Subscriptions are ${Math.round(totals.shareOfStoreNet * 1000) / 10}% of store net sales`, detail: 'A rising share means more of the business is recurring and predictable.' });
  if (!enough) signals.push({ tone: 'info', title: 'Not enough history for a trend yet', detail: 'The trend needs 6 full months of renewals.' });

  return {
    channel: cfg.shopifyChannel,
    range: { from, to },
    totals,
    prior: prior && priorTotals ? { range: prior, totals: priorTotals } : null,
    monthly,
    trend: { revenue: rev.dir, revenuePct: rev.pct, subscribers: subs.dir, subscribersPct: subs.pct },
    signals,
    loopConnected: Boolean((process.env.LOOP_API_TOKEN || '').trim()),
  };
}
