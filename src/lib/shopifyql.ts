// ONE runner for every ShopifyQL report query the dashboard makes.
//
// Shopify limits shopifyqlQuery calls far more tightly than its ordinary
// Admin API ("Rate limited. Please retry later."). Every tab used to run its
// own copies of the same queries, so a single Overview load could fire a
// dozen and the Traffic / Nordstrom tabs a dozen more. This runner:
//   • caches results (Next data cache, shared across serverless instances):
//     10 min for ranges that ended before today, 90 s for ones that include today;
//   • de-duplicates in-flight calls inside an instance;
//   • backs off and retries (2 s, 5 s, 10 s) when Shopify says it is rate limited;
//   • uses one 20 s timeout.
import { unstable_cache } from 'next/cache';
import { shopifyDomain } from '@/src/lib/client';
import { todayPst } from '@/src/lib/timeframes';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();

export interface ShopifyQLResult {
  columns: { name: string; dataType?: string }[];
  rows: Array<Record<string, string> | string[]>;
}
export type Row = Record<string, string>;

export function shopifyConfigured(): boolean {
  return Boolean(TOKEN && shopifyDomain());
}

function isRateLimited(msg: string): boolean {
  return /rate limit|throttl|too many requests/i.test(msg);
}

async function runOnce(ql: string, timeoutMs: number): Promise<ShopifyQLResult> {
  const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { tableData { rows columns { name dataType } } parseErrors } }`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new Error('Rate limited. Please retry later.');
  const json = await res.json();
  const topErrors = (json?.errors as Array<{ message?: string }> | undefined) || [];
  if (topErrors.length) throw new Error(topErrors.map(e => e.message).join('; ') || 'Shopify GraphQL error');
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  return { columns: q?.tableData?.columns || [], rows: q?.tableData?.rows || [] };
}

async function runWithBackoff(ql: string, timeoutMs: number): Promise<ShopifyQLResult> {
  const waits = [2000, 5000, 10000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      return await runOnce(ql, timeoutMs);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Parse errors and auth errors will not fix themselves — give up at once.
      if (!isRateLimited(msg) && !/abort|timeout|fetch failed|ECONNRESET/i.test(msg)) throw e;
      if (attempt < waits.length) await new Promise(r => setTimeout(r, waits[attempt]));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Does the query's date range reach today (so results keep changing)? */
function touchesToday(ql: string): boolean {
  const today = todayPst();
  if (/UNTIL\s+today/i.test(ql) || /SINCE\s+today/i.test(ql)) return true;
  const m = ql.match(/UNTIL\s+(\d{4}-\d{2}-\d{2})/i);
  if (m) return m[1] >= today;
  return true; // no explicit range — be safe and cache briefly
}

const inflight = new Map<string, Promise<ShopifyQLResult>>();

/** Raw table result, cached + de-duplicated + rate-limit aware. */
export async function runShopifyQLRaw(ql: string, opts: { timeoutMs?: number; ttlSeconds?: number } = {}): Promise<ShopifyQLResult> {
  if (!TOKEN) throw new Error('SHOPIFY_ACCESS_TOKEN not set');
  const key = `${shopifyDomain()}|${ql}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const ttl = opts.ttlSeconds ?? (touchesToday(ql) ? 90 : 600);
  const timeoutMs = opts.timeoutMs ?? 20000;
  const cached = unstable_cache(() => runWithBackoff(ql, timeoutMs), ['shopifyql', key], { revalidate: ttl });
  const p = cached().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Rows as objects keyed by column name (works for array- and object-shaped rows). */
export async function shopifyql(ql: string, opts: { timeoutMs?: number; ttlSeconds?: number } = {}): Promise<Row[]> {
  const { columns, rows } = await runShopifyQLRaw(ql, opts);
  return rows.map(r => {
    if (!Array.isArray(r)) return r;
    const o: Row = {};
    columns.forEach((c, i) => { o[c.name] = r[i] ?? ''; });
    return o;
  });
}

/** Legacy shape some routes expect: { tableData: { rows, columns }, parseErrors }. */
export async function runShopifyQLLegacy(ql: string): Promise<{ tableData: { rows: ShopifyQLResult['rows']; columns: ShopifyQLResult['columns'] }; parseErrors: string | null }> {
  try {
    const r = await runShopifyQLRaw(ql);
    return { tableData: { rows: r.rows, columns: r.columns }, parseErrors: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Parse errors used to surface through parseErrors; keep that contract.
    if (!isRateLimited(msg)) return { tableData: { rows: [], columns: [] }, parseErrors: msg };
    throw e;
  }
}
