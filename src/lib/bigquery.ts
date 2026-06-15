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

// SQL fragment excluding cancelled orders, matching Shopify's reports (which
// never count cancelled orders). Empty string until the shopify_order_status
// sync exists. Windsor writes order_cancelled_at as a string and uses text
// like "null"/"" (not SQL NULL) for non-cancelled orders, so only treat rows
// as cancelled when the value looks like an actual timestamp. The inner
// IS NOT NULL guard on order_id keeps NOT IN sane.
// Windsor writes one row per order per sync-relevant date: the original
// order row (full price, on the order date), plus an extra row on each
// later date a refund/adjustment was made (carrying a negative delta in
// order_total_price/order_net_sales). The order's final, post-refund total
// is therefore the SUM of order_total_price across ALL of its rows —
// regardless of which date they fall on — attributed to the order's
// earliest (placement) date, matching how Shopify's "Total sales" report
// buckets refunds against the original order date. Yields one row per
// order_id: order_id, order_customer_id, order_date, total_price.
export function dedupedOrdersCte(ds: string, noCancelled: string): string {
  return `
    SELECT order_id,
           ANY_VALUE(CAST(order_customer_id AS STRING)) AS order_customer_id,
           MIN(DATE(date)) AS order_date,
           SUM(COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64), 0)) AS total_price
    FROM \`${ds}.shopify_orders\`
    WHERE order_id IS NOT NULL${noCancelled}
    GROUP BY order_id
  `;
}

export async function cancelledOrderClause(): Promise<string> {
  if (!(await tableExists('shopify_order_status'))) return '';
  return ` AND order_id NOT IN (
    SELECT order_id FROM \`${getDataset()}.shopify_order_status\`
    WHERE order_id IS NOT NULL
      AND LOWER(TRIM(IFNULL(CAST(order_cancelled_at AS STRING), ''))) NOT IN ('', 'null', 'none', 'nan', '0', 'false')
  )`;
}
