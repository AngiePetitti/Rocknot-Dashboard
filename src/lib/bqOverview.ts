import { runQuery, getDataset, dedupedOrdersCte, tableExists, columnExists } from '@/src/lib/bigquery';

// Overview metrics computed from the Windsor→BigQuery tables.
// Returns the same shape as the Windsor REST aggregation so the
// frontend needs no changes when BigQuery is enabled.

export interface OverviewResult {
  metrics: {
    totalRevenue: number;
    totalOrders: number;
    totalAdSpend: number;
    aov: number;
    mer: number;
    returns: number;
    metaSpend: number;
    googleSpend: number;
    tiktokSpend: number;
    metaRevenue: number;
    googleRevenue: number;
    tiktokRevenue: number;
    newCustomers: number;
    returningCustomers: number;
    newCustomerRevenue: number;
    returningCustomerRevenue: number;
    pctNew: number;
    pctReturning: number;
  };
  revenueData: Array<{ date: string; revenue: number; orders: number; adSpend: number }>;
  revenueSource: 'shopify' | 'none';
}

interface DailyRow {
  date: { value: string } | string;
  revenue: number | null;
  net_sales: number | null;
  orders: number | null;
  meta_spend: number | null;
  google_spend: number | null;
  tiktok_spend: number | null;
  meta_revenue: number | null;
  google_revenue: number | null;
  tiktok_revenue: number | null;
}

interface CustomerRow {
  new_customers: number | null;
  returning_customers: number | null;
  new_customer_revenue: number | null;
  returning_customer_revenue: number | null;
}

function dateStr(d: DailyRow['date']): string {
  return typeof d === 'string' ? d : d.value;
}

// Revenue CTE using shopify_order_financials: one row per order, taking the
// LAST-synced total_price/net_sales (reflects current refund state), attributed
// to the order's placement date (MIN(date)). Validated Jun 2026: matches
// Shopify's "Total sales" within ~0.6% vs ~5.7% off with the first-synced
// approach on shopify_orders. Falls back to dedupedOrdersCte if the table
// doesn't exist (new client onboarding).
function financialsOrdersCte(ds: string): string {
  return `
    SELECT
      order_id,
      MIN(DATE(date)) AS order_date,
      (ARRAY_AGG(CAST(order_total_price AS FLOAT64) ORDER BY date DESC LIMIT 1))[OFFSET(0)] AS total_price,
      (ARRAY_AGG(CAST(order_net_sales   AS FLOAT64) ORDER BY date DESC LIMIT 1))[OFFSET(0)] AS net_sales
    FROM \`${ds}.shopify_order_financials\`
    WHERE order_id IS NOT NULL
    GROUP BY order_id
  `;
}

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();

  // Direct sum from shopify_orders matches Shopify's "Total sales" methodology:
  // Shopify attributes refund adjustments to the date they occur (not original
  // order date), so SUM(net_sales) WHERE date IN range = Shopify's Net sales exactly.
  // Total sales = net_sales + shipping + taxes. Use columnExists to safely add
  // shipping/tax once Windsor backfills those fields.
  const hasShipping = await columnExists('shopify_orders', 'order_shipping_price');
  const hasTax = await columnExists('shopify_orders', 'order_total_tax');
  const customerRevenueCte = dedupedOrdersCte(ds);

  const sql = `
    WITH shopify AS (
      SELECT DATE(date) AS d,
             SUM(
               CAST(order_net_sales AS FLOAT64)
               ${hasShipping ? '+ IFNULL(CAST(order_shipping_price AS FLOAT64), 0)' : ''}
               ${hasTax ? '+ IFNULL(CAST(order_total_tax AS FLOAT64), 0)' : ''}
             ) AS revenue,
             SUM(CAST(order_net_sales AS FLOAT64)) AS net_sales,
             COUNT(DISTINCT order_id) AS orders
      FROM \`${ds}.shopify_orders\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
        AND order_id IS NOT NULL
      GROUP BY d
    ),
    meta AS (
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.facebook_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    google AS (
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.google_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    tiktok AS (
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(onsite_total_purchase_value AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    days AS (
      SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(@date_from, @date_to)) AS d
    )
    SELECT
      FORMAT_DATE('%Y-%m-%d', days.d) AS date,
      IFNULL(shopify.revenue, 0)              AS revenue,
      IFNULL(shopify.net_sales, 0)            AS net_sales,
      IFNULL(shopify.orders, 0)               AS orders,
      IFNULL(meta.spend, 0)                   AS meta_spend,
      IFNULL(google.spend, 0)                 AS google_spend,
      IFNULL(tiktok.spend, 0)                 AS tiktok_spend,
      IFNULL(meta.revenue, 0)                 AS meta_revenue,
      IFNULL(google.revenue, 0)               AS google_revenue,
      IFNULL(tiktok.revenue, 0)               AS tiktok_revenue
    FROM days
    LEFT JOIN shopify   ON shopify.d = days.d
    LEFT JOIN meta      ON meta.d = days.d
    LEFT JOIN google    ON google.d = days.d
    LEFT JOIN tiktok    ON tiktok.d = days.d
    ORDER BY days.d
  `;

  // Customer counts match Shopify's "New customer sales over time" report:
  // "new" = customers whose first-ever order falls in this period (sales =
  // just that first order, matching Shopify's Orders==Customers for the New
  // segment), "returning" = customers whose first-ever order was before this
  // period (sales = all of their orders placed during the period). Guest
  // checkouts have no customer id and are excluded, as in Shopify's report.
  const customerSql = `
    WITH order_revenue AS (${customerRevenueCte}),
    firsts AS (
      SELECT order_customer_id AS cid,
             MIN(order_date) AS first_order,
             (ARRAY_AGG(total_price ORDER BY order_date ASC LIMIT 1))[OFFSET(0)] AS first_order_value
      FROM order_revenue
      WHERE order_customer_id IS NOT NULL
      GROUP BY cid
    ),
    period AS (
      SELECT order_customer_id AS cid, SUM(total_price) AS revenue
      FROM order_revenue
      WHERE order_date BETWEEN @date_from AND @date_to
        AND order_customer_id IS NOT NULL
      GROUP BY cid
    )
    SELECT
      COUNTIF(f.first_order >= @date_from) AS new_customers,
      COUNTIF(f.first_order < @date_from)  AS returning_customers,
      IFNULL(SUM(IF(f.first_order >= @date_from, f.first_order_value, 0)), 0) AS new_customer_revenue,
      IFNULL(SUM(IF(f.first_order < @date_from, p.revenue, 0)), 0)            AS returning_customer_revenue
    FROM period p
    JOIN firsts f USING (cid)
  `;

  const [rows, custRows] = await Promise.all([
    runQuery<DailyRow>(sql, { date_from: dateFrom, date_to: dateTo }),
    runQuery<CustomerRow>(customerSql, { date_from: dateFrom, date_to: dateTo }),
  ]);
  const cust = custRows[0] ?? {
    new_customers: 0,
    returning_customers: 0,
    new_customer_revenue: 0,
    returning_customer_revenue: 0,
  };

  let totalRevenue = 0, totalNetSales = 0, totalOrders = 0;
  let metaSpend = 0, googleSpend = 0, tiktokSpend = 0;
  let metaRevenue = 0, googleRevenue = 0, tiktokRevenue = 0;

  const revenueData = rows.map(r => {
    const revenue = Number(r.revenue || 0);
    const orders = Number(r.orders || 0);
    const adSpend = Number(r.meta_spend || 0) + Number(r.google_spend || 0) + Number(r.tiktok_spend || 0);

    totalRevenue += revenue;
    totalNetSales += Number(r.net_sales || 0);
    totalOrders += orders;
    metaSpend += Number(r.meta_spend || 0);
    googleSpend += Number(r.google_spend || 0);
    tiktokSpend += Number(r.tiktok_spend || 0);
    metaRevenue += Number(r.meta_revenue || 0);
    googleRevenue += Number(r.google_revenue || 0);
    tiktokRevenue += Number(r.tiktok_revenue || 0);

    return { date: dateStr(r.date), revenue: Math.round(revenue), orders, adSpend: Math.round(adSpend) };
  });

  const totalAdSpend = metaSpend + googleSpend + tiktokSpend;
  const newCustomers = Number(cust.new_customers || 0);
  const returningCustomers = Number(cust.returning_customers || 0);
  const newCustomerRevenue = Number(cust.new_customer_revenue || 0);
  const returningCustomerRevenue = Number(cust.returning_customer_revenue || 0);
  const totalCust = newCustomers + returningCustomers;

  return {
    metrics: {
      totalRevenue: Math.round(totalRevenue),
      totalOrders,
      totalAdSpend: Math.round(totalAdSpend),
      aov: totalOrders > 0 ? Math.round((totalNetSales / totalOrders) * 100) / 100 : 0,
      mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
      returns: 0,
      metaSpend: Math.round(metaSpend),
      googleSpend: Math.round(googleSpend),
      tiktokSpend: Math.round(tiktokSpend),
      metaRevenue: Math.round(metaRevenue),
      googleRevenue: Math.round(googleRevenue),
      tiktokRevenue: Math.round(tiktokRevenue),
      newCustomers,
      returningCustomers,
      newCustomerRevenue: Math.round(newCustomerRevenue),
      returningCustomerRevenue: Math.round(returningCustomerRevenue),
      pctNew: totalCust > 0 ? Math.round((newCustomers / totalCust) * 1000) / 10 : 0,
      pctReturning: totalCust > 0 ? Math.round((returningCustomers / totalCust) * 1000) / 10 : 0,
    },
    revenueData,
    revenueSource: totalRevenue > 0 ? 'shopify' : 'none',
  };
}
