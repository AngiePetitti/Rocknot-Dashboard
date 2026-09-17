import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured, dedupedOrdersCte } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// Diagnostic for "BigQuery net sales don't match Shopify" on a client's
// shopify_orders table. Compares the raw Windsor rows, the deduped per-order
// view the dashboard uses as its ShopifyQL fallback, and ShopifyQL itself,
// over one date range, and shows sample orders where net > total.
//   /api/debug/orders-basis                      → year to date
//   /api/debug/orders-basis?from=2026-01-01&to=2026-09-17
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured in this environment' });
  }
  const ds = getDataset();
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = request.nextUrl.searchParams.get('from') || `${todayStr.slice(0, 4)}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || todayStr;
  const params = { from, to };
  const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
  const out: Record<string, unknown> = { dataset: ds, from, to };

  try {
    const cols = await runQuery<{ column_name: string }>(
      `SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'shopify_orders' ORDER BY column_name`, {}
    );
    out.columns = cols.map(c => c.column_name);
  } catch (e: unknown) { out.columns = { error: String(e instanceof Error ? e.message : e) }; }

  const has = (c: string) => Array.isArray(out.columns) && (out.columns as string[]).includes(c);
  const sumIf = (c: string) => (has(c) ? `SUM(CAST(${c} AS FLOAT64))` : 'NULL');

  try {
    const raw = await runQuery<Record<string, unknown>>(
      `SELECT COUNT(*) AS rows_in_range,
              COUNT(DISTINCT order_id) AS distinct_orders,
              COUNTIF(order_id IS NULL) AS null_order_id_rows,
              COUNTIF(order_customer_id IS NULL) AS null_customer_rows,
              ${sumIf('order_total_price')} AS sum_total_price,
              ${sumIf('order_net_sales')} AS sum_net_sales,
              ${sumIf('order_subtotal_price')} AS sum_subtotal_price,
              ${sumIf('order_gross_sales')} AS sum_gross_sales,
              ${sumIf('order_current_total_price')} AS sum_current_total_price
       FROM \`${ds}.shopify_orders\`
       WHERE DATE(date) BETWEEN @from AND @to`, params
    );
    const r = raw[0] || {};
    out.rawRows = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : num(v)]));
  } catch (e: unknown) { out.rawRows = { error: String(e instanceof Error ? e.message : e) }; }

  try {
    const d = await runQuery<Record<string, unknown>>(
      `WITH o AS (${dedupedOrdersCte(ds)})
       SELECT COUNT(*) AS orders,
              SUM(total_price) AS total_sales,
              SUM(net_sales) AS net_sales,
              COUNTIF(net_sales > total_price + 0.01) AS orders_net_gt_total,
              SUM(IF(net_sales > total_price + 0.01, net_sales - total_price, 0)) AS excess_net_over_total,
              COUNTIF(order_customer_id IS NULL) AS orders_without_customer
       FROM o WHERE order_date BETWEEN @from AND @to`, params
    );
    const r = d[0] || {};
    out.dedupedOrders = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
  } catch (e: unknown) { out.dedupedOrders = { error: String(e instanceof Error ? e.message : e) }; }

  try {
    const dist = await runQuery<{ rows_per_order: number; orders: number }>(
      `SELECT LEAST(rows_per_order, 5) AS rows_per_order, COUNT(*) AS orders
       FROM (SELECT order_id, COUNT(*) AS rows_per_order FROM \`${ds}.shopify_orders\`
             WHERE DATE(date) BETWEEN @from AND @to AND order_id IS NOT NULL GROUP BY order_id)
       GROUP BY rows_per_order ORDER BY rows_per_order`, params
    );
    out.rowsPerOrder = dist.map(x => ({ rowsPerOrder: Number(x.rows_per_order) >= 5 ? '5+' : Number(x.rows_per_order), orders: Number(x.orders) }));
  } catch (e: unknown) { out.rowsPerOrder = { error: String(e instanceof Error ? e.message : e) }; }

  try {
    const sample = await runQuery<Record<string, unknown>>(
      `WITH o AS (${dedupedOrdersCte(ds)}),
       bad AS (SELECT order_id FROM o WHERE order_date BETWEEN @from AND @to AND net_sales > total_price + 0.01 ORDER BY net_sales - total_price DESC LIMIT 3)
       SELECT CAST(s.order_id AS STRING) AS order_id, FORMAT_DATE('%Y-%m-%d', DATE(s.date)) AS date,
              ${has('order_total_price') ? 'CAST(s.order_total_price AS FLOAT64)' : 'NULL'} AS total_price,
              ${has('order_net_sales') ? 'CAST(s.order_net_sales AS FLOAT64)' : 'NULL'} AS net_sales,
              ${has('order_subtotal_price') ? 'CAST(s.order_subtotal_price AS FLOAT64)' : 'NULL'} AS subtotal_price,
              ${has('order_gross_sales') ? 'CAST(s.order_gross_sales AS FLOAT64)' : 'NULL'} AS gross_sales,
              ${has('order_current_total_price') ? 'CAST(s.order_current_total_price AS FLOAT64)' : 'NULL'} AS current_total_price
       FROM \`${ds}.shopify_orders\` s
       JOIN bad ON CAST(s.order_id AS STRING) = bad.order_id
       ORDER BY order_id, date`, params
    );
    out.sampleOrdersNetOverTotal = sample;
  } catch (e: unknown) { out.sampleOrdersNetOverTotal = { error: String(e instanceof Error ? e.message : e) }; }

  // Candidate per-order net-sales formulas, scored against ShopifyQL below.
  // Exact-duplicate rows (same order, date and values) are collapsed first.
  try {
    const cand = await runQuery<Record<string, unknown>>(
      `WITH rows_d AS (
         SELECT DISTINCT CAST(order_id AS STRING) AS order_id, DATE(date) AS d,
                CAST(order_total_price AS FLOAT64) AS total_price,
                CAST(order_net_sales AS FLOAT64) AS net_sales
         FROM \`${ds}.shopify_orders\` WHERE order_id IS NOT NULL
       ),
       per_order AS (
         SELECT order_id, MIN(d) AS order_date,
                (ARRAY_AGG(net_sales ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_net,
                (ARRAY_AGG(total_price ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_total,
                SUM(net_sales) AS net_after_refunds,
                SUM(total_price) AS total_after_refunds,
                COUNT(*) AS distinct_rows
         FROM rows_d GROUP BY order_id
       )
       SELECT COUNT(*) AS orders,
              SUM(first_net) AS a_first_net,
              SUM(net_after_refunds) AS b_net_after_refunds,
              SUM(first_total) AS c_first_total,
              SUM(total_after_refunds) AS d_total_after_refunds,
              SUM(distinct_rows) AS distinct_rows
       FROM per_order WHERE order_date BETWEEN @from AND @to`, params
    );
    const r = cand[0] || {};
    out.candidates = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
  } catch (e: unknown) { out.candidates = { error: String(e instanceof Error ? e.message : e) }; }

  try {
    const { fetchShopifyDaily } = await import('@/src/lib/bqOverview');
    const days = await fetchShopifyDaily(from, to);
    out.shopifyql = {
      days: days.length,
      orders: days.reduce((s, d) => s + d.orders, 0),
      totalSales: num(days.reduce((s, d) => s + d.totalSales, 0)),
      netSalesInclFees: num(days.reduce((s, d) => s + d.netSales, 0)),
      returnFees: num(days.reduce((s, d) => s + d.returnFees, 0)),
    };
  } catch (e: unknown) { out.shopifyql = { error: String(e instanceof Error ? e.message : e) }; }

  return NextResponse.json(out);
}
