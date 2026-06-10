import { runQuery, getDataset } from '@/src/lib/bigquery';

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
    pctNew: number;
    pctReturning: number;
  };
  revenueData: Array<{ date: string; revenue: number; orders: number; adSpend: number }>;
  revenueSource: 'shopify' | 'none';
}

interface DailyRow {
  date: { value: string } | string;
  revenue: number | null;
  orders: number | null;
  meta_spend: number | null;
  google_spend: number | null;
  tiktok_spend: number | null;
  meta_revenue: number | null;
  google_revenue: number | null;
  tiktok_revenue: number | null;
  new_customers: number | null;
  returning_customers: number | null;
}

function dateStr(d: DailyRow['date']): string {
  return typeof d === 'string' ? d : d.value;
}

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();

  // One daily rollup joining all sources. Column names verified against the
  // actual Windsor-created BigQuery schema (rocknot dataset, Jun 2026).
  const sql = `
    WITH shopify AS (
      SELECT DATE(date) AS d,
             SUM(COALESCE(CAST(order_net_sales AS FLOAT64), CAST(order_total_price AS FLOAT64))) AS revenue,
             COUNT(DISTINCT order_id) AS orders
      FROM \`${ds}.shopify_orders\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    customers AS (
      SELECT DATE(o.date) AS d,
             COUNTIF(LOWER(IFNULL(CAST(c.customer_is_returning AS STRING), 'false')) NOT IN ('true', '1')) AS new_customers,
             COUNTIF(LOWER(IFNULL(CAST(c.customer_is_returning AS STRING), 'false')) IN ('true', '1')) AS returning_customers
      FROM \`${ds}.shopify_orders\` o
      LEFT JOIN \`${ds}.shopify_customers\` c
        ON CAST(o.order_customer_id AS STRING) = CAST(c.customer_id AS STRING)
      WHERE DATE(o.date) BETWEEN @date_from AND @date_to
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
      IFNULL(shopify.orders, 0)               AS orders,
      IFNULL(meta.spend, 0)                   AS meta_spend,
      IFNULL(google.spend, 0)                 AS google_spend,
      IFNULL(tiktok.spend, 0)                 AS tiktok_spend,
      IFNULL(meta.revenue, 0)                 AS meta_revenue,
      IFNULL(google.revenue, 0)               AS google_revenue,
      IFNULL(tiktok.revenue, 0)               AS tiktok_revenue,
      IFNULL(customers.new_customers, 0)      AS new_customers,
      IFNULL(customers.returning_customers, 0) AS returning_customers
    FROM days
    LEFT JOIN shopify   ON shopify.d = days.d
    LEFT JOIN customers ON customers.d = days.d
    LEFT JOIN meta      ON meta.d = days.d
    LEFT JOIN google    ON google.d = days.d
    LEFT JOIN tiktok    ON tiktok.d = days.d
    ORDER BY days.d
  `;

  const rows = await runQuery<DailyRow>(sql, { date_from: dateFrom, date_to: dateTo });

  let totalRevenue = 0, totalOrders = 0;
  let metaSpend = 0, googleSpend = 0, tiktokSpend = 0;
  let metaRevenue = 0, googleRevenue = 0, tiktokRevenue = 0;
  let newCustomers = 0, returningCustomers = 0;

  const revenueData = rows.map(r => {
    const revenue = Number(r.revenue || 0);
    const orders = Number(r.orders || 0);
    const adSpend = Number(r.meta_spend || 0) + Number(r.google_spend || 0) + Number(r.tiktok_spend || 0);

    totalRevenue += revenue;
    totalOrders += orders;
    metaSpend += Number(r.meta_spend || 0);
    googleSpend += Number(r.google_spend || 0);
    tiktokSpend += Number(r.tiktok_spend || 0);
    metaRevenue += Number(r.meta_revenue || 0);
    googleRevenue += Number(r.google_revenue || 0);
    tiktokRevenue += Number(r.tiktok_revenue || 0);
    newCustomers += Number(r.new_customers || 0);
    returningCustomers += Number(r.returning_customers || 0);

    return { date: dateStr(r.date), revenue: Math.round(revenue), orders, adSpend: Math.round(adSpend) };
  });

  const totalAdSpend = metaSpend + googleSpend + tiktokSpend;
  const totalCust = newCustomers + returningCustomers;

  return {
    metrics: {
      totalRevenue: Math.round(totalRevenue),
      totalOrders,
      totalAdSpend: Math.round(totalAdSpend),
      aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
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
      pctNew: totalCust > 0 ? Math.round((newCustomers / totalCust) * 1000) / 10 : 0,
      pctReturning: totalCust > 0 ? Math.round((returningCustomers / totalCust) * 1000) / 10 : 0,
    },
    revenueData,
    revenueSource: totalRevenue > 0 ? 'shopify' : 'none',
  };
}
