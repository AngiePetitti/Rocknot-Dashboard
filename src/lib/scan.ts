// The sweep: every morning, every series the dashboard has is checked against
// its own recent history, and the outliers are ranked by dollar impact. This
// is where the surprises live — the things nobody thought to ask about. It
// is computed, not imagined: a robust z-score (median / MAD) on the last 35
// days per series, a same-weekday check, and a 7-day trend check, with a
// minimum impact so noise never ranks. Cleo investigates the top of the list.
import { shopifyql } from '@/src/lib/shopifyql';
import { storeOnlyWhere, hasPlatform, metaAccountSql } from '@/src/lib/client';
import { runQuery, isBigQueryConfigured, googleSource, metaSource, tableExists, getDataset } from '@/src/lib/bigquery';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export interface Series {
  /** e.g. "Revenue by product", "Sessions by landing page", "Meta campaign spend" */
  group: string;
  /** the dimension value, e.g. the product title */
  name: string;
  metric: 'revenue' | 'orders' | 'sessions' | 'cvr' | 'spend' | 'purchases' | 'cpa' | 'clicks';
  unit: '$' | '#' | '%';
  /** date → value, for the last 35 days */
  values: Record<string, number>;
  /** sessions per day for CVR series (to weight impact) */
  weight?: Record<string, number>;
}

export interface Anomaly {
  group: string; name: string; metric: Series['metric']; unit: Series['unit'];
  kind: 'spike' | 'drop' | 'new' | 'trend_up' | 'trend_down';
  window: 'yesterday' | '7d';
  value: number; baseline: number; pct: number | null; z: number | null;
  /** Rough dollar impact used for ranking (revenue delta, spend delta, or sessions × revenue-per-session). */
  impact: number;
  detail: string;
}

export interface ScanResult { date: string; seriesCount: number; anomalies: Anomaly[]; errors: string[] }

// ── Series collection ──────────────────────────────────────────────────────

function ensure(map: Map<string, Series>, key: string, make: () => Series): Series {
  let s = map.get(key); if (!s) { s = make(); map.set(key, s); } return s;
}

async function topDims(ql: string, dim: string, metricCol: string, limit: number): Promise<string[]> {
  const rows = await shopifyql(`${ql} ORDER BY ${metricCol} DESC LIMIT ${limit}`, { timeoutMs: 20000 }).catch(() => []);
  return rows.map(r => str(r[dim])).filter(v => v && !/['"\\]/.test(v));
}
const inList = (dim: string, vals: string[]) => vals.length ? `(${vals.map(v => `${dim} = '${v}'`).join(' OR ')})` : '';

async function salesSeries(from: string, to: string, dim: string, label: string, where: string, limit: number, out: Map<string, Series>, errors: string[]): Promise<void> {
  try {
    const dims = await topDims(`FROM sales SHOW net_sales GROUP BY ${dim} ${where}SINCE ${from} UNTIL ${to}`, dim, 'net_sales', limit);
    if (!dims.length) return;
    const filt = inList(dim, dims);
    const w = where ? `${where.trim()} AND ${filt} ` : `WHERE ${filt} `;
    const rows = await shopifyql(`FROM sales SHOW net_sales, orders GROUP BY ${dim} TIMESERIES day ${w}SINCE ${from} UNTIL ${to} LIMIT 2000`, { timeoutMs: 30000 });
    for (const r of rows) {
      const d = str(r.day).slice(0, 10); const name = str(r[dim]); if (!d || !name) continue;
      ensure(out, `${label}|rev|${name}`, () => ({ group: `${label}`, name, metric: 'revenue', unit: '$', values: {} })).values[d] = num(r.net_sales);
      ensure(out, `${label}|ord|${name}`, () => ({ group: `${label} (orders)`, name, metric: 'orders', unit: '#', values: {} })).values[d] = num(r.orders);
    }
  } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function sessionSeries(from: string, to: string, dim: string, label: string, limit: number, out: Map<string, Series>, errors: string[]): Promise<void> {
  try {
    const dims = await topDims(`FROM sessions SHOW sessions GROUP BY ${dim} SINCE ${from} UNTIL ${to}`, dim, 'sessions', limit);
    if (!dims.length) return;
    const rows = await shopifyql(`FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY ${dim} TIMESERIES day WHERE ${inList(dim, dims)} SINCE ${from} UNTIL ${to} LIMIT 2000`, { timeoutMs: 30000 });
    for (const r of rows) {
      const d = str(r.day).slice(0, 10); const name = str(r[dim]) || '(none)'; if (!d) continue;
      const sess = num(r.sessions), done = num(r.sessions_that_completed_checkout);
      ensure(out, `${label}|sess|${name}`, () => ({ group: label, name, metric: 'sessions', unit: '#', values: {} })).values[d] = sess;
      const c = ensure(out, `${label}|cvr|${name}`, () => ({ group: `${label} (conversion)`, name, metric: 'cvr', unit: '%', values: {}, weight: {} }));
      c.values[d] = sess > 0 ? (done / sess) * 100 : 0; c.weight![d] = sess;
    }
  } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function adSeries(from: string, to: string, out: Map<string, Series>, errors: string[]): Promise<void> {
  if (!isBigQueryConfigured()) return;
  const ds = getDataset();
  const specs: Array<{ key: 'meta' | 'google' | 'pinterest'; label: string; src: () => Promise<string>; conv: string; acct: string }> = [];
  if (hasPlatform('meta') && (await tableExists('facebook_ads'))) specs.push({ key: 'meta', label: 'Meta campaign', src: metaSource, conv: 'actions_omni_purchase', acct: metaAccountSql() });
  if (hasPlatform('google') && (await tableExists('google_ads'))) specs.push({ key: 'google', label: 'Google campaign', src: googleSource, conv: 'conversions', acct: '' });
  if (hasPlatform('pinterest') && (await tableExists('pinterest_ads'))) specs.push({ key: 'pinterest', label: 'Pinterest campaign', src: async () => `\`${ds}.pinterest_ads\``, conv: 'total_checkout', acct: '' });
  await Promise.all(specs.map(async sp => {
    try {
      const src = await sp.src();
      const rows = await runQuery<{ d: string; campaign: string; spend: number; conv: number; clicks: number }>(
        `SELECT CAST(DATE(date) AS STRING) AS d, CAST(campaign AS STRING) AS campaign, SUM(CAST(spend AS FLOAT64)) AS spend, SUM(IFNULL(CAST(${sp.conv} AS FLOAT64), 0)) AS conv, SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks
         FROM ${src} WHERE DATE(date) BETWEEN @from AND @to${sp.acct} GROUP BY d, campaign`, { from, to });
      // Keep the top 12 campaigns by spend so the list stays about money.
      const totals = new Map<string, number>();
      for (const r of rows) totals.set(r.campaign, (totals.get(r.campaign) || 0) + num(r.spend));
      const keep = new Set(Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k));
      for (const r of rows) {
        if (!keep.has(r.campaign)) continue;
        const name = r.campaign || '(unnamed)';
        ensure(out, `${sp.label}|spend|${name}`, () => ({ group: `${sp.label} spend`, name, metric: 'spend', unit: '$', values: {} })).values[r.d] = num(r.spend);
        ensure(out, `${sp.label}|purch|${name}`, () => ({ group: `${sp.label} purchases`, name, metric: 'purchases', unit: '#', values: {} })).values[r.d] = num(r.conv);
        ensure(out, `${sp.label}|clicks|${name}`, () => ({ group: `${sp.label} clicks`, name, metric: 'clicks', unit: '#', values: {} })).values[r.d] = num(r.clicks);
      }
    } catch (e) { errors.push(`${sp.label}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
}

// ── Detection ──────────────────────────────────────────────────────────────

function median(a: number[]): number { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export function detect(series: Series[], date: string, revenuePerSession: number, aov: number): Anomaly[] {
  const out: Anomaly[] = [];
  const minImpact: Record<Series['metric'], number> = { revenue: 150, orders: 150, sessions: 100, cvr: 100, spend: 60, purchases: 100, cpa: 60, clicks: 60 };
  for (const s of series) {
    const days = Object.keys(s.values).sort();
    const hist = days.filter(d => d < date && d >= addDays(date, -28)).map(d => s.values[d]);
    if (hist.length < 10) continue;
    const y = s.values[date] ?? 0;
    const med = median(hist);
    const mad = median(hist.map(v => Math.abs(v - med))) * 1.4826 || (med * 0.15) || 1;
    const z = (y - med) / mad;
    const sameWd = [7, 14, 21, 28].map(n => s.values[addDays(date, -n)]).filter(v => v != null) as number[];
    const wdBase = sameWd.length ? sameWd.reduce((a, b) => a + b, 0) / sameWd.length : med;
    const impactOf = (delta: number, d: string) => {
      if (s.metric === 'revenue' || s.metric === 'spend') return Math.abs(delta);
      if (s.metric === 'orders' || s.metric === 'purchases') return Math.abs(delta) * aov;
      if (s.metric === 'sessions' || s.metric === 'clicks') return Math.abs(delta) * revenuePerSession;
      if (s.metric === 'cvr') return (Math.abs(delta) / 100) * (s.weight?.[d] ?? 0) * aov;
      return Math.abs(delta);
    };
    // Yesterday vs history (robust z) — and it has to disagree with the weekday norm too.
    const delta = y - wdBase;
    const impact = impactOf(delta, date);
    if (Math.abs(z) >= 2.5 && impact >= minImpact[s.metric] && Math.abs(delta) >= Math.abs(wdBase) * 0.25) {
      out.push({ group: s.group, name: s.name, metric: s.metric, unit: s.unit, kind: y > wdBase ? 'spike' : 'drop', window: 'yesterday', value: r2(y), baseline: r2(wdBase), pct: wdBase ? r2(((y - wdBase) / wdBase) * 100) : null, z: r2(z), impact: r2(impact), detail: `${s.name}: ${fmt(y, s.unit)} yesterday vs a typical ${fmt(wdBase, s.unit)} (z ${r2(z)})` });
    } else if (med === 0 && y > 0 && impact >= minImpact[s.metric] * 2) {
      out.push({ group: s.group, name: s.name, metric: s.metric, unit: s.unit, kind: 'new', window: 'yesterday', value: r2(y), baseline: 0, pct: null, z: null, impact: r2(impact), detail: `${s.name}: ${fmt(y, s.unit)} yesterday — nothing in the prior 4 weeks` });
    }
    // 7-day trend vs the 7 before.
    const sum = (from: string, to: string) => days.filter(d => d >= from && d <= to).reduce((a, d) => a + s.values[d], 0);
    const cnt = (from: string, to: string) => days.filter(d => d >= from && d <= to).length;
    const w1 = sum(addDays(date, -6), date), w0 = sum(addDays(date, -13), addDays(date, -7));
    if (cnt(addDays(date, -13), addDays(date, -7)) >= 5 && w0 > 0) {
      const v1 = s.metric === 'cvr' ? w1 / Math.max(1, cnt(addDays(date, -6), date)) : w1;
      const v0 = s.metric === 'cvr' ? w0 / Math.max(1, cnt(addDays(date, -13), addDays(date, -7))) : w0;
      const pct = ((v1 - v0) / v0) * 100;
      const imp = impactOf(v1 - v0, date) / (s.metric === 'cvr' ? 1 : 7) * (s.metric === 'cvr' ? 7 : 1);
      if (Math.abs(pct) >= 30 && imp >= minImpact[s.metric] * 3) {
        out.push({ group: s.group, name: s.name, metric: s.metric, unit: s.unit, kind: pct > 0 ? 'trend_up' : 'trend_down', window: '7d', value: r2(v1), baseline: r2(v0), pct: r2(pct), z: null, impact: r2(imp), detail: `${s.name}: ${fmt(v1, s.unit)} over the last 7 days vs ${fmt(v0, s.unit)} the 7 before (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)` });
      }
    }
  }
  // De-duplicate (one entry per series, biggest impact), rank by impact.
  const best = new Map<string, Anomaly>();
  for (const a of out) { const k = `${a.group}|${a.name}`; const cur = best.get(k); if (!cur || a.impact > cur.impact) best.set(k, a); }
  return Array.from(best.values()).sort((a, b) => b.impact - a.impact).slice(0, 14);
}
function fmt(v: number, unit: Series['unit']): string { return unit === '$' ? `$${Math.round(v).toLocaleString()}` : unit === '%' ? `${v.toFixed(2)}%` : Math.round(v).toLocaleString(); }

// ── Entry ──────────────────────────────────────────────────────────────────

export async function runScan(date: string, revenuePerSession: number, aov: number): Promise<ScanResult> {
  const from = addDays(date, -34), to = date;
  const out = new Map<string, Series>();
  const errors: string[] = [];
  const where = storeOnlyWhere() ? `${storeOnlyWhere()} ` : '';
  await Promise.all([
    salesSeries(from, to, 'product_title', 'Revenue by product', where, 25, out, errors),
    salesSeries(from, to, 'product_type', 'Revenue by product type', where, 12, out, errors),
    salesSeries(from, to, 'sales_channel', 'Revenue by sales channel', '', 6, out, errors),
    sessionSeries(from, to, 'referrer_source', 'Sessions by channel', 10, out, errors),
    sessionSeries(from, to, 'session_device_type', 'Sessions by device', 4, out, errors),
    sessionSeries(from, to, 'landing_page_path', 'Sessions by landing page', 20, out, errors),
    sessionSeries(from, to, 'session_country', 'Sessions by country', 6, out, errors),
    adSeries(from, to, out, errors),
  ]);
  const series = Array.from(out.values());
  return { date, seriesCount: series.length, anomalies: detect(series, date, revenuePerSession, aov), errors };
}
