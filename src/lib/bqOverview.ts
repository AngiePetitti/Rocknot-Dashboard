import { runQuery, getDataset, dedupedOrdersCte } from '@/src/lib/bigquery';

export interface OverviewResult {
  adsError?: string;
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
  revenueData: Array<{ date: string; revenue: number; orders: number; adSpend: number; newCustomers: number; totalCustomers: number }>;
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

export async function fetchShopifyDaily(from: string, to: string): Promise<ShopifyDay[]> {
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

export interface ShopifyCustomerSplit {
  newCustomers: number;
  returningCustomers: number;
  newRevenue: number;
  returningRevenue: number;
}

export async function fetchShopifyCustomerSplit(from: string, to: string): Promise<ShopifyCustomerSplit | null> {
  if (!SHOPIFY_TOKEN) return null;
  // ShopifyQL does not support GROUP BY customer_type. Instead, use the
  // built-in returning_customers dimension alongside total customers.
  const ql = `FROM sales SHOW gross_sales, customers, returning_customers SINCE ${from} UNTIL ${to}`;
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
  if (typeof q?.parseErrors === 'string' && q.parseErrors) return null;
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  if (rows.length === 0) return null;
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  const r = rows[0];
  const totalCustomers = Math.round(parseFloat(cell(r, 'customers') || '0'));
  const returningCustomers = Math.round(parseFloat(cell(r, 'returning_customers') || '0'));
  const newCustomers = Math.max(0, totalCustomers - returningCustomers);
  const totalRevenue = parseFloat(cell(r, 'gross_sales') || '0');
  if (totalCustomers === 0) return null;
  // Revenue split is proportional to customer count — best available from ShopifyQL.
  const newRevenue = totalCustomers > 0 ? (newCustomers / totalCustomers) * totalRevenue : 0;
  const returningRevenue = totalCustomers > 0 ? (returningCustomers / totalCustomers) * totalRevenue : 0;
  return { newCustomers, returningCustomers, newRevenue, returningRevenue };
}

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  const adsSql = `
    WITH meta AS (
      -- Windsor stores one row per ADSET (only the campaign name is exposed, so
      -- a campaign's adsets share a campaign value and appear as multiple rows
      -- with independent spend/clicks/purchases). They must be SUMMED to get the
      -- true campaign total — do not dedup.
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.facebook_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to
        AND LOWER(account_name) = 'rocknot'
      GROUP BY d
    ),
    google AS (
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.google_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
    ),
    tiktok AS (
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(total_complete_payment_rate AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
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

  const adsSqlLegacyTiktok = adsSql.replace(
    'SUM(IFNULL(CAST(total_complete_payment_rate AS FLOAT64), 0)) AS revenue',
    'SUM(IFNULL(CAST(complete_payment_value AS FLOAT64), 0)) AS revenue'
  );

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


  // Per-day customer counts for the CAC-over-time chart: new customers
  // (first-ever order falls on that day) and total buyers (distinct customers
  // who ordered that day). Combined with daily ad spend, the frontend derives
  // New CAC (spend / new) and Blended CAC (spend / all buyers) per day.
  const customerDailySql = `
    WITH order_revenue AS (${dedupedOrdersCte(ds)}),
    firsts AS (
      SELECT order_customer_id AS cid, MIN(order_date) AS first_order
      FROM order_revenue WHERE order_customer_id IS NOT NULL GROUP BY cid
    ),
    new_by_day AS (
      SELECT first_order AS d, COUNT(*) AS new_customers
      FROM firsts WHERE first_order BETWEEN @date_from AND @date_to GROUP BY d
    ),
    buyers_by_day AS (
      SELECT order_date AS d, COUNT(DISTINCT order_customer_id) AS buyers
      FROM order_revenue
      WHERE order_date BETWEEN @date_from AND @date_to AND order_customer_id IS NOT NULL
      GROUP BY d
    ),
    days AS (SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(@date_from, @date_to)) AS d)
    SELECT FORMAT_DATE('%Y-%m-%d', days.d) AS date,
           IFNULL(new_by_day.new_customers, 0) AS new_customers,
           IFNULL(buyers_by_day.buyers, 0)     AS buyers
    FROM days
    LEFT JOIN new_by_day   ON new_by_day.d   = days.d
    LEFT JOIN buyers_by_day ON buyers_by_day.d = days.d
    ORDER BY days.d
  `;

  let adsQueryError: string | undefined;
  const [shopifyDays, adsRows, custRows, custDaily] = await Promise.all([
    fetchShopifyDaily(dateFrom, dateTo).catch(() => [] as ShopifyDay[]),
    runQuery<AdsRow>(adsSql, params)
      .catch(() => runQuery<AdsRow>(adsSqlLegacyTiktok, params))
      .catch((err: unknown) => { adsQueryError = String(err); return [] as AdsRow[]; }),
    runQuery<CustomerRow>(customerSql, params).catch(() => [] as CustomerRow[]),
    runQuery<{ date: string; new_customers: number | null; buyers: number | null }>(customerDailySql, params).catch(() => [] as Array<{ date: string; new_customers: number | null; buyers: number | null }>),
  ]);

  const custDailyByDate: Record<string, { newCustomers: number; totalCustomers: number }> = {};
  for (const r of custDaily) {
    custDailyByDate[r.date] = { newCustomers: Number(r.new_customers || 0), totalCustomers: Number(r.buyers || 0) };
  }

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

    const cd = custDailyByDate[date];
    return {
      date, revenue: Math.round(revenue), orders, adSpend: Math.round(adSpend),
      newCustomers: cd?.newCustomers ?? 0,
      totalCustomers: cd?.totalCustomers ?? 0,
    };
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
      totalAdSpend: Math.round(totalAdSpend * 100) / 100,
      aov: totalOrders > 0 ? Math.round((totalNetSales / totalOrders) * 100) / 100 : 0,
      mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
      returns: 0,
      metaSpend: Math.round(metaSpend * 100) / 100,
      googleSpend: Math.round(googleSpend * 100) / 100,
      tiktokSpend: Math.round(tiktokSpend * 100) / 100,
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
    ...(adsQueryError ? { adsError: adsQueryError } : {}),
  };
}
