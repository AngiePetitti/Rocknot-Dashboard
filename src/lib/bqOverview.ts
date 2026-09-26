import { runQuery, getDataset, dedupedOrdersCte, tableExists, dailyShopifySalesSql, shopifyOrdersFilter } from '@/src/lib/bigquery';
import { AD_CREDITS, creditAppliedInRange } from '@/src/lib/adCredits';
import { shopifyDomain, metaAccountSql, hasPlatform, includeReturnFees, storeOnlyWhere } from '@/src/lib/client';
import { fetchHumanConversion } from '@/src/lib/traffic';
import { fetchMarketplaceTotals, MarketplaceTotals } from '@/src/lib/channel';
import { runShopifyQLRaw } from '@/src/lib/shopifyql';

export interface OverviewResult {
  adsError?: string;
  metrics: {
    totalRevenue: number;
    netSales?: number;
    /** Return fees folded into netSales (only when the profile's includeReturnFees is on). */
    returnFees?: number;
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
    snapchatSpend?: number;
    snapchatRevenue?: number;
    pinterestSpend?: number;
    pinterestRevenue?: number;
    adCreditApplied?: number;
    netAdSpend?: number;
    newCustomers: number;
    returningCustomers: number;
    newCustomerRevenue: number;
    returningCustomerRevenue: number;
    pctNew: number;
    pctReturning: number;
    /** Where the new/returning split came from: Shopify's own report, or the BigQuery order history. */
    customerSource?: 'shopify' | 'bigquery';
    /** Website conversion on likely-human sessions (suspected bots removed — same rule as the Traffic tab). */
    conversionRate: number;
    /** Shopify's raw conversion rate, all sessions. */
    conversionRateRaw?: number;
    humanSessions?: number;
    botSessions?: number;
    /** Marketplace channels (e.g. Nordstrom) EXCLUDED from every figure above — shown so the exclusion is visible. */
    marketplaces?: MarketplaceTotals[];
  };
  revenueData: Array<{ date: string; revenue: number; netSales?: number; orders: number; adSpend: number; newCustomers: number; totalCustomers: number }>;
  revenueSource: 'shopify' | 'none';
  /** Where the Shopify sales figures came from: Shopify's own report (matches Shopify Analytics) or the Windsor-synced order rows (fallback). */
  shopifySource?: 'shopifyql' | 'shopifyql_totals' | 'bigquery';
  /** Why the live Shopify report was not used, when it was not. */
  shopifyLiveError?: string;
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
export interface ShopifyDay {
  date: string;
  totalSales: number;
  /** Shopify's net sales, PLUS return fees when the client profile keeps them (see returnFees). */
  netSales: number;
  /** Return fees included in netSales; 0 unless the profile's includeReturnFees is on. */
  returnFees: number;
  /**
   * Shopify's AOV basis for the day: net sales BEFORE returns (gross −
   * discounts), i.e. Shopify's average_order_value × orders. AOV = Σ aovBasis ÷ Σ orders.
   */
  aovBasis: number;
  orders: number;
}

// Trim env values: Vercel copy-paste often leaves a trailing newline, which
// corrupts the auth header (401) and the request host.
const SHOPIFY_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const SHOPIFY_DOMAIN = shopifyDomain();

export async function fetchShopifyDaily(from: string, to: string): Promise<ShopifyDay[]> {
  if (!SHOPIFY_TOKEN) return [];
  // Shopify throttles GraphQL hard, and one page load fires several ShopifyQL
  // queries (overview + prior compare + returns + customer split). Retry with
  // backoff instead of letting one THROTTLED response zero out revenue.
  // Two attempts max with a short pause — deep retry stacks made the live
  // view hang for a minute when Shopify was down.
  // Three attempts with a growing pause: this is THE number the dashboard is
  // judged on, and the fallback (Windsor order rows) is close but not Shopify.
  let withFees = includeReturnFees();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchShopifyDailyOnce(from, to, withFees);
    } catch (e) {
      lastErr = e;
      // If Shopify rejects the return_fees column (parse error), drop it rather
      // than lose revenue entirely; otherwise pause and retry.
      const parseErr = withFees && /return_fees/i.test(String(e instanceof Error ? e.message : e));
      if (parseErr) withFees = false;
      else await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchShopifyDailyOnce(from: string, to: string, withFees: boolean): Promise<ShopifyDay[]> {
  const fields = withFees
    ? 'orders, net_sales, return_fees, total_sales, average_order_value'
    : 'orders, net_sales, total_sales, average_order_value';
  const ql = `FROM sales SHOW ${fields} TIMESERIES day ${storeOnlyWhere()} SINCE ${from} UNTIL ${to}`;
  const q = { tableData: await runShopifyQLRaw(ql) };
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
  return rows.map(r => {
    const returnFees = withFees ? Math.abs(parseFloat(cell(r, 'return_fees') || '0')) || 0 : 0;
    const orders = Math.round(parseFloat(cell(r, 'orders') || '0'));
    const aov = parseFloat(cell(r, 'average_order_value') || '0') || 0;
    return {
      date: (cell(r, 'day') || '').split('T')[0],
      orders,
      // The fee the store keeps on a returned order is revenue it earned.
      netSales: (parseFloat(cell(r, 'net_sales') || '0') || 0) + returnFees,
      returnFees,
      aovBasis: aov * orders,
      totalSales: parseFloat(cell(r, 'total_sales') || '0'),
    };
  });
}

// Shopify's totals for the range in ONE row — no TIMESERIES, so it answers in
// a fraction of the time the per-day query needs. Used when the per-day query
// fails: the chart then comes from the Windsor rows, but every headline number
// (net sales incl. return fees, total sales, orders, AOV) is still Shopify's.
export async function fetchShopifyTotals(from: string, to: string): Promise<ShopifyDay | null> {
  if (!SHOPIFY_TOKEN) return null;
  let withFees = includeReturnFees();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const fields = withFees
      ? 'orders, net_sales, return_fees, total_sales, average_order_value'
      : 'orders, net_sales, total_sales, average_order_value';
    try {
      const q = { tableData: await runShopifyQLRaw(`FROM sales SHOW ${fields} ${storeOnlyWhere()} SINCE ${from} UNTIL ${to}`, { timeoutMs: 15000 }) };
      const cols: { name: string }[] = q?.tableData?.columns || [];
      const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
      if (!rows.length) return null;
      const r = rows[0];
      const cell = (name: string): string => {
        if (Array.isArray(r)) { const i = cols.findIndex(c => c.name === name); return i >= 0 ? (r[i] ?? '') : ''; }
        return r[name] ?? '';
      };
      const returnFees = withFees ? Math.abs(parseFloat(cell('return_fees') || '0')) || 0 : 0;
      const orders = Math.round(parseFloat(cell('orders') || '0'));
      const aov = parseFloat(cell('average_order_value') || '0') || 0;
      return {
        date: from,
        netSales: parseFloat(cell('net_sales') || '0') + returnFees,
        returnFees,
        aovBasis: aov * orders,
        orders,
        totalSales: parseFloat(cell('total_sales') || '0'),
      };
    } catch (e) {
      lastErr = e;
      const parseErr = withFees && /return_fees/i.test(String(e instanceof Error ? e.message : e));
      if (parseErr) withFees = false;
      else await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Website conversion rate from ShopifyQL sessions — the same number Shopify's
// own reports show: converting sessions ÷ total sessions, as a percentage.
export async function fetchShopifyConversion(from: string, to: string): Promise<number | null> {
  if (!SHOPIFY_TOKEN) return null;
  const ql = `FROM sessions SHOW sessions, sessions_that_completed_checkout SINCE ${from} UNTIL ${to}`;
  try {
    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
          tableData { rows columns { name } } parseErrors
        }}`,
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    const q = json?.data?.shopifyqlQuery;
    if (typeof q?.parseErrors === 'string' && q.parseErrors) return null;
    const cols: { name: string }[] = q?.tableData?.columns || [];
    const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
    if (!rows.length) return null;
    const cell = (r: Record<string, string> | string[], name: string): string => {
      if (Array.isArray(r)) {
        const i = cols.findIndex(c => c.name === name);
        return i >= 0 ? (r[i] ?? '') : '';
      }
      return r[name] ?? '';
    };
    const sessions = parseFloat(cell(rows[0], 'sessions') || '0');
    const converted = parseFloat(cell(rows[0], 'sessions_that_completed_checkout') || '0');
    if (sessions <= 0) return null;
    return Math.round((converted / sessions) * 1000) / 10; // one-decimal %
  } catch {
    return null;
  }
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
  const ql = `FROM sales SHOW net_sales, customers, returning_customers ${storeOnlyWhere()} SINCE ${from} UNTIL ${to}`;
  const q = { tableData: await runShopifyQLRaw(ql, { timeoutMs: 12000 }) };
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
  // Net sales (after discounts and returns) so the two segments add up to the
  // net figure on the MER card rather than exceeding total sales.
  const totalRevenue = parseFloat(cell(r, 'net_sales') || '0');
  if (totalCustomers === 0) return null;
  // Revenue split is proportional to customer count — best available from ShopifyQL.
  const newRevenue = totalCustomers > 0 ? (newCustomers / totalCustomers) * totalRevenue : 0;
  const returningRevenue = totalCustomers > 0 ? (returningCustomers / totalCustomers) * totalRevenue : 0;
  return { newCustomers, returningCustomers, newRevenue, returningRevenue };
}

export async function getOverview(dateFrom: string, dateTo: string): Promise<OverviewResult> {
  const ds = getDataset();
  const rowFilter = await shopifyOrdersFilter();
  const params = { date_from: dateFrom, date_to: dateTo };

  // A platform the client runs may not have synced its first table yet (a new
  // client's Google Ads before access is granted, say). Referencing a missing
  // table fails the WHOLE ads query and blanks every platform, so each CTE is
  // stubbed empty until its table exists. Positives are cached for the
  // instance; a newly created table is picked up on the next request.
  const EMPTY_CTE = 'SELECT CAST(NULL AS DATE) AS d, 0.0 AS spend, 0.0 AS revenue';
  const [hasMeta, hasGoogle, hasTiktok] = await Promise.all([
    tableExists('facebook_ads'),
    hasPlatform('google') ? tableExists('google_ads') : Promise.resolve(false),
    hasPlatform('tiktok') ? tableExists('tiktok_ads') : Promise.resolve(false),
  ]);

  const adsSql = `
    WITH meta AS (${hasMeta ? `
      -- Windsor stores one row per ADSET (only the campaign name is exposed, so
      -- a campaign's adsets share a campaign value and appear as multiple rows
      -- with independent spend/clicks/purchases). They must be SUMMED to get the
      -- true campaign total — do not dedup.
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.facebook_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to${metaAccountSql()}
      GROUP BY d` : EMPTY_CTE}
    ),
    google AS (${hasGoogle ? `
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.google_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d` : EMPTY_CTE}
    ),
    tiktok AS (${hasTiktok ? `
      SELECT DATE(date) AS d,
             SUM(CAST(spend AS FLOAT64)) AS spend,
             SUM(IFNULL(CAST(total_complete_payment_rate AS FLOAT64), 0)) AS revenue
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d` : EMPTY_CTE}
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
    WITH order_revenue AS (${dedupedOrdersCte(ds, rowFilter)}),
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
    WITH order_revenue AS (${dedupedOrdersCte(ds, rowFilter)}),
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

  // Snapchat runs as its own guarded query so a missing snapchat_ads table
  // can never break the main ads query.
  const snapSql = `
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS date,
           SUM(CAST(spend AS FLOAT64)) AS spend,
           SUM(IFNULL(CAST(conversion_purchases_value AS FLOAT64), 0)) AS revenue
    FROM \`${ds}.snapchat_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
    GROUP BY date
  `;

  // Pinterest, same guarded pattern. Windsor's Pinterest revenue column name
  // varies by connector version — try each, then spend-only.
  const pinterestSqlFor = (revenueExpr: string) => `
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS date,
           SUM(CAST(spend AS FLOAT64)) AS spend,
           ${revenueExpr} AS revenue
    FROM \`${ds}.pinterest_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
    GROUP BY date
  `;
  const pinterestSqls = [
    pinterestSqlFor('SUM(IFNULL(CAST(total_checkout_value AS FLOAT64), 0))'),
    pinterestSqlFor('SUM(IFNULL(CAST(total_conversions_value AS FLOAT64), 0))'),
    pinterestSqlFor('0'),
  ];

  // Kick the platform-API patch fetches off NOW so they run concurrently with
  // the BigQuery/Shopify queries below instead of adding their latency on top.
  const todayPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const patchWindowStart = new Date(new Date(todayPst).getTime() - 35 * 86400000).toISOString().slice(0, 10);
  const patchFrom = dateFrom > patchWindowStart ? dateFrom : patchWindowStart;
  const patchPromise = dateTo >= patchFrom
    ? (async () => {
        const { fetchMetaDaily } = await import('@/src/lib/metaLive');
        const { fetchSnapDaily } = await import('@/src/lib/snapLive');
        const { fetchTiktokDaily, fetchSnapDailyFromWindsor, fetchGoogleDailyFromWindsor, fetchPinterestDailyFromWindsor } = await import('@/src/lib/tiktokLive');
        const none = Promise.resolve(null);
        return Promise.all([
          fetchMetaDaily(patchFrom, dateTo).catch(() => null),
          hasPlatform('snapchat') ? fetchSnapDaily(patchFrom, dateTo).then(r => r ?? fetchSnapDailyFromWindsor(patchFrom, dateTo)).catch(() => null) : none,
          hasPlatform('tiktok') ? fetchTiktokDaily(patchFrom, dateTo).catch(() => null) : none,
          fetchGoogleDailyFromWindsor(patchFrom, dateTo).catch(() => null),
          hasPlatform('pinterest') ? fetchPinterestDailyFromWindsor(patchFrom, dateTo).catch(() => null) : none,
        ]);
      })()
    : null;

  // Daily revenue from BigQuery's synced Shopify orders — the resilient
  // fallback when ShopifyQL is throttled/down (which zeroed whole timeframes).
  // ShopifyQL stays preferred because it matches Shopify's Analytics reports
  // to the cent; the BQ order sums run a hair different and lag Windsor's
  // last sync for the most recent hours.
  // Shopify-style daily sales (money attributed to the day it moved; refunds
  // negative on the day processed) — matches Shopify Analytics for the range.
  const bqShopifySql = dailyShopifySalesSql(ds, rowFilter);

  let adsQueryError: string | undefined;
  type PlatformDayRow = { date: string; spend: number | null; revenue: number | null };
  const noPlatformRows = Promise.resolve([] as PlatformDayRow[]);
  let shopifyQlError: string | undefined;
  // The per-day Shopify report is THE number this page is judged on — run it
  // alone first so the secondary Shopify queries below never compete with it
  // for Shopify's ShopifyQL rate limit.
  const shopifyDaysQl = await fetchShopifyDaily(dateFrom, dateTo).catch((e: unknown) => { shopifyQlError = String(e instanceof Error ? e.message : e); return null; });
  const [shopifyDaysBq, adsRows, custRows, custDaily, conversionRate, snapRows, pinterestRows, shopifySplit, marketplaceTotals] = await Promise.all([
    runQuery<{ date: string; orders: number; total_sales: number | null; net_sales: number | null; net_sales_placed: number | null }>(bqShopifySql, params)
      .then(rows => rows.map(r => ({
        date: r.date,
        orders: Number(r.orders || 0),
        totalSales: Number(r.total_sales || 0),
        netSales: Number(r.net_sales || 0),
        returnFees: 0, // Windsor's order rows carry no return-fee data
        aovBasis: Number(r.net_sales_placed || 0),
      })))
      .catch(() => null),
    runQuery<AdsRow>(adsSql, params)
      .catch(() => runQuery<AdsRow>(adsSqlLegacyTiktok, params))
      .catch((err: unknown) => { adsQueryError = String(err); return [] as AdsRow[]; }),
    runQuery<CustomerRow>(customerSql, params).catch(() => [] as CustomerRow[]),
    runQuery<{ date: string; new_customers: number | null; buyers: number | null }>(customerDailySql, params).catch(() => [] as Array<{ date: string; new_customers: number | null; buyers: number | null }>),
    fetchHumanConversion(dateFrom, dateTo).catch(() => null),
    hasPlatform('snapchat')
      ? runQuery<PlatformDayRow>(snapSql, params).catch(() => [] as PlatformDayRow[])
      : noPlatformRows,
    hasPlatform('pinterest')
      ? runQuery<PlatformDayRow>(pinterestSqls[0], params)
          .catch(() => runQuery<PlatformDayRow>(pinterestSqls[1], params))
          .catch(() => runQuery<PlatformDayRow>(pinterestSqls[2], params))
          .catch(() => [] as PlatformDayRow[])
      : noPlatformRows,
    // Shopify's own new/returning customer counts — complete history, guest and
    // app-created orders included. BigQuery's split (history only as far back
    // as the Windsor sync, orders without a customer id excluded) is the fallback.
    fetchShopifyCustomerSplit(dateFrom, dateTo).catch(() => null),
    fetchMarketplaceTotals(dateFrom, dateTo).catch(() => [] as MarketplaceTotals[]),
  ]);

  const shopifyDays: ShopifyDay[] =
    (shopifyDaysQl && shopifyDaysQl.length > 0 ? shopifyDaysQl : null)
    ?? (shopifyDaysBq && shopifyDaysBq.length > 0 ? shopifyDaysBq : null)
    ?? [];
  // Per-day Shopify query failed → still get Shopify's TOTALS (incl. return
  // fees) in one cheap call; the Windsor rows only shape the daily chart.
  let shopifyTotals: ShopifyDay | null = null;
  if (!(shopifyDaysQl && shopifyDaysQl.length > 0)) {
    try { shopifyTotals = await fetchShopifyTotals(dateFrom, dateTo); }
    catch (e: unknown) { shopifyQlError = `${shopifyQlError ? shopifyQlError + ' / ' : ''}totals: ${e instanceof Error ? e.message : String(e)}`; }
  }

  const snapByDate: Record<string, { spend: number; revenue: number }> = {};
  for (const r of snapRows) snapByDate[r.date] = { spend: Number(r.spend || 0), revenue: Number(r.revenue || 0) };
  const pinterestByDate: Record<string, { spend: number; revenue: number }> = {};
  for (const r of pinterestRows) pinterestByDate[r.date] = { spend: Number(r.spend || 0), revenue: Number(r.revenue || 0) };

  // Windsor's daily sync captures a day PART-WAY through (task runs once a
  // day), so recent days in BigQuery understate spend until the next sync.
  // Apply the ~35-day patch (kicked off above) from each platform's freshest
  // source — the same numbers their Ads Managers show.
  if (patchPromise) {
    const [metaPatch, snapPatch, tiktokPatch, googlePatch, pinterestPatch] = await patchPromise;
    const adsByDatePatch: Record<string, AdsRow> = {};
    for (const a of adsRows) adsByDatePatch[a.date] = a;
    if (metaPatch) {
      for (const day of metaPatch) {
        const row = adsByDatePatch[day.date];
        if (row && day.spend >= Number(row.meta_spend || 0)) {
          row.meta_spend = day.spend;
          if (day.revenue > 0) row.meta_revenue = day.revenue;
        }
      }
    }
    if (tiktokPatch) {
      for (const day of tiktokPatch) {
        const row = adsByDatePatch[day.date];
        if (row && day.spend >= Number(row.tiktok_spend || 0)) {
          row.tiktok_spend = day.spend;
          if (day.revenue > 0) row.tiktok_revenue = day.revenue;
        }
      }
    }
    // Google's BQ sync trails Windsor's own REST endpoint (the reconcile
    // reference), leaving a standing "-10%" banner — patch recent days from
    // REST so the two agree.
    if (googlePatch) {
      for (const day of googlePatch) {
        const row = adsByDatePatch[day.date];
        if (row && day.spend >= Number(row.google_spend || 0)) {
          row.google_spend = day.spend;
          if (day.revenue > 0) row.google_revenue = day.revenue;
        }
      }
    }
    if (snapPatch) {
      for (const day of snapPatch) {
        const existing = snapByDate[day.date];
        if (!existing || day.spend >= existing.spend) {
          snapByDate[day.date] = { spend: day.spend, revenue: day.revenue || existing?.revenue || 0 };
        }
      }
    }
    if (pinterestPatch) {
      for (const day of pinterestPatch) {
        const existing = pinterestByDate[day.date];
        if (!existing || day.spend >= existing.spend) {
          pinterestByDate[day.date] = { spend: day.spend, revenue: day.revenue || existing?.revenue || 0 };
        }
      }
    }
  }

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

  let totalRevenue = 0, totalNetSales = 0, totalReturnFees = 0, totalAovBasis = 0, totalOrders = 0;
  let metaSpend = 0, googleSpend = 0, tiktokSpend = 0, snapchatSpend = 0, pinterestSpend = 0;
  let metaRevenue = 0, googleRevenue = 0, tiktokRevenue = 0, snapchatRevenue = 0, pinterestRevenue = 0;

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
    const snap = snapByDate[date];
    const pin = pinterestByDate[date];
    const adSpend = Number(a?.meta_spend || 0) + Number(a?.google_spend || 0) + Number(a?.tiktok_spend || 0) + (snap?.spend || 0) + (pin?.spend || 0);

    totalRevenue += revenue;
    totalNetSales += s ? s.netSales : 0;
    totalReturnFees += s ? s.returnFees : 0;
    totalAovBasis += s ? s.aovBasis : 0;
    totalOrders += orders;
    metaSpend += Number(a?.meta_spend || 0);
    googleSpend += Number(a?.google_spend || 0);
    tiktokSpend += Number(a?.tiktok_spend || 0);
    metaRevenue += Number(a?.meta_revenue || 0);
    googleRevenue += Number(a?.google_revenue || 0);
    tiktokRevenue += Number(a?.tiktok_revenue || 0);
    snapchatSpend += snap?.spend || 0;
    snapchatRevenue += snap?.revenue || 0;
    pinterestSpend += pin?.spend || 0;
    pinterestRevenue += pin?.revenue || 0;

    const cd = custDailyByDate[date];
    return {
      date, revenue: Math.round(revenue), netSales: Math.round(s ? s.netSales : 0), orders, adSpend: Math.round(adSpend),
      newCustomers: cd?.newCustomers ?? 0,
      totalCustomers: cd?.totalCustomers ?? 0,
    };
  });

  const totalAdSpend = metaSpend + googleSpend + tiktokSpend + snapchatSpend + pinterestSpend;

  // Platform ad credits (e.g. Snap's $7.5K): promo spend isn't real cash out,
  // so MER divides by NET spend. Spend before this range (since the credit
  // started) already consumed part of the credit — summed from BigQuery.
  let adCreditApplied = 0;
  for (const credit of AD_CREDITS) {
    if (credit.platform !== 'snapchat' || dateTo < credit.from) continue;
    let spendBefore = 0;
    if (dateFrom > credit.from) {
      try {
        const prior = await runQuery<{ spend: number | null }>(
          `SELECT SUM(CAST(spend AS FLOAT64)) AS spend FROM \`${ds}.snapchat_ads\`
           WHERE DATE(date) >= @credit_from AND DATE(date) < @date_from`,
          { credit_from: credit.from, date_from: dateFrom }
        );
        spendBefore = Number(prior?.[0]?.spend || 0);
      } catch { /* table missing — assume nothing consumed yet */ }
    }
    // Only spend on/after the credit start counts against it.
    const snapInCreditWindow = dateFrom >= credit.from
      ? snapchatSpend
      : Object.entries(snapByDate).filter(([d]) => d >= credit.from).reduce((s, [, v]) => s + v.spend, 0);
    adCreditApplied += creditAppliedInRange(credit, spendBefore, snapInCreditWindow, dateTo);
  }
  const netAdSpend = Math.max(0, totalAdSpend - adCreditApplied);

  const useShopifySplit = Boolean(shopifySplit && shopifySplit.newCustomers + shopifySplit.returningCustomers > 0);
  const newCustomers = useShopifySplit ? shopifySplit!.newCustomers : Number(cust.new_customers || 0);
  const returningCustomers = useShopifySplit ? shopifySplit!.returningCustomers : Number(cust.returning_customers || 0);
  const newCustomerRevenue = useShopifySplit ? shopifySplit!.newRevenue : Number(cust.new_customer_revenue || 0);
  const returningCustomerRevenue = useShopifySplit ? shopifySplit!.returningRevenue : Number(cust.returning_customer_revenue || 0);
  const totalCust = newCustomers + returningCustomers;

  if (shopifyTotals) {
    totalRevenue = shopifyTotals.totalSales;
    totalNetSales = shopifyTotals.netSales;
    totalReturnFees = shopifyTotals.returnFees;
    totalAovBasis = shopifyTotals.aovBasis;
    totalOrders = shopifyTotals.orders;
  }

  return {
    metrics: {
      totalRevenue: Math.round(totalRevenue),
      totalOrders,
      totalAdSpend: Math.round(totalAdSpend * 100) / 100,
      netSales: Math.round(totalNetSales),
      returnFees: Math.round(totalReturnFees),
      // AOV on Shopify's own basis (net before returns ÷ orders) so it matches
      // Shopify's reported average order value; falls back to net ÷ orders.
      aov: totalOrders > 0
        ? Math.round(((totalAovBasis > 0 ? totalAovBasis : totalNetSales - totalReturnFees) / totalOrders) * 100) / 100
        : 0,
      // True MER: NET sales (after discounts/returns, excl. taxes+shipping)
      // over net ad spend — total sales flattered the ratio by ~6%.
      mer: netAdSpend > 0 ? Math.round((totalNetSales / netAdSpend) * 100) / 100 : 0,
      adCreditApplied: Math.round(adCreditApplied * 100) / 100,
      netAdSpend: Math.round(netAdSpend * 100) / 100,
      returns: 0,
      metaSpend: Math.round(metaSpend * 100) / 100,
      googleSpend: Math.round(googleSpend * 100) / 100,
      tiktokSpend: Math.round(tiktokSpend * 100) / 100,
      metaRevenue: Math.round(metaRevenue),
      googleRevenue: Math.round(googleRevenue),
      tiktokRevenue: Math.round(tiktokRevenue),
      snapchatSpend: Math.round(snapchatSpend * 100) / 100,
      snapchatRevenue: Math.round(snapchatRevenue),
      pinterestSpend: Math.round(pinterestSpend * 100) / 100,
      pinterestRevenue: Math.round(pinterestRevenue),
      newCustomers,
      returningCustomers,
      newCustomerRevenue: Math.round(newCustomerRevenue),
      returningCustomerRevenue: Math.round(returningCustomerRevenue),
      pctNew: totalCust > 0 ? Math.round((newCustomers / totalCust) * 1000) / 10 : 0,
      pctReturning: totalCust > 0 ? Math.round((returningCustomers / totalCust) * 1000) / 10 : 0,
      customerSource: useShopifySplit ? 'shopify' : 'bigquery',
      conversionRate: conversionRate?.rate ?? 0,
      conversionRateRaw: conversionRate?.rawRate,
      humanSessions: conversionRate?.humanSessions,
      botSessions: conversionRate?.botSessions,
      ...(marketplaceTotals.length ? { marketplaces: marketplaceTotals } : {}),
    },
    revenueData,
    revenueSource: totalRevenue > 0 ? 'shopify' : 'none',
    shopifySource: shopifyDaysQl && shopifyDaysQl.length > 0 ? 'shopifyql' : shopifyTotals ? 'shopifyql_totals' : 'bigquery',
    ...(shopifyQlError ? { shopifyLiveError: shopifyQlError } : {}),
    ...(adsQueryError ? { adsError: adsQueryError } : {}),
  };
}
