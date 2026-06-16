import { NextRequest, NextResponse } from 'next/server';
import { Timeframe } from '@/src/lib/mockData';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getOverview } from '@/src/lib/bqOverview';
import { fetchMetaToday } from '@/src/lib/metaLive';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

function buildCurrentParams(tf: Timeframe, todayStr: string, yesterdayStr: string): Record<string, string> {
  if (tf === 'today') return { date_from: todayStr, date_to: todayStr };
  if (tf === 'yesterday') return { date_from: yesterdayStr, date_to: yesterdayStr };
  if (tf === '7d') return { date_from: addDays(todayStr, -7), date_to: yesterdayStr };
  if (tf === '14d') return { date_from: addDays(todayStr, -14), date_to: yesterdayStr };
  if (tf === '30d') return { date_from: addDays(todayStr, -30), date_to: yesterdayStr };
  if (tf === '6m') return { date_from: addDays(todayStr, -180), date_to: yesterdayStr };
  if (tf === 'ytd') {
    const year = todayStr.split('-')[0];
    return { date_from: `${year}-01-01`, date_to: yesterdayStr };
  }
  if (tf === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    return {
      date_from: new Date(y, m - 2, 1).toLocaleDateString('en-CA'),
      date_to: new Date(y, m - 1, 0).toLocaleDateString('en-CA'),
    };
  }
  return { date_from: addDays(todayStr, -30), date_to: yesterdayStr };
}

function buildPriorParams(tf: Timeframe, todayStr: string, yesterdayStr: string): { params: Record<string, string>; label: string } {
  if (tf === 'today') {
    return { params: { date_from: yesterdayStr, date_to: yesterdayStr }, label: yesterdayStr };
  }
  if (tf === 'yesterday') {
    const d = addDays(yesterdayStr, -1);
    return { params: { date_from: d, date_to: d }, label: d };
  }
  if (tf === '7d') {
    const from = addDays(todayStr, -14); const to = addDays(todayStr, -8);
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  if (tf === '14d') {
    const from = addDays(todayStr, -28); const to = addDays(todayStr, -15);
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  if (tf === '30d') {
    const from = addDays(todayStr, -60); const to = addDays(todayStr, -31);
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  if (tf === '6m') {
    const from = addDays(todayStr, -360); const to = addDays(todayStr, -181);
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  if (tf === 'ytd') {
    // Same-period-last-year, not the full prior year — YTD through June must
    // compare against last year through the same June date.
    const [y, m, d] = yesterdayStr.split('-');
    const from = `${Number(y) - 1}-01-01`;
    const to = `${Number(y) - 1}-${m}-${m === '02' && d === '29' ? '28' : d}`;
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  if (tf === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    const from = new Date(y, m - 3, 1).toLocaleDateString('en-CA');
    const to = new Date(y, m - 2, 0).toLocaleDateString('en-CA');
    return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
  }
  const from = addDays(todayStr, -60); const to = addDays(todayStr, -31);
  return { params: { date_from: from, date_to: to }, label: `${from} – ${to}` };
}

interface WindsorRow {
  date?: string;
  source?: string;
  spend?: number | string;
  revenue?: number | string;
  conversion_value?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  conversions?: number | string;
  order_count?: number | string;
  order_current_total_price?: number | string;
  order_subtotal_price?: number | string;
  order_total_price?: number | string;
  order_gross_sales?: number | string;
  order_net_sales?: number | string;
  [key: string]: string | number | boolean | undefined;
}

interface AggregatedMetrics {
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
}

interface DayBucket {
  date: string;
  shopifyRevenue: number;
  metaRevenue: number;
  googleRevenue: number;
  tiktokRevenue: number;
  orders: number;
  adSpend: number;
  metaSpend: number;
  googleSpend: number;
  tiktokSpend: number;
  newCustomers: number;
  returningCustomers: number;
}

function emptyBucket(date: string): DayBucket {
  return { date, shopifyRevenue: 0, metaRevenue: 0, googleRevenue: 0, tiktokRevenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
}

function aggregateRows(rows: WindsorRow[]) {
  const byDate: Record<string, DayBucket> = {};

  for (const row of rows) {
    const date = String(row.date || '').split('T')[0];
    if (!date) continue;
    if (!byDate[date]) byDate[date] = emptyBucket(date);

    const spend = Number(row.spend || 0);
    const src = String(row.source || '').toLowerCase();
    const isShopify = src.includes('shopify');

    if (isShopify) {
      const rev = Number(row.order_total_price || row.order_current_total_price || row.order_subtotal_price || row.order_gross_sales || row.order_net_sales || row.revenue || 0);
      byDate[date].shopifyRevenue += rev;
      byDate[date].orders += Math.round(Number(row.order_count || 0));
    } else {
      byDate[date].adSpend += spend;

      if (src.includes('facebook') || src.includes('meta')) {
        const roasArr = Array.isArray((row as Record<string, unknown>).purchase_roas)
          ? (row as Record<string, unknown>).purchase_roas as Array<{ value?: string }>
          : null;
        const roasVal = roasArr ? Number(roasArr[0]?.value || 0) : 0;
        byDate[date].metaRevenue += roasVal > 0 ? roasVal * spend : 0;
        byDate[date].metaSpend += spend;
      } else if (src.includes('google')) {
        byDate[date].googleRevenue += Number(row.conversion_value || row.revenue || 0);
        byDate[date].googleSpend += spend;
      } else if (src.includes('tiktok')) {
        byDate[date].tiktokRevenue += Number((row as Record<string, unknown>).onsite_total_purchase_value || row.conversion_value || row.revenue || 0);
        byDate[date].tiktokSpend += spend;
      }
    }
  }

  const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const shopifyRevenueTotal = dailyData.reduce((s, d) => s + d.shopifyRevenue, 0);
  const hasShopifyRevenue = shopifyRevenueTotal > 0;

  // Total revenue is Shopify-only — no fallback to ad attribution.
  // Per-platform attributed revenue is reported separately for the platform table.
  const totalRevenue = shopifyRevenueTotal;

  const totalAdSpend    = dailyData.reduce((s, d) => s + d.adSpend, 0);
  const totalOrders     = Math.round(dailyData.reduce((s, d) => s + d.orders, 0));
  const totalMetaSpend  = dailyData.reduce((s, d) => s + d.metaSpend, 0);
  const totalGoogleSpend = dailyData.reduce((s, d) => s + d.googleSpend, 0);
  const totalTikTokSpend = dailyData.reduce((s, d) => s + d.tiktokSpend, 0);
  const totalMetaRevenue = dailyData.reduce((s, d) => s + d.metaRevenue, 0);
  const totalGoogleRevenue = dailyData.reduce((s, d) => s + d.googleRevenue, 0);
  const totalTikTokRevenue = dailyData.reduce((s, d) => s + d.tiktokRevenue, 0);
  const totalNewCust    = dailyData.reduce((s, d) => s + d.newCustomers, 0);
  const totalRetCust    = dailyData.reduce((s, d) => s + d.returningCustomers, 0);

  const metrics: AggregatedMetrics = {
    totalRevenue: Math.round(totalRevenue),
    totalOrders,
    totalAdSpend: Math.round(totalAdSpend),
    aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
    mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
    returns: 0,
    metaSpend: Math.round(totalMetaSpend),
    googleSpend: Math.round(totalGoogleSpend),
    tiktokSpend: Math.round(totalTikTokSpend),
    metaRevenue: Math.round(totalMetaRevenue),
    googleRevenue: Math.round(totalGoogleRevenue),
    tiktokRevenue: Math.round(totalTikTokRevenue),
    newCustomers: totalNewCust,
    returningCustomers: totalRetCust,
    pctNew: totalOrders > 0 ? Math.round((totalNewCust / totalOrders) * 1000) / 10 : 0,
    pctReturning: totalOrders > 0 ? Math.round((totalRetCust / totalOrders) * 1000) / 10 : 0,
  };

  const revenueData = dailyData.map(d => ({
    date: d.date,
    revenue: Math.round(d.shopifyRevenue),
    orders: Math.round(d.orders),
    adSpend: Math.round(d.adSpend),
  }));

  return { metrics, revenueData, revenueSource: hasShopifyRevenue ? 'shopify' : 'none' };
}

// Ad platform fields
const META_FIELDS = ['date', 'source', 'spend', 'impressions', 'clicks', 'ctr', 'purchase_roas', 'conversions'].join(',');
const GOOGLE_FIELDS = ['date', 'source', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value'].join(',');
// Shopify fields via Windsor /all endpoint — order-level fields only.
// Do not mix with Customer-endpoint fields (e.g. customer_is_returning) —
// per Windsor support, mixing reports in one query nulls out order fields.
const SHOPIFY_FIELDS = ['date', 'source', 'order_count', 'order_current_total_price', 'order_subtotal_price', 'order_total_price', 'order_gross_sales', 'order_net_sales'].join(',');

// Separate queries per Windsor support: orders (with customer id) and the
// Customers report (customer_is_returning) must not share a query — they are
// joined here on order_customer_id = customer_id.
const SHOPIFY_ORDER_CUSTOMER_FIELDS = ['date', 'source', 'order_id', 'order_customer_id'].join(',');
const SHOPIFY_CUSTOMER_FIELDS = ['source', 'customer_id', 'customer_is_returning'].join(',');

interface CustomerSplit {
  byDate: Record<string, { newCustomers: number; returningCustomers: number }>;
}

async function fetchCustomerSplit(params: Record<string, string>): Promise<CustomerSplit> {
  const empty: CustomerSplit = { byDate: {} };
  try {
    const [orders, customers] = await Promise.all([
      fetchFromWindsor('all', SHOPIFY_ORDER_CUSTOMER_FIELDS, params),
      fetchFromWindsor('all', SHOPIFY_CUSTOMER_FIELDS, params),
    ]);

    const isReturningById: Record<string, boolean> = {};
    for (const row of customers.rows) {
      if (!String(row.source || '').toLowerCase().includes('shopify')) continue;
      const id = String((row as Record<string, unknown>).customer_id || '');
      if (!id) continue;
      const v = (row as Record<string, unknown>).customer_is_returning;
      isReturningById[id] = v === true || v === 'true' || v === 1 || v === '1';
    }

    const byDate: CustomerSplit['byDate'] = {};
    const seenOrders = new Set<string>();
    for (const row of orders.rows) {
      if (!String(row.source || '').toLowerCase().includes('shopify')) continue;
      const date = String(row.date || '').split('T')[0];
      const custId = String((row as Record<string, unknown>).order_customer_id || '');
      const orderId = String((row as Record<string, unknown>).order_id || '');
      if (!date || !custId) continue;
      if (orderId && seenOrders.has(orderId)) continue;
      if (orderId) seenOrders.add(orderId);
      if (!byDate[date]) byDate[date] = { newCustomers: 0, returningCustomers: 0 };
      if (isReturningById[custId]) byDate[date].returningCustomers += 1;
      else byDate[date].newCustomers += 1;
    }
    return { byDate };
  } catch {
    return empty;
  }
}

async function fetchFromWindsor(endpoint: string, fields: string, params: Record<string, string>): Promise<{ rows: WindsorRow[]; error?: string; rowCount: number }> {
  try {
    const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
    const url = `https://connectors.windsor.ai/${endpoint}?${qs}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { rows: [], error: `http_${res.status}`, rowCount: 0 };
    const json = await res.json();
    if (json.error) return { rows: [], error: json.error, rowCount: 0 };
    const data = (json.data || []) as WindsorRow[];
    return { rows: data, rowCount: data.length };
  } catch (e) {
    return { rows: [], error: String(e), rowCount: 0 };
  }
}

async function fetchAllRows(params: Record<string, string>): Promise<WindsorRow[]> {
  const [meta, google, shopify] = await Promise.all([
    fetchFromWindsor('facebook', META_FIELDS, params),
    fetchFromWindsor('google_ads', GOOGLE_FIELDS, params),
    // Windsor /all filtered to shopify source — /shopify endpoint returns null order fields
    fetchFromWindsor('all', SHOPIFY_FIELDS, params),
  ]);

  const shopifyRows = shopify.rows.filter(r =>
    String(r.source || '').toLowerCase().includes('shopify')
  );

  return [
    ...meta.rows.map(r => ({ ...r, source: 'facebook' })),
    ...google.rows.map(r => ({ ...r, source: 'google' })),
    ...shopifyRows,
  ];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const tf = (tfRaw === 'custom' ? '30d' : tfRaw) as Timeframe;
  const isCustom = tfRaw === 'custom';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const withCompare = searchParams.get('compare') === 'true';
  const debug = searchParams.get('debug') === 'true';

  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ source: 'error', error: 'Windsor API key not configured', timeframe: tf, metrics: null, revenueData: [] });
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayStr = addDays(todayStr, -1);

  try {
    let currentParams: Record<string, string>;
    if (isCustom && dateFrom && dateTo) {
      currentParams = { date_from: dateFrom, date_to: dateTo };
    } else {
      currentParams = buildCurrentParams(tf, todayStr, yesterdayStr);
    }

    // BigQuery path: Windsor syncs data into per-client BigQuery tables and
    // the dashboard queries those — no Windsor REST quirks (row limits,
    // report-mixing restrictions, preset mismatches).
    // "Today" is the exception: BigQuery only updates when Windsor's scheduled
    // sync runs, so the live view goes straight to the Windsor API instead.
    const includesToday = tfRaw === 'today' || (isCustom && dateTo >= todayStr);
    if (isBigQueryConfigured() && !debug && !includesToday) {
      const overview = await getOverview(currentParams.date_from, currentParams.date_to);

      let bqPrior = null;
      let bqPriorLabel = '';
      if (withCompare) {
        if (isCustom && dateFrom && dateTo) {
          const days = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
          const priorTo = addDays(dateFrom, -1);
          const priorFrom = addDays(dateFrom, -days);
          const p = await getOverview(priorFrom, priorTo);
          bqPrior = p.metrics;
          bqPriorLabel = `${priorFrom} – ${priorTo}`;
        } else {
          const prior = buildPriorParams(tf, todayStr, yesterdayStr);
          const p = await getOverview(prior.params.date_from, prior.params.date_to);
          bqPrior = p.metrics;
          bqPriorLabel = prior.label;
        }
      }

      return NextResponse.json({
        source: 'bigquery_live',
        timeframe: tf,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        revenueSource: overview.revenueSource,
        metrics: overview.metrics,
        revenueData: overview.revenueData,
        ...(bqPrior ? { priorPeriod: bqPrior, priorLabel: bqPriorLabel } : {}),
      }, { headers: cacheHeaders(false) });
    }

    if (debug) {
      // Try a wide variety of potential revenue/price field names to find which ones Windsor populates
      const DISCOVERY_FIELDS = [
        'date', 'source',
        'order_count', 'order_current_total_price', 'order_subtotal_price',
        'order_total_price', 'order_gross_sales', 'order_net_sales',
        'order_customer_id', 'order_id',
      ].join(',');

      const [meta, google, shopifyAll] = await Promise.all([
        fetchFromWindsor('facebook', META_FIELDS, currentParams),
        fetchFromWindsor('google_ads', GOOGLE_FIELDS, currentParams),
        fetchFromWindsor('all', DISCOVERY_FIELDS, currentParams),
      ]);
      const shopifyRows = shopifyAll.rows.filter(r => String(r.source || '').toLowerCase().includes('shopify'));

      // Find which fields have non-null values in the Shopify rows
      const nonNullFields: Record<string, number> = {};
      for (const row of shopifyRows.slice(0, 100)) {
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined && v !== '' && v !== false && k !== 'source' && k !== 'date') {
            nonNullFields[k] = (nonNullFields[k] || 0) + 1;
          }
        }
      }

      return NextResponse.json({
        debug: true,
        params: currentParams,
        meta: { rowCount: meta.rowCount, error: meta.error, sample: meta.rows.slice(0, 2) },
        google: { rowCount: google.rowCount, error: google.error, sample: google.rows.slice(0, 2) },
        shopify: {
          allRowCount: shopifyAll.rowCount,
          shopifySourceRows: shopifyRows.length,
          error: shopifyAll.error,
          nonNullFields,
          sample: shopifyRows.slice(0, 3),
        },
      });
    }

    const isShortTf = tf === 'today' || tf === 'yesterday';
    const [initialRows, customerSplit] = await Promise.all([
      fetchAllRows(currentParams),
      fetchCustomerSplit(currentParams),
    ]);
    let currentRows = initialRows;

    // Fallback for today/yesterday with no data: use most recent available
    let latestAvailableDate: string | null = null;
    if (currentRows.filter(r => !String(r.source || '').includes('shopify')).length === 0 && isShortTf) {
      const recentRows = await fetchAllRows({ date_preset: 'last_7dT' });
      if (recentRows.length > 0) {
        const dates = recentRows.map(r => String(r.date || '').split('T')[0]).filter(Boolean).sort();
        latestAvailableDate = dates[dates.length - 1];
        currentRows = recentRows.filter(r => String(r.date || '').split('T')[0] === latestAvailableDate);
      }
    }

    const current = aggregateRows(currentRows);

    // For "today", replace Meta numbers with the Graph API's live figures —
    // Windsor refreshes from Meta on a delay, so its intraday spend runs low.
    if (tfRaw === 'today' && !latestAvailableDate) {
      const metaLive = await fetchMetaToday();
      if (metaLive && metaLive.spend >= current.metrics.metaSpend) {
        const spendDelta = metaLive.spend - current.metrics.metaSpend;
        current.metrics.metaSpend = Math.round(metaLive.spend * 100) / 100;
        current.metrics.metaRevenue = Math.round(metaLive.revenue * 100) / 100;
        current.metrics.totalAdSpend = Math.round((current.metrics.totalAdSpend + spendDelta) * 100) / 100;
        current.metrics.mer = current.metrics.totalAdSpend > 0
          ? Math.round((current.metrics.totalRevenue / current.metrics.totalAdSpend) * 100) / 100
          : 0;
        if (current.revenueData.length === 1) {
          current.revenueData[0].adSpend = Math.round(current.metrics.totalAdSpend);
        }
      }
    }

    // Overlay new vs returning customer counts from the joined
    // Orders + Customers queries
    const splitDays = Object.values(customerSplit.byDate);
    if (splitDays.length > 0) {
      const newCust = splitDays.reduce((s, d) => s + d.newCustomers, 0);
      const retCust = splitDays.reduce((s, d) => s + d.returningCustomers, 0);
      const splitTotal = newCust + retCust;
      current.metrics.newCustomers = newCust;
      current.metrics.returningCustomers = retCust;
      current.metrics.pctNew = splitTotal > 0 ? Math.round((newCust / splitTotal) * 1000) / 10 : 0;
      current.metrics.pctReturning = splitTotal > 0 ? Math.round((retCust / splitTotal) * 1000) / 10 : 0;
    }

    let priorPeriod = null;
    let priorLabel = '';

    if (withCompare) {
      let priorParams: Record<string, string>;
      if (isCustom && dateFrom && dateTo) {
        const days = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
        const priorTo = addDays(dateFrom, -1);
        const priorFrom = addDays(dateFrom, -days);
        priorParams = { date_from: priorFrom, date_to: priorTo };
        priorLabel = `${priorFrom} – ${priorTo}`;
      } else {
        const prior = buildPriorParams(tf, todayStr, yesterdayStr);
        priorParams = prior.params;
        priorLabel = prior.label;
      }

      const priorRows = await fetchAllRows(priorParams);
      const priorAgg = aggregateRows(priorRows);

      if (!isCustom) {
        priorPeriod = {
          totalRevenue: Math.max(0, priorAgg.metrics.totalRevenue - current.metrics.totalRevenue),
          totalAdSpend: Math.max(0, priorAgg.metrics.totalAdSpend - current.metrics.totalAdSpend),
          totalOrders: Math.max(0, priorAgg.metrics.totalOrders - current.metrics.totalOrders),
          aov: priorAgg.metrics.aov,
          mer: priorAgg.metrics.mer,
          metaSpend: Math.max(0, priorAgg.metrics.metaSpend - current.metrics.metaSpend),
          googleSpend: Math.max(0, priorAgg.metrics.googleSpend - current.metrics.googleSpend),
        };
      } else {
        priorPeriod = {
          totalRevenue: priorAgg.metrics.totalRevenue,
          totalAdSpend: priorAgg.metrics.totalAdSpend,
          totalOrders: priorAgg.metrics.totalOrders,
          aov: priorAgg.metrics.aov,
          mer: priorAgg.metrics.mer,
          metaSpend: priorAgg.metrics.metaSpend,
          googleSpend: priorAgg.metrics.googleSpend,
        };
      }
    }

    return NextResponse.json({
      source: 'windsor_live',
      timeframe: tf,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      revenueSource: current.revenueSource,
      metrics: current.metrics,
      revenueData: current.revenueData,
      ...(latestAvailableDate ? { dataLag: true, latestAvailableDate } : {}),
      ...(priorPeriod ? { priorPeriod, priorLabel } : {}),
    }, { headers: cacheHeaders(includesToday) });

  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      metrics: null,
      revenueData: [],
    });
  }
}
