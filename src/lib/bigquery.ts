import { BigQuery } from '@google-cloud/bigquery';

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
// later date a refund/adjustment was made. Comparing candidate formulas
// against Shopify's own Orders/Total Sales report (see /api/debug/orders)
// showed the order's first-synced order_total_price — i.e. its value at
// placement, before any later refund/adjustment rows — summed across
// orders and attributed to the order's earliest (placement) date, is the
// closest match (within ~0.6%). Excluding cancelled orders (via
// shopify_order_status) made both the order count and revenue total
// further from Shopify's reported figures, so cancelled orders are
// included here too. Yields one row per order: order_id,
// order_customer_id, order_date, total_price, net_sales (also each
// order's first-synced value — AOV based on net_sales matches Shopify's
// reported AOV much closer than total_price, within ~0.1%).
//
// A handful of rows have a null order_id (no duplicate refund rows to
// match against), so fall back to a per-row key for those rather than
// dropping them — excluding them undercounts both revenue and order count.
export function dedupedOrdersCte(ds: string): string {
  return `
    SELECT
      COALESCE(CAST(order_id AS STRING), TO_JSON_STRING(STRUCT(date, order_total_price, order_net_sales, order_customer_id))) AS order_id,
      ANY_VALUE(CAST(order_customer_id AS STRING)) AS order_customer_id,
      MIN(DATE(date)) AS order_date,
      (ARRAY_AGG(COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64), 0) ORDER BY date ASC LIMIT 1))[OFFSET(0)] AS total_price,
      (ARRAY_AGG(COALESCE(CAST(order_net_sales AS FLOAT64), CAST(order_total_price AS FLOAT64), 0) ORDER BY date ASC LIMIT 1))[OFFSET(0)] AS net_sales
    FROM \`${ds}.shopify_orders\`
    GROUP BY order_id
  `;
}
