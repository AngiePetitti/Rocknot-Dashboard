// Marketplace channel tab (e.g. Nordstrom dropship): everything Shopify's
// sales report knows about ONE sales_channel, next to the online store for
// context. All figures are Shopify Analytics' own, filtered by channel.
import { getClient, marketplaceByKey, marketplaces, MarketplaceChannel } from '@/src/lib/client';
import { shopifyql, trafficConfigured, Row } from '@/src/lib/traffic';
import { addDays, todayPst } from '@/src/lib/timeframes';

const num = (v: string | undefined) => { const n = parseFloat(v || '0'); return Number.isFinite(n) ? n : 0; };
const lit = (s: string) => `'${s.replace(/'/g, "\\'")}'`;

export interface ChannelTotals {
  orders: number; gross: number; discounts: number; returns: number; net: number; totalSales: number;
  aov: number; customers: number; returningCustomers: number;
}
export interface ChannelDay { date: string; orders: number; gross: number; returns: number; net: number }
export interface ChannelBreakdownRow { label: string; orders: number; gross: number; returns: number; net: number }
export interface ChannelData {
  channel: MarketplaceChannel;
  range: { from: string; to: string };
  totals: ChannelTotals;
  store: ChannelTotals;
  allNet: number;
  /** Gross sold inside the return window (sales that can still come back). */
  openWindow: { from: string; gross: number; orders: number } | null;
  daily: ChannelDay[];
  byLine: ChannelBreakdownRow[];
  byProduct: ChannelBreakdownRow[];
  bySize: ChannelBreakdownRow[];
  byRegion: ChannelBreakdownRow[];
  economics: {
    commissionPct: number | null; commission: number | null;
    cogsPct: number | null; cogs: number | null;
    contribution: number | null; contributionPct: number | null;
  };
  prior?: { range: { from: string; to: string }; totals: ChannelTotals; store: ChannelTotals } | null;
  errors: string[];
}

const TOTAL_FIELDS = 'orders, gross_sales, discounts, returns, net_sales, total_sales, average_order_value, customers, returning_customers';
function totalsOf(rows: Row[]): ChannelTotals {
  const r = rows[0] || {};
  return {
    orders: Math.round(num(r.orders)), gross: num(r.gross_sales), discounts: Math.abs(num(r.discounts)), returns: Math.abs(num(r.returns)),
    net: num(r.net_sales), totalSales: num(r.total_sales), aov: num(r.average_order_value),
    customers: Math.round(num(r.customers)), returningCustomers: Math.round(num(r.returning_customers)),
  };
}
const EMPTY: ChannelTotals = { orders: 0, gross: 0, discounts: 0, returns: 0, net: 0, totalSales: 0, aov: 0, customers: 0, returningCustomers: 0 };
const breakdown = (labelKey: string) => (rows: Row[]): ChannelBreakdownRow[] => rows.map(r => ({
  label: r[labelKey] || '(none)', orders: Math.round(num(r.orders)), gross: num(r.gross_sales), returns: Math.abs(num(r.returns)), net: num(r.net_sales),
}));

export function channelConfigured(): boolean { return trafficConfigured(); }

export async function fetchChannel(key: string, from: string, to: string, prior?: { from: string; to: string } | null): Promise<ChannelData | null> {
  const channel = marketplaceByKey(key);
  if (!channel) return null;
  const errors: string[] = [];
  const W = `WHERE sales_channel = ${lit(channel.shopifyChannel)}`;
  const S = `WHERE sales_channel = 'Online Store'`;
  const range = `SINCE ${from} UNTIL ${to}`;
  const q = async <T,>(label: string, ql: string, map: (rows: Row[]) => T, empty: T): Promise<T> => {
    try { return map(await shopifyql(ql)); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return empty; }
  };
  // Sales still inside the return window: from (today − window) to today,
  // regardless of the selected range — these can still come back.
  const today = todayPst();
  const openFrom = addDays(today, -channel.returnWindowDays);

  const [totals, store, all, open, daily, byLine, byProduct, bySize, byRegion, priorTotals, priorStore] = await Promise.all([
    q('totals', `FROM sales SHOW ${TOTAL_FIELDS} ${W} ${range}`, totalsOf, EMPTY),
    q('store', `FROM sales SHOW ${TOTAL_FIELDS} ${S} ${range}`, totalsOf, EMPTY),
    q('all', `FROM sales SHOW net_sales ${range}`, rows => num(rows[0]?.net_sales), 0),
    q('open window', `FROM sales SHOW orders, gross_sales ${W} SINCE ${openFrom} UNTIL ${today}`, rows => ({ from: openFrom, gross: num(rows[0]?.gross_sales), orders: Math.round(num(rows[0]?.orders)) }), null as { from: string; gross: number; orders: number } | null),
    q('daily', `FROM sales SHOW orders, gross_sales, returns, net_sales ${W} TIMESERIES day ${range}`, rows => rows.map(r => ({
      date: String(r.day || '').slice(0, 10), orders: Math.round(num(r.orders)), gross: num(r.gross_sales), returns: Math.abs(num(r.returns)), net: num(r.net_sales),
    })), [] as ChannelDay[]),
    q('lines', `FROM sales SHOW orders, gross_sales, returns, net_sales GROUP BY product_type ${W} ${range} ORDER BY gross_sales DESC LIMIT 12`, breakdown('product_type'), [] as ChannelBreakdownRow[]),
    q('products', `FROM sales SHOW orders, gross_sales, returns, net_sales GROUP BY product_title ${W} ${range} ORDER BY gross_sales DESC LIMIT 15`, breakdown('product_title'), [] as ChannelBreakdownRow[]),
    q('sizes', `FROM sales SHOW orders, gross_sales, returns, net_sales GROUP BY product_variant_title ${W} ${range} ORDER BY gross_sales DESC LIMIT 14`, breakdown('product_variant_title'), [] as ChannelBreakdownRow[]),
    q('regions', `FROM sales SHOW orders, gross_sales, returns, net_sales GROUP BY shipping_region ${W} ${range} ORDER BY gross_sales DESC LIMIT 10`, breakdown('shipping_region'), [] as ChannelBreakdownRow[]),
    prior ? q('prior', `FROM sales SHOW ${TOTAL_FIELDS} ${W} SINCE ${prior.from} UNTIL ${prior.to}`, totalsOf, null as ChannelTotals | null) : Promise.resolve(null),
    prior ? q('prior store', `FROM sales SHOW ${TOTAL_FIELDS} ${S} SINCE ${prior.from} UNTIL ${prior.to}`, totalsOf, null as ChannelTotals | null) : Promise.resolve(null),
  ]);

  // Contribution: net after returns − marketplace commission − cost of goods.
  // Commission comes from the profile (null until Kailee confirms the rate);
  // COGS from the profile's gross margin (89% → 11% of net).
  const gm = getClient().finance.grossMarginPct;
  const cogsPct = gm != null ? 100 - gm : null;
  const commission = channel.commissionPct != null ? totals.net * channel.commissionPct / 100 : null;
  const cogs = cogsPct != null ? totals.net * cogsPct / 100 : null;
  const contribution = totals.net - (commission ?? 0) - (cogs ?? 0);
  const economics = {
    commissionPct: channel.commissionPct, commission,
    cogsPct, cogs,
    contribution: cogs != null ? contribution : null,
    contributionPct: cogs != null && totals.net > 0 ? Math.round((contribution / totals.net) * 1000) / 10 : null,
  };

  return {
    channel, range: { from, to }, totals, store, allNet: all,
    openWindow: open, daily, byLine, byProduct, bySize, byRegion, economics,
    prior: prior && priorTotals && priorStore ? { range: prior, totals: priorTotals, store: priorStore } : null,
    errors,
  };
}

/** Net / total sales and orders per marketplace channel for the range — what the
 *  store-only MER card subtracts from the all-channel figures. [] when none. */
export interface MarketplaceTotals { key: string; label: string; netSales: number; totalSales: number; orders: number; returnFees: number }
export async function fetchMarketplaceTotals(from: string, to: string): Promise<MarketplaceTotals[]> {
  const list = marketplaces();
  if (!list.length || !trafficConfigured()) return [];
  const out = await Promise.all(list.map(async m => {
    try {
      const rows = await shopifyql(`FROM sales SHOW orders, net_sales, total_sales, return_fees WHERE sales_channel = ${lit(m.shopifyChannel)} SINCE ${from} UNTIL ${to}`, 12000);
      const r = rows[0] || {};
      return { key: m.key, label: m.label, netSales: num(r.net_sales), totalSales: num(r.total_sales), orders: Math.round(num(r.orders)), returnFees: Math.abs(num(r.return_fees)) };
    } catch {
      return null;
    }
  }));
  return out.filter((x): x is MarketplaceTotals => x !== null);
}
