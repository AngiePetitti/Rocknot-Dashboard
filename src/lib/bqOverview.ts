import { runQuery, getDataset, dedupedOrdersCte } from '@/src/lib/bigquery';

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

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  // Direct sum from shopify_orders matches Shopify's "Total sales" methodology.
  // Shopify attributes refund adjustments to the date they occur, so
  // SUM(order_net_sales) WHERE date IN range = Shopify Net sales exactly.
  // Total sales = net_sales + shipping + taxes.
  // Try with shipping+tax columns first; fall back to net_sales only if they
  // don't exist yet (Windsor backfill still running).
  const buildSql = (includeShippingTax: boolean) => `
    WITH shopify AS (
      SELECT DATE(date) AS d,
             SUM(
               CAST(order_net_sales AS FLOAT64)
               ${includeShippingTax ? '+ IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0) + IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)' : ''}
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

  const customerSql = `
    WITH order_revenue AS (${dedupedOrdersCte(ds)}),
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
    runQuery<DailyRow>(buildSql(true), params)
      .catch(() => runQuery<DailyRow>(buildSql(false), params)),
    runQuery<CustomerRow>(customerSql, params),
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
