import { runQuery, getDataset, dedupedOrdersCte, dedupedFacebookAdsCte, dedupedGoogleAdsCte, dedupedTiktokAdsCte, dedupedTiktokAdsCteLegacy } from '@/src/lib/bigquery';

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

interface AdsRow {
  date: string;
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

// Per-day Shopify numbers come straight from ShopifyQL — the same source as
// Shopify's own "Total sales" report. This is the ONLY way to match Shopify's
// figures exactly: returns/refunds are attributed to the original order date by
// Shopify and are not reconstructable from Windsor's BigQuery order rows (which
// record refund adjustments on separate rows dated to the refund day).
interface ShopifyDay {
  date: string;
  totalSales: number;
  netSales: number;
  orders: number;
}

// Trim env values: Vercel copy-paste often leaves a trailing newline, which
// corrupts the auth header (401) and the request host.
const SHOPIFY_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

async function fetchShopifyDaily(from: string, to: string): Promise<ShopifyDay[]> {
  if (!SHOPIFY_TOKEN) return [];
  const ql = `FROM sales SHOW orders, net_sales, total_sales TIMESERIES day SINCE ${from} UNTIL ${to}`;
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
        tableData { rows columns { name } }
        parseErrors
      }}`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  // The live Admin API returns each row as an object keyed by column name;
  // some clients/versions return positional arrays. Support both.
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return rows.map(r => ({
    date: (cell(r, 'day') || '').split('T')[0],
    orders: Math.round(parseFloat(cell(r, 'orders') || '0')),
    netSales: parseFloat(cell(r, 'net_sales') || '0'),
    totalSales: parseFloat(cell(r, 'total_sales') || '0'),
  }));
}

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  // Ad spend + platform-attributed revenue from BigQuery (Windsor-synced).
  // Each platform CTE deduplicates by (date, ad_id) first — Windsor re-syncs
  // intraday and inserts duplicate rows, so a plain SUM over-counts today's spend.
  const adsSql = `
    WITH meta_raw AS (${dedupedFacebookAdsCte(ds)}),
    meta AS (
      SELECT d,
             SUM(spend) AS spend,
             SUM(revenue) AS revenue
      FROM meta_raw
      WHERE d BETWEEN @date_from AND @date_to
        AND LOWER(account_name) = 'rocknot'
      GROUP BY d
    ),
    google_raw AS (${dedupedGoogleAdsCte(ds)}),
    google AS (
      SELECT d,
             SUM(spend) AS spend,
             SUM(revenue) AS revenue
      FROM google_raw
      WHERE d BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    tiktok_raw AS (${dedupedTiktokAdsCte(ds)}),
    tiktok AS (
      SELECT d,
             SUM(spend) AS spend,
             SUM(revenue) AS revenue
      FROM tiktok_raw
      WHERE d BETWEEN @date_from AND @date_to
      GROUP BY d
    ),
    days AS (SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(@date_from, @date_to)) AS d)
    SELECT
      FORMAT_DATE('%Y-%m-%d', days.d) AS date,
      IFNULL(meta.spend, 0)     AS meta_spend,
      IFNULL(google.spend, 0)   AS google_spend,
      IFNULL(tiktok.spend, 0)   AS tiktok_spend,
      IFNULL(meta.revenue, 0)   AS meta_revenue,
      IFNULL(google.revenue, 0) AS google_revenue,
      IFNULL(tiktok.revenue, 0) AS tiktok_revenue
    FROM days
    LEFT JOIN meta   ON meta.d = days.d
    LEFT JOIN google ON google.d = days.d
    LEFT JOIN tiktok ON tiktok.d = days.d
    ORDER BY days.d
  `;

  // New vs returning customer split (placement-date attribution from BigQuery).
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

  // Fallback: replace the tiktok_raw CTE with the legacy revenue column.
  const adsSqlLegacyTiktok = adsSql.replace(
    `tiktok_raw AS (${dedupedTiktokAdsCte(ds)})`,
    `tiktok_raw AS (${dedupedTiktokAdsCteLegacy(ds)})`
  );

  const [shopifyDays, adsRows, custRows] = await Promise.all([
    fetchShopifyDaily(dateFrom, dateTo).catch(() => [] as ShopifyDay[]),
    runQuery<AdsRow>(adsSql, params).catch(() => runQuery<AdsRow>(adsSqlLegacyTiktok, params)).catch(() => [] as AdsRow[]),
    runQuery<CustomerRow>(customerSql, params).catch(() => [] as CustomerRow[]),
  ]);

  const cust = custRows[0] ?? {
    new_customers: 0,
    returning_customers: 0,
    new_customer_revenue: 0,
    returning_customer_revenue: 0,
  };

  const shopifyByDate: Record<string, ShopifyDay> = {};
  for (const s of shopifyDays) shopifyByDate[s.date] = s;

  let totalRevenue = 0, totalNetSales = 0, totalOrders = 0;
  let metaSpend = 0, googleSpend = 0, tiktokSpend = 0;
  let metaRevenue = 0, googleRevenue = 0, tiktokRevenue = 0;

  // The ads query always emits one row per day across the full range, so it
  // drives the daily series; Shopify figures are overlaid by date.
  const dayDates = adsRows.length > 0 ? adsRows.map(r => r.date) : shopifyDays.map(s => s.date);
  const adsByDate: Record<string, AdsRow> = {};
  for (const a of adsRows) adsByDate[a.date] = a;

  const revenueData = dayDates.map(date => {
    const a = adsByDate[date];
    const s = shopifyByDate[date];
    const revenue = s ? s.totalSales : 0;
    const orders = s ? s.orders : 0;
    const adSpend = Number(a?.meta_spend || 0) + Number(a?.google_spend || 0) + Number(a?.tiktok_spend || 0);

    totalRevenue += revenue;
    totalNetSales += s ? s.netSales : 0;
    totalOrders += orders;
    metaSpend += Number(a?.meta_spend || 0);
    googleSpend += Number(a?.google_spend || 0);
    tiktokSpend += Number(a?.tiktok_spend || 0);
    metaRevenue += Number(a?.meta_revenue || 0);
    googleRevenue += Number(a?.google_revenue || 0);
    tiktokRevenue += Number(a?.tiktok_revenue || 0);

    return { date, revenue: Math.round(revenue), orders, adSpend: Math.round(adSpend) };
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
