// New-customer CAC by ad platform.
//
// Platform spend comes from the ads tables (de-duplicated, live-patched —
// the same figures as the Ads tab). New customers come from Shopify: for each
// order source Shopify reports distinct customers and how many of them had
// bought before, so first-time buyers = customers − returning. Each source is
// mapped to a platform from the order's UTM tags first (an ad click), then
// from the referring site. This is Shopify last-click, not a pixel model like
// TripleWhale's: orders with no tag and no referrer land in "unattributed",
// and the blended figure (all spend ÷ all new customers) is the one that does
// not depend on attribution at all.
import { shopifyql } from '@/src/lib/shopifyql';
import { storeOnlyWhere, clientPlatforms, type PlatformKey } from '@/src/lib/client';
import { getAdsOverview } from '@/src/lib/bqAds';

export interface NcacPlatform {
  key: PlatformKey; label: string; color: string;
  spend: number; newCustomers: number; orders: number;
  /** spend ÷ new customers; null when no new customers were attributed. */
  ncac: number | null;
}
export interface NcacSummary {
  range: { from: string; to: string };
  platforms: NcacPlatform[];
  blended: { spend: number; newCustomers: number; ncac: number | null };
  attributedNewCustomers: number;
  unattributed: { newCustomers: number; orders: number };
  /** Top order sources that mapped to no ad platform (for tuning the mapping). */
  otherSources: Array<{ source: string; newCustomers: number; orders: number }>;
  basis: 'utm+referrer' | 'referrer';
}
export interface NcacData extends NcacSummary { prior?: NcacSummary | null; error?: string }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const low = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function classifySource(utmSource: string, utmMedium: string, refSource: string, refName: string): PlatformKey | null {
  const test = (s: string): PlatformKey | null => {
    if (!s) return null;
    if (/google|adwords|gclid|youtube|google shopping|^sag_|shopping/.test(s)) return 'google';
    if (/facebook|instagram|^fb$|^ig$|^fb[_-]|^ig[_-]|meta|fbclid|^an$/.test(s)) return 'meta';
    if (/pinterest|^pin$|^pin[_-]|pintrest/.test(s)) return 'pinterest';
    if (/tiktok|^tt[_-]|bytedance/.test(s)) return 'tiktok';
    if (/snapchat|^snap$|^snap[_-]|^sc[_-]/.test(s)) return 'snapchat';
    return null;
  };
  return test(utmSource) || test(`${utmSource} ${utmMedium}`.trim()) || test(refName) || test(refSource);
}

interface SourceRow { utmSource: string; utmMedium: string; refSource: string; refName: string; orders: number; customers: number; returning: number }

const toRow = (x: Record<string, unknown>): SourceRow => ({
  utmSource: low(x.utm_campaign_source), utmMedium: low(x.utm_campaign_medium),
  refSource: low(x.order_referrer_source), refName: low(x.order_referrer_name),
  orders: num(x.orders), customers: num(x.customers), returning: num(x.returning_customers),
});

/**
 * Two Shopify views of the same orders. Referrer rows always come back; UTM
 * rows come back only for stores whose orders carry campaign tags (Shopify
 * returns an EMPTY result, not an error, when they don't — so empty means
 * "no signal", never "no orders"). The two overlap (a tagged order also has a
 * referrer), so per platform the larger of the two counts is used: the best
 * available last-click evidence of that platform's first-time buyers.
 */
async function fetchSourceRows(from: string, to: string): Promise<{ referrer: SourceRow[]; utm: SourceRow[]; totals: { customers: number; returning: number; orders: number } }> {
  const where = storeOnlyWhere();
  const range = `SINCE ${from} UNTIL ${to}`;
  const [referrer, utm, totals] = await Promise.all([
    shopifyql(`FROM sales SHOW orders, customers, returning_customers GROUP BY order_referrer_source, order_referrer_name ${where} ${range} ORDER BY orders DESC LIMIT 400`, { timeoutMs: 20000 }).then(r => r.map(toRow)),
    shopifyql(`FROM sales SHOW orders, customers, returning_customers GROUP BY utm_campaign_source, utm_campaign_medium ${where} ${range} ORDER BY orders DESC LIMIT 400`, { timeoutMs: 20000 }).then(r => r.map(toRow)).catch(() => [] as SourceRow[]),
    shopifyql(`FROM sales SHOW orders, customers, returning_customers ${where} ${range}`, { timeoutMs: 15000 }).then(r => ({ customers: num(r[0]?.customers), returning: num(r[0]?.returning_customers), orders: num(r[0]?.orders) })).catch(() => ({ customers: 0, returning: 0, orders: 0 })),
  ]);
  return { referrer, utm, totals };
}

export async function fetchNcac(from: string, to: string): Promise<NcacSummary> {
  const [{ referrer, utm, totals }, ads] = await Promise.all([
    fetchSourceRows(from, to),
    getAdsOverview(from, to).catch(() => ({ platforms: [] as Array<{ platform: string; spend: number }>, dailySpend: [] })),
  ]);
  const spendByLabel = new Map(ads.platforms.map(p => [p.platform.toLowerCase(), p.spend]));
  type Acc = { newCustomers: number; orders: number };
  const tally = (rows: SourceRow[]) => {
    const acc = new Map<PlatformKey, Acc>();
    const other = new Map<string, Acc>();
    for (const r of rows) {
      const fresh = Math.max(0, r.customers - r.returning);
      const k = classifySource(r.utmSource, r.utmMedium, r.refSource, r.refName);
      if (k) {
        const cur = acc.get(k) || { newCustomers: 0, orders: 0 };
        cur.newCustomers += fresh; cur.orders += r.orders; acc.set(k, cur);
      } else {
        const label = [r.utmSource && `utm:${r.utmSource}`, r.refName || r.refSource].filter(Boolean).join(' · ') || 'direct / untracked';
        const cur = other.get(label) || { newCustomers: 0, orders: 0 };
        cur.newCustomers += fresh; cur.orders += r.orders; other.set(label, cur);
      }
    }
    return { acc, other };
  };
  const byRef = tally(referrer);
  const byUtm = tally(utm);
  const platforms: NcacPlatform[] = clientPlatforms().map(p => {
    const a = byRef.acc.get(p.key) || { newCustomers: 0, orders: 0 };
    const b = byUtm.acc.get(p.key) || { newCustomers: 0, orders: 0 };
    const best = b.newCustomers > a.newCustomers ? b : a;
    const spend = spendByLabel.get(p.label.toLowerCase()) || 0;
    return { key: p.key, label: p.label, color: p.color, spend, newCustomers: best.newCustomers, orders: best.orders, ncac: best.newCustomers > 0 ? spend / best.newCustomers : null };
  });
  const totalSpend = platforms.reduce((s, p) => s + p.spend, 0);
  // Store-wide first-time buyers from Shopify's own total (exact; matches the
  // Overview's New Customers card), not a sum of the source rows.
  const allNew = Math.max(0, totals.customers - totals.returning) || referrer.reduce((s, r) => s + Math.max(0, r.customers - r.returning), 0);
  const attributed = platforms.reduce((s, p) => s + p.newCustomers, 0);
  const otherSources = Array.from(byRef.other.entries()).map(([source, v]) => ({ source, ...v })).sort((a, b) => b.newCustomers - a.newCustomers).slice(0, 8);
  return {
    range: { from, to },
    platforms,
    blended: { spend: totalSpend, newCustomers: allNew, ncac: allNew > 0 ? totalSpend / allNew : null },
    attributedNewCustomers: attributed,
    unattributed: { newCustomers: Math.max(0, allNew - attributed), orders: Math.max(0, totals.orders - platforms.reduce((s, p) => s + p.orders, 0)) },
    otherSources,
    basis: utm.length ? 'utm+referrer' : 'referrer',
  };
}

export function ncacText(d: NcacSummary): string {
  const $ = (v: number | null) => (v == null ? '—' : `$${v.toFixed(2)}`);
  const lines = d.platforms.filter(p => p.spend > 0 || p.newCustomers > 0).map(p => `  - ${p.label}: ${p.newCustomers} new customers on $${Math.round(p.spend).toLocaleString()} spend → nCAC ${$(p.ncac)}`);
  return `New-customer CAC ${d.range.from} → ${d.range.to} (Shopify first-time buyers by order source — UTM then referrer, last-click; NOT a pixel model):\n${lines.join('\n')}\n  - Blended (all spend ÷ all new customers): ${d.blended.newCustomers} new customers, $${Math.round(d.blended.spend).toLocaleString()} spend → ${$(d.blended.ncac)}\n  - Unattributed new customers (no tag / no referrer): ${d.unattributed.newCustomers}`;
}
