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

    // Compare AOV candidates (first-synced order_total_price vs
    // order_net_sales vs order_gross_sales) against Shopify's reported AOV.
    const [aovCandidates] = await runQuery<Record<string, unknown>>(`
      WITH base AS (
        SELECT order_id, DATE(date) AS d,
               CAST(order_total_price AS FLOAT64) AS total_price,
               CAST(order_net_sales AS FLOAT64) AS net_sales,
               CAST(order_gross_sales AS FLOAT64) AS gross_sales
        FROM \`${ds}.shopify_orders\`
        WHERE order_id IS NOT NULL
      ),
      agg AS (
        SELECT order_id,
               MIN(d) AS order_date,
               (ARRAY_AGG(COALESCE(total_price, net_sales, 0) ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_total,
               (ARRAY_AGG(COALESCE(net_sales, 0) ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_net,
               (ARRAY_AGG(COALESCE(gross_sales, 0) ORDER BY d ASC LIMIT 1))[OFFSET(0)] AS first_gross
        FROM base
        GROUP BY order_id
      )
      SELECT
        COUNT(*) AS orders,
        ROUND(SUM(first_total) / COUNT(*), 2) AS aov_total_price,
        ROUND(SUM(first_net) / COUNT(*), 2) AS aov_net_sales,
        ROUND(SUM(first_gross) / COUNT(*), 2) AS aov_gross_sales,
        ROUND(SUM(first_total), 2) AS sum_total,
        ROUND(SUM(first_net), 2) AS sum_net,
        ROUND(SUM(first_gross), 2) AS sum_gross
      FROM agg
      WHERE order_date BETWEEN @from AND @to
    `, { from, to });

    // New-vs-returning customer diagnostics: replicate the dashboard's
    // firsts/period logic and surface lifetime-order counts to spot
    // whether "first order ever" is being computed correctly.
    const [customerStats] = await runQuery<Record<string, unknown>>(`
      WITH order_revenue AS (${dedupedOrdersCte(ds)}),
      firsts AS (
        SELECT order_customer_id AS cid, MIN(order_date) AS first_order, COUNT(*) AS lifetime_orders
        FROM order_revenue
        WHERE order_customer_id IS NOT NULL
        GROUP BY cid
      ),
      period AS (
        SELECT order_customer_id AS cid, SUM(total_price) AS revenue, COUNT(*) AS orders_in_period
        FROM order_revenue
        WHERE order_date BETWEEN @from AND @to AND order_customer_id IS NOT NULL
        GROUP BY cid
      )
      SELECT
        COUNT(*) AS period_customers,
        COUNTIF(f.first_order >= @from) AS new_customers,
        COUNTIF(f.first_order < @from) AS returning_customers,
        COUNTIF(f.lifetime_orders > 1) AS period_customers_with_gt1_lifetime_orders,
        COUNTIF(f.first_order < @from AND f.lifetime_orders = 1) AS returning_by_date_but_one_lifetime_order
      FROM period p
      JOIN firsts f USING (cid)
    `, { from, to });

    // Sanity-check order_customer_id coverage/format over time — a format
    // change between historical and recent syncs would break "first order
    // ever" lookups and make long-time customers look new.
    const customerIdByYear = await runQuery<Record<string, unknown>>(`
      SELECT
        EXTRACT(YEAR FROM DATE(date)) AS year,
        COUNT(*) AS rows,
        COUNT(DISTINCT order_customer_id) AS distinct_customer_ids,
        COUNTIF(order_customer_id IS NULL) AS null_customer_ids,
        ANY_VALUE(CAST(order_customer_id AS STRING)) AS sample_id
      FROM \`${ds}.shopify_orders\`
      GROUP BY year
      ORDER BY year
    `);

    let shopifyCustomersStats: Record<string, unknown> | null = null;
    let shopifyCustomersSample: Record<string, unknown>[] = [];
    if (await tableExists('shopify_customers')) {
      [shopifyCustomersStats] = await runQuery<Record<string, unknown>>(`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT customer_id) AS distinct_customers,
          COUNTIF(LOWER(CAST(customer_is_returning AS STRING)) IN ('true', '1')) AS flagged_returning
        FROM \`${ds}.shopify_customers\`
      `);
      shopifyCustomersSample = await runQuery<Record<string, unknown>>(`
        SELECT customer_id, customer_is_returning
        FROM \`${ds}.shopify_customers\`
        LIMIT 5
      `);
    }

    return NextResponse.json({
      range: { from, to },
      shopify_orders: ordersStats,
      deduplicated: dedupStats,
      shopify_order_status: statusStats,
      shopify_order_financials: financialsStats,
      dashboard_calculation: dashboardStats,
      aov_candidates: aovCandidates,
      customer_stats: customerStats,
      customer_id_by_year: customerIdByYear,
      shopify_customers: shopifyCustomersStats,
      shopify_customers_sample: shopifyCustomersSample,
      sample_duplicated_orders: sample,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
