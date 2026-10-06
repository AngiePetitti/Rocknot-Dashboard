// Google Analytics 4 via Windsor's live REST connector (Traffic tab →
// "Google Analytics" view, and Cleo's get_site_analytics tool).
//
// Shopify stays the truth for orders and revenue; GA4 is the lens for
// page-level behaviour (which landing pages convert) and traffic-source
// detail (source / medium / channel group). The two never agree on session
// counts — GA4 misses visitors who block tracking — so every block here is
// labelled as GA4 and is not mixed with Shopify figures.
import { windsorParams, windsorAccount } from '@/src/lib/client';

const WINDSOR_KEY = (process.env.WINDSOR_API_KEY || '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));

// Windsor connector slugs to try, most likely first.
// Windsor's GA4 connector slug (onboard.windsor.ai/app/googleanalytics4).
const CONNECTORS = ['googleanalytics4', 'google_analytics_4'];

export interface GaTotals {
  sessions: number; users: number; newUsers: number; engagedSessions: number; pageViews: number;
  purchases: number; revenue: number; addToCarts: number; conversions: number;
}
export interface GaDimRow {
  key: string; label: string; secondary?: string;
  sessions: number; engagedSessions: number; users: number; purchases: number; revenue: number; addToCarts: number;
}
export interface GaPageRow { path: string; title: string; pageViews: number; sessions: number; engagedSessions: number; users: number }
export interface GaDay { date: string; sessions: number; users: number; purchases: number; revenue: number }
export interface GaAttempt { query: string; connector: string; fieldSet: string; fields: string[]; error?: string; rows?: number; sample?: Array<Record<string, unknown>> }
export interface GaData {
  status: 'ok' | 'partial' | 'not_connected' | 'error';
  error?: string;
  range: { from: string; to: string };
  account?: string | null;
  connector?: string;
  totals: GaTotals;
  daily: GaDay[];
  channels: GaDimRow[];
  sources: GaDimRow[];
  landingPages: GaDimRow[];
  pages: GaPageRow[];
  blocks: Record<'daily' | 'sources' | 'landing' | 'pages', { ok: boolean; error?: string; fieldSet?: string }>;
  attempts?: GaAttempt[];
}

export function ga4Configured(): boolean {
  return Boolean(WINDSOR_KEY) && windsorAccount('google_analytics') !== null;
}

// Windsor normalises GA4 field ids to snake_case (session_source, landing_page,
// ecommerce_purchases …). Each query carries graded fallbacks: a trimmed set
// without the optional ecommerce fields, then flattened names, so one unknown
// field never blanks the whole block. /api/debug/ga4 shows what was accepted.
type FieldSet = { name: string; fields: string[] };
function graded(core: string[], optional: string[]): FieldSet[] {
  const flat = (f: string[]) => f.map(x => x.replace(/_/g, ''));
  return [
    { name: 'full', fields: [...core, ...optional] },
    { name: 'core', fields: core },
    { name: 'flat_full', fields: flat([...core, ...optional]) },
    { name: 'flat_core', fields: flat(core) },
  ];
}
const Q = {
  // Users: Windsor rejected total_users / new_users on the first live run, so the
  // set carries the alternates too; the pruning loop drops whichever it rejects.
  daily: graded(['date', 'sessions', 'engaged_sessions', 'screen_page_views'], ['total_users', 'active_users', 'users', 'new_users', 'ecommerce_purchases', 'purchase_revenue', 'add_to_carts', 'conversions']),
  sources: graded(['date', 'session_default_channel_group', 'session_source', 'session_medium', 'sessions', 'engaged_sessions'], ['total_users', 'active_users', 'ecommerce_purchases', 'purchase_revenue', 'add_to_carts']),
  landing: graded(['date', 'landing_page', 'sessions', 'engaged_sessions'], ['total_users', 'active_users', 'ecommerce_purchases', 'purchase_revenue', 'add_to_carts']),
  pages: graded(['date', 'page_path', 'page_title', 'screen_page_views', 'sessions', 'engaged_sessions'], ['total_users', 'active_users']),
};

// Read a metric whatever spelling the accepted field set used.
function pick(r: Record<string, unknown>, snake: string): unknown {
  if (snake in r) return r[snake];
  const flat = snake.replace(/_/g, '');
  if (flat in r) return r[flat];
  const lower = Object.keys(r).find(k => k.toLowerCase().replace(/_/g, '') === flat);
  return lower ? r[lower] : undefined;
}
const m = (r: Record<string, unknown>, k: string) => num(pick(r, k));
const users = (r: Record<string, unknown>) => m(r, 'total_users') || m(r, 'active_users') || m(r, 'users');
const d = (r: Record<string, unknown>, k: string) => str(pick(r, k));

async function windsorRows(
  query: keyof typeof Q, connector: string, from: string, to: string, attempts: GaAttempt[],
): Promise<{ rows: Array<Record<string, unknown>> | null; fieldSet: string | null; error?: string }> {
  const scoped = windsorParams('google_analytics', { date_from: from, date_to: to });
  if (!scoped) return { rows: null, fieldSet: null, error: 'not connected' };
  const errors: string[] = [];
  for (const fs of Q[query]) {
    // Self-correcting: when Windsor's error names one of the requested
    // fields, drop that field and retry (up to 6 times) before moving on to
    // the next field set — so one unknown metric never blanks a block.
    let fields = [...fs.fields];
    for (let round = 0; round < 7 && fields.length >= 2; round++) {
      const qs = new URLSearchParams({ api_key: WINDSOR_KEY, fields: fields.join(','), _renderer: 'json', ...scoped });
      let err = '';
      try {
        const res = await fetch(`https://connectors.windsor.ai/${connector}?${qs}`, { next: { revalidate: 900 }, signal: AbortSignal.timeout(25000) });
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status} (not JSON)` }));
        if (!json.error && Array.isArray(json.data)) {
          attempts.push({ query, connector, fieldSet: round ? `${fs.name} (pruned ${fs.fields.length - fields.length})` : fs.name, fields, rows: json.data.length, sample: json.data.slice(0, 2) });
          return { rows: json.data as Array<Record<string, unknown>>, fieldSet: fs.name };
        }
        err = String(json.error || json.message || `HTTP ${res.status}`);
        if (res.status === 404 || /don't have this connector|do not have this connector/i.test(err)) {
          attempts.push({ query, connector, fieldSet: fs.name, fields, error: err });
          return { rows: null, fieldSet: null, error: err };
        }
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      attempts.push({ query, connector, fieldSet: fs.name, fields, error: err });
      errors.push(err);
      // Which requested field does the error mention? Never drop `date`.
      const lower = err.toLowerCase();
      const bad = fields.find(f => f !== 'date' && new RegExp(`(^|[^a-z0-9_])${f}([^a-z0-9_]|$)`).test(lower));
      if (!bad) break;
      fields = fields.filter(f => f !== bad);
    }
  }
  return { rows: null, fieldSet: null, error: Array.from(new Set(errors)).slice(0, 3).join(' | ') };
}

function emptyTotals(): GaTotals { return { sessions: 0, users: 0, newUsers: 0, engagedSessions: 0, pageViews: 0, purchases: 0, revenue: 0, addToCarts: 0, conversions: 0 }; }

function rollDims(rows: Array<Record<string, unknown>>, keyOf: (r: Record<string, unknown>) => { key: string; label: string; secondary?: string }): GaDimRow[] {
  const map = new Map<string, GaDimRow>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k.key) continue;
    const cur = map.get(k.key) || { ...k, sessions: 0, engagedSessions: 0, users: 0, purchases: 0, revenue: 0, addToCarts: 0 };
    cur.sessions += m(r, 'sessions'); cur.engagedSessions += m(r, 'engaged_sessions'); cur.users += users(r);
    cur.purchases += m(r, 'ecommerce_purchases'); cur.revenue += m(r, 'purchase_revenue'); cur.addToCarts += m(r, 'add_to_carts');
    map.set(k.key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions);
}

/** Pull every GA4 block for a range. Blocks fail independently. */
export async function fetchGa4(from: string, to: string, includeAttempts = false): Promise<GaData> {
  const range = { from, to };
  const base: GaData = {
    status: 'ok', range, account: windsorAccount('google_analytics'), totals: emptyTotals(), daily: [], channels: [], sources: [], landingPages: [], pages: [],
    blocks: { daily: { ok: false }, sources: { ok: false }, landing: { ok: false }, pages: { ok: false } },
  };
  if (!ga4Configured()) return { ...base, status: 'not_connected' };
  const attempts: GaAttempt[] = [];

  // Find the connector slug with the cheapest query, then run the rest in parallel on it.
  let connector = '';
  let daily: Awaited<ReturnType<typeof windsorRows>> = { rows: null, fieldSet: null };
  const connectorErrors: string[] = [];
  for (const c of CONNECTORS) {
    daily = await windsorRows('daily', c, from, to, attempts);
    if (daily.rows) { connector = c; break; }
    connectorErrors.push(`${c}: ${daily.error || 'unknown error'}`);
  }
  if (!connector) {
    return { ...base, status: 'error', error: `Windsor Google Analytics 4 returned no data — ${connectorErrors.join(' · ')}`, ...(includeAttempts ? { attempts } : {}) };
  }
  const [sources, landing, pages] = await Promise.all([
    windsorRows('sources', connector, from, to, attempts),
    windsorRows('landing', connector, from, to, attempts),
    windsorRows('pages', connector, from, to, attempts),
  ]);

  const out: GaData = { ...base, connector };
  // Daily + totals
  const byDay = new Map<string, GaDay>();
  for (const r of daily.rows!) {
    const date = d(r, 'date').slice(0, 10);
    if (!date) continue;
    const cur = byDay.get(date) || { date, sessions: 0, users: 0, purchases: 0, revenue: 0 };
    cur.sessions += m(r, 'sessions'); cur.users += users(r); cur.purchases += m(r, 'ecommerce_purchases'); cur.revenue += m(r, 'purchase_revenue');
    byDay.set(date, cur);
    out.totals.sessions += m(r, 'sessions'); out.totals.users += users(r); out.totals.newUsers += m(r, 'new_users');
    out.totals.engagedSessions += m(r, 'engaged_sessions'); out.totals.pageViews += m(r, 'screen_page_views');
    out.totals.purchases += m(r, 'ecommerce_purchases'); out.totals.revenue += m(r, 'purchase_revenue');
    out.totals.addToCarts += m(r, 'add_to_carts'); out.totals.conversions += m(r, 'conversions');
  }
  out.daily = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  out.blocks.daily = { ok: true, fieldSet: daily.fieldSet || undefined };

  if (sources.rows) {
    out.channels = rollDims(sources.rows, r => { const g = d(r, 'session_default_channel_group') || '(not set)'; return { key: g, label: g }; });
    out.sources = rollDims(sources.rows, r => {
      const s = d(r, 'session_source') || '(direct)'; const med = d(r, 'session_medium') || '(none)';
      return { key: `${s} / ${med}`, label: s, secondary: med };
    });
    out.blocks.sources = { ok: true, fieldSet: sources.fieldSet || undefined };
  } else out.blocks.sources = { ok: false, error: sources.error };

  if (landing.rows) {
    out.landingPages = rollDims(landing.rows, r => { const p = d(r, 'landing_page') || '(not set)'; return { key: p, label: p }; });
    out.blocks.landing = { ok: true, fieldSet: landing.fieldSet || undefined };
  } else out.blocks.landing = { ok: false, error: landing.error };

  if (pages.rows) {
    const map = new Map<string, GaPageRow>();
    for (const r of pages.rows) {
      const path = d(r, 'page_path');
      if (!path) continue;
      const cur = map.get(path) || { path, title: d(r, 'page_title'), pageViews: 0, sessions: 0, engagedSessions: 0, users: 0 };
      if (!cur.title && d(r, 'page_title')) cur.title = d(r, 'page_title');
      cur.pageViews += m(r, 'screen_page_views'); cur.sessions += m(r, 'sessions'); cur.engagedSessions += m(r, 'engaged_sessions'); cur.users += users(r);
      map.set(path, cur);
    }
    out.pages = Array.from(map.values()).sort((a, b) => b.pageViews - a.pageViews);
    out.blocks.pages = { ok: true, fieldSet: pages.fieldSet || undefined };
  } else out.blocks.pages = { ok: false, error: pages.error };

  const failed = Object.values(out.blocks).filter(b => !b.ok).length;
  out.status = failed ? 'partial' : 'ok';
  if (failed) out.error = Object.entries(out.blocks).filter(([, b]) => !b.ok).map(([k, b]) => `${k}: ${b.error || 'failed'}`).join(' | ');
  if (includeAttempts) out.attempts = attempts;
  return out;
}

/** Plain-text digest for Cleo. */
export function ga4Text(g: GaData, from: string, to: string): string {
  if (g.status === 'not_connected') return 'Google Analytics is not connected on this dashboard.';
  if (g.status === 'error') return `Google Analytics unavailable: ${g.error}`;
  const t = g.totals;
  const n = (v: number) => Math.round(v).toLocaleString();
  const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');
  const siteCvr = t.sessions > 0 ? t.purchases / t.sessions : 0;
  const dim = (r: GaDimRow) => `${r.label}${r.secondary ? ` / ${r.secondary}` : ''}: ${n(r.sessions)} sessions · engaged ${pct(r.engagedSessions, r.sessions)} · ${n(r.purchases)} purchases (${pct(r.purchases, r.sessions)} CVR) · ${$(r.revenue)}`;
  const lines = [
    `GOOGLE ANALYTICS 4 (property ${g.account}) ${from} → ${to}. GA4 numbers are NOT Shopify numbers: GA4 misses visitors who block tracking, so use it for page behaviour and traffic-source detail, and Shopify (get_metrics / get_attribution) for order and revenue truth.`,
    `Totals: ${n(t.sessions)} sessions · ${n(t.users)} users (${n(t.newUsers)} new) · engagement rate ${pct(t.engagedSessions, t.sessions)} · ${n(t.pageViews)} page views · ${n(t.addToCarts)} add-to-carts · ${n(t.purchases)} purchases (${pct(t.purchases, t.sessions)} CVR) · ${$(t.revenue)} GA4 revenue.`,
  ];
  if (g.channels.length) lines.push(`Channel groups:\n${g.channels.slice(0, 10).map(r => `  - ${dim(r)}`).join('\n')}`);
  if (g.sources.length) lines.push(`Top sources (source / medium):\n${g.sources.slice(0, 15).map(r => `  - ${dim(r)}`).join('\n')}`);
  if (g.landingPages.length) {
    const top = g.landingPages.slice(0, 15);
    const eligible = g.landingPages.filter(r => r.sessions >= 100);
    const best = [...eligible].sort((a, b) => b.purchases / b.sessions - a.purchases / a.sessions).slice(0, 8);
    const worst = [...eligible].sort((a, b) => a.purchases / a.sessions - b.purchases / b.sessions).slice(0, 8);
    lines.push(`Landing pages by sessions (site CVR ${pct(siteCvr * 100, 100)}):\n${top.map(r => `  - ${dim(r)}`).join('\n')}`);
    if (best.length) lines.push(`Best-converting landing pages (≥100 sessions):\n${best.map(r => `  - ${dim(r)}`).join('\n')}`);
    if (worst.length) lines.push(`Worst-converting landing pages (≥100 sessions — traffic that is not turning into orders):\n${worst.map(r => `  - ${dim(r)}`).join('\n')}`);
  }
  if (g.pages.length) lines.push(`Most-viewed pages:\n${g.pages.slice(0, 15).map(p => `  - ${p.path}${p.title ? ` (${p.title.slice(0, 60)})` : ''}: ${n(p.pageViews)} views · ${n(p.sessions)} sessions · engaged ${pct(p.engagedSessions, p.sessions)}`).join('\n')}`);
  if (g.status === 'partial') lines.push(`Some GA4 blocks failed: ${g.error}`);
  return lines.join('\n\n');
}
