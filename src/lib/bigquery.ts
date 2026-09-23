import { BigQuery } from '@google-cloud/bigquery';
import { marketplaceExclusionPredicate } from '@/src/lib/client';

// BigQuery is the data layer: Windsor syncs each client's connectors into a
// per-client dataset, and the dashboard queries those tables directly.
//
// Required env vars:
//   GCP_PROJECT_ID            — Google Cloud project id
//   GCP_SERVICE_ACCOUNT_KEY   — full service-account JSON key (single line)
//   BQ_DATASET                — dataset for this deployment's client (e.g. "rocknot")
//
// Expected tables in each dataset (set these names in the Windsor destination task):
//   shopify_orders, shopify_customers, facebook_ads, google_ads, tiktok_ads

let client: BigQuery | null = null;

// Env values pasted into Vercel can pick up stray whitespace (tabs/newlines);
// trim everything so a copy-paste artifact never breaks the connection.
function env(name: string): string {
  return (process.env[name] || '').trim();
}

export function isBigQueryConfigured(): boolean {
  return Boolean(env('GCP_PROJECT_ID') && env('GCP_SERVICE_ACCOUNT_KEY') && env('BQ_DATASET'));
}

export function getBigQuery(): BigQuery {
  if (!client) {
    const credentials = JSON.parse(env('GCP_SERVICE_ACCOUNT_KEY'));
    client = new BigQuery({
      projectId: env('GCP_PROJECT_ID'),
      credentials,
    });
  }
  return client;
}

export function getDataset(): string {
  return env('BQ_DATASET');
}

// All queries pass dates as parameters — never interpolate user input into SQL.
export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const bq = getBigQuery();
  const [rows] = await bq.query({ query: sql, params });
  return rows as T[];
}

// Optional tables (e.g. shopify_order_status) may not exist until their
// Windsor task first runs. Once seen, a table never disappears in practice,
// so cache positives for the life of the instance; negatives are re-checked
// each call so new tables get picked up without a redeploy.
const tableCache: Record<string, boolean> = {};

export async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const rows = await runQuery<{ ok: number }>(
      `SELECT 1 AS ok FROM \`${getDataset()}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = @t AND column_name = @c LIMIT 1`,
      { t: table, c: column }
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function tableExists(table: string): Promise<boolean> {
  if (tableCache[table]) return true;
  try {
    const rows = await runQuery<{ ok: number }>(
      `SELECT 1 AS ok FROM \`${getDataset()}\`.INFORMATION_SCHEMA.TABLES WHERE table_name = @t LIMIT 1`,
      { t: table }
    );
    if (rows.length > 0) {
      tableCache[table] = true;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}


// Windsor writes one row per order per sync-relevant date: the original
// order row (full price, on the order date), plus an extra row on each
// later date a refund/adjustment was made. Re-run backfills can also leave
// exact-duplicate rows (same order, date and values), so rows are collapsed
// with DISTINCT first. Yields one row per order, attributed to the order's
// earliest (placement) date:
//   total_price       — first-synced order_total_price (Shopify "total sales"
//                       basis; matches Shopify's report within ~1%)
//   net_sales         — order_net_sales SUMMED across all the order's rows,
//                       so later refund rows subtract. This is Shopify's
//                       "net sales" (after discounts AND returns): measured
//                       via /api/debug/orders-basis against ShopifyQL, YTD
//                       Rocknot +0.4%, Kailee P +1.9%. The old first-synced
//                       value was +5.5% and +47% respectively — a high-return
//                       store (Kailee P returns ~40% of gross) blew it up.
//   net_sales_placed  — first-synced order_net_sales (net BEFORE returns).
//                       This is exactly Shopify's AOV basis: Shopify AOV ×
//                       orders matched it within 0.03% on Rocknot.
// Excluding cancelled orders (via shopify_order_status) made both the order
// count and revenue further from Shopify's figures, so they stay included.
//
// A handful of rows have a null order_id (no duplicate refund rows to
// match against), so fall back to a per-row key for those rather than
// dropping them — excluding them undercounts both revenue and order count.
/**
 * Shopify-style daily sales from the Windsor order rows, for when Shopify's
 * own report is unavailable. Shopify attributes money to the day it moved:
 * an order counts on the day it was placed and a refund counts (negative) on
 * the day it was processed. Windsor stores exactly that — one row per order
 * event, dated by the event — so summing rows BY ROW DATE reproduces Shopify's
 * total_sales and net_sales for the day, while `orders` counts only the rows
 * that are an order's first appearance (its placement). `net_sales_placed`
 * is the placed orders' net before any later refund — Shopify's AOV basis.
 * (Verified on Kailee P, 2026-09-18: 71 orders, $6,546.74 total, $5,256.08
 * net — identical to Shopify Analytics.)
 */
export function dailyShopifySalesSql(ds: string, rowFilter = ''): string {
  return `
    WITH ev AS (
      SELECT DISTINCT
        COALESCE(CAST(order_id AS STRING), TO_JSON_STRING(STRUCT(date, order_total_price, order_net_sales, order_customer_id))) AS order_id,
        DATE(date) AS d,
        COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64), 0) AS total,
        COALESCE(CAST(order_net_sales AS FLOAT64), CAST(order_total_price AS FLOAT64), 0) AS net
      FROM \`${ds}.shopify_orders\`${rowFilter ? ` WHERE ${rowFilter}` : ''}
    ),
    first_seen AS (SELECT order_id, MIN(d) AS first_d FROM ev GROUP BY order_id)
    SELECT FORMAT_DATE('%Y-%m-%d', ev.d) AS date,
           COUNTIF(ev.d = f.first_d) AS orders,
           SUM(ev.total) AS total_sales,
           SUM(ev.net) AS net_sales,
           SUM(IF(ev.d = f.first_d, ev.net, 0)) AS net_sales_placed
    FROM ev JOIN first_seen f USING (order_id)
    WHERE ev.d BETWEEN @date_from AND @date_to
    GROUP BY date
  `;
}

export function dedupedOrdersCte(ds: string, rowFilter = ''): string {
  return `
    SELECT
      order_id,
      ANY_VALUE(cid) AS order_customer_id,
      MIN(d) AS order_date,
      (ARRAY_AGG(total ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS total_price,
      SUM(net) AS net_sales,
      (ARRAY_AGG(net ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS net_sales_placed
    FROM (
      SELECT DISTINCT
        COALESCE(CAST(order_id AS STRING), TO_JSON_STRING(STRUCT(date, order_total_price, order_net_sales, order_customer_id))) AS order_id,
        CAST(order_customer_id AS STRING) AS cid,
        DATE(date) AS d,
        COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64), 0) AS total,
        COALESCE(CAST(order_net_sales AS FLOAT64), CAST(order_total_price AS FLOAT64), 0) AS net
      FROM \`${ds}.shopify_orders\`${rowFilter ? ` WHERE ${rowFilter}` : ''}
    )
    GROUP BY order_id
  `;
}

/**
 * Row filter that keeps STORE orders only in `shopify_orders` (marketplace
 * channels such as Nordstrom dropped), or '' when there are no marketplaces or
 * the Windsor sync does not carry `order_source_name` yet. Cached per instance
 * once the column is seen.
 */
let ordersFilterCache: string | null = null;
export async function shopifyOrdersFilter(): Promise<string> {
  const pred = marketplaceExclusionPredicate();
  if (!pred) return '';
  if (ordersFilterCache !== null) return ordersFilterCache;
  const has = await columnExists('shopify_orders', 'order_source_name');
  if (has) ordersFilterCache = pred;
  return has ? pred : '';
}
