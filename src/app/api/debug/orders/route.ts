import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured, tableExists, dedupedOrdersCte } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// Temporary diagnostics for reconciling shopify_orders against Shopify's own
// reports: row duplication, field coverage, and cancelled-order counts.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured' });
  }
  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from') || '2026-01-01';
  const to = searchParams.get('to') || '2026-06-12';
  const ds = getDataset();

  try {
    const [ordersStats] = await runQuery<Record<string, unknown>>(`
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT order_id) AS distinct_orders,
        COUNT(*) - COUNT(DISTINCT order_id) AS duplicate_rows,
        COUNTIF(order_id IS NULL) AS null_order_id_rows,
        ROUND(SUM(IF(order_id IS NULL, COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64), 0), 0)), 2) AS sum_null_order_id,
        ROUND(SUM(CAST(order_total_price AS FLOAT64)), 2) AS sum_total_price,
        ROUND(SUM(CAST(order_gross_sales AS FLOAT64)), 2) AS sum_gross_sales,
        ROUND(SUM(CAST(order_net_sales AS FLOAT64)), 2) AS sum_net_sales,
        COUNTIF(order_total_price IS NULL) AS null_total_price_rows,
        ROUND(SUM(COALESCE(CAST(order_total_price AS FLOAT64), CAST(order_net_sales AS FLOAT64))), 2) AS sum_coalesced
      FROM \`${ds}.shopify_orders\`
      WHERE DATE(date) BETWEEN @from AND @to
    `, { from, to });

    // Same numbers but deduplicated to one row per order, to show what the
    // totals would be if duplicates were collapsed.
    const [dedupStats] = await runQuery<Record<string, unknown>>(`
      WITH one_per_order AS (
        SELECT order_id,
               ANY_VALUE(CAST(order_total_price AS FLOAT64)) AS total_price,
               ANY_VALUE(CAST(order_net_sales AS FLOAT64)) AS net_sales
        FROM \`${ds}.shopify_orders\`
        WHERE DATE(date) BETWEEN @from AND @to
        GROUP BY order_id
      )
      SELECT
        COUNT(*) AS orders,
        ROUND(SUM(total_price), 2) AS sum_total_price,
        ROUND(SUM(net_sales), 2) AS sum_net_sales
      FROM one_per_order
    `, { from, to });

    let statusStats: Record<string, unknown> | null = null;
    if (await tableExists('shopify_order_status')) {
      [statusStats] = await runQuery<Record<string, unknown>>(`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT order_id) AS distinct_orders,
          COUNTIF(LOWER(TRIM(IFNULL(CAST(order_cancelled_at AS STRING), ''))) NOT IN ('', 'null', 'none', 'nan', '0', 'false')) AS cancelled_rows,
          MIN(DATE(date)) AS earliest_date,
          MAX(DATE(date)) AS latest_date
        FROM \`${ds}.shopify_order_status\`
      `);
    }

    let financialsStats: Record<string, unknown> | null = null;
    if (await tableExists('shopify_order_financials')) {
      [financialsStats] = await runQuery<Record<string, unknown>>(`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT order_id) AS distinct_orders,
          ROUND(SUM(CAST(order_total_price AS FLOAT64)), 2) AS sum_total_price,
          MIN(DATE(date)) AS earliest_date,
          MAX(DATE(date)) AS latest_date
        FROM \`${ds}.shopify_order_financials\`
        WHERE DATE(date) BETWEEN @from AND @to
      `, { from, to });
    }

    // What the dashboard actually computes: each order's first-synced
    // order_total_price, attributed to the order's earliest date —
    // bucketed by whether that earliest date falls in the requested range.
    const [dashboardStats] = await runQuery<Record<string, unknown>>(`
      WITH order_revenue AS (${dedupedOrdersCte(ds)})
      SELECT
        COUNT(*) AS orders,
        ROUND(SUM(total_price), 2) AS sum_total_price
      FROM order_revenue
      WHERE order_date BETWEEN @from AND @to
    `, { from, to });

    const sample = await runQuery<Record<string, unknown>>(`
      SELECT order_id, COUNT(*) AS copies,
             ARRAY_AGG(CAST(order_total_price AS STRING) LIMIT 3) AS total_prices,
             ARRAY_AGG(CAST(order_net_sales AS STRING) LIMIT 3) AS net_sales,
             ARRAY_AGG(FORMAT_DATE('%Y-%m-%d', DATE(date)) LIMIT 3) AS dates
      FROM \`${ds}.shopify_orders\`
      WHERE DATE(date) BETWEEN @from AND @to
      GROUP BY order_id
      HAVING COUNT(*) > 1
      ORDER BY copies DESC
      LIMIT 5
    `, { from, to });

    // Compare candidate formulas (first/last/sum-of-rows, with/without the
    // cancelled-order filter) against Shopify's own Orders/Total Sales for
    // this range, to find which one actually matches.
    const [formulas] = await runQuery<Record<string, unknown>>(`
      WITH base AS (
        SELECT order_id, DATE(date) AS d,
               CAST(order_total_price AS FLOAT64) AS total_price,
               CAST(order_net_sales AS FLOAT64) AS net_sales
        FROM \`${ds}.shopify_orders\`
        WHERE order_id IS NOT NULL
      ),
      agg AS (
        SELECT order_id,
               MIN(d) AS order_date,
               SUM(COALESCE(total_price, net_sales, 0)) AS sum_all,
               (ARRAY_AGG(COALESCE(total_price, net_sales, 0) ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_val,
               (ARRAY_AGG(COALESCE(total_price, net_sales, 0) ORDER BY d DESC LIMIT 1))[OFFSET(0)] AS last_val
        FROM base
        GROUP BY order_id
      ),
      cancelled AS (
        SELECT DISTINCT order_id FROM \`${ds}.shopify_order_status\`
        WHERE LOWER(TRIM(IFNULL(CAST(order_cancelled_at AS STRING), ''))) NOT IN ('', 'null', 'none', 'nan', '0', 'false')
      ),
      in_range AS (
        SELECT a.*, c.order_id IS NOT NULL AS is_cancelled
        FROM agg a
        LEFT JOIN cancelled c ON c.order_id = a.order_id
        WHERE a.order_date BETWEEN @from AND @to
      )
      SELECT
        COUNT(*) AS orders_in_range,
        COUNTIF(NOT is_cancelled) AS orders_in_range_not_cancelled,
        COUNTIF(is_cancelled) AS cancelled_in_range,
        ROUND(SUM(first_val), 2) AS sum_first,
        ROUND(SUM(last_val), 2) AS sum_last,
        ROUND(SUM(sum_all), 2) AS sum_all_rows,
        ROUND(SUM(IF(NOT is_cancelled, first_val, 0)), 2) AS sum_first_not_cancelled,
        ROUND(SUM(IF(NOT is_cancelled, last_val, 0)), 2) AS sum_last_not_cancelled,
        ROUND(SUM(IF(NOT is_cancelled, sum_all, 0)), 2) AS sum_all_not_cancelled
      FROM in_range
    `, { from, to });

    return NextResponse.json({
      range: { from, to },
      shopify_orders: ordersStats,
      deduplicated: dedupStats,
      shopify_order_status: statusStats,
      shopify_order_financials: financialsStats,
      dashboard_calculation: dashboardStats,
      formulas,
      sample_duplicated_orders: sample,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
