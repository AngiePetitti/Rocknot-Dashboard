import { NextRequest, NextResponse } from 'next/server';
import { getMetricsForTimeframe, getRevenueForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

const DATE_PRESETS: Record<Timeframe, string> = {
  today:      'last_1dT',
  yesterday:  'last_1d',
  '7d':       'last_7dT',
  '14d':      'last_14dT',
  '30d':      'last_30dT',
  last_month: 'last_1m',
  '6m':       'last_180d',
  ytd:        'this_year',
};

const COMPARE_PRESETS: Record<Timeframe, string> = {
  today:      'last_1d',
  yesterday:  'last_2d',
  '7d':       'last_14dT',
  '14d':      'last_28dT',
  '30d':      'last_60dT',
  last_month: 'last_2m',
  '6m':       'last_360d',
  ytd:        'this_yearT',
};

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
  customer_is_returning?: number | string | boolean;
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
  newCustomers: number;
  returningCustomers: number;
  pctNew: number;
  pctReturning: number;
}

interface DayBucket {
  date: string;
  shopifyRevenue: number;
  adRevenue: number;
  orders: number;
  adSpend: number;
  metaSpend: number;
  googleSpend: number;
  tiktokSpend: number;
  newCustomers: number;
  returningCustomers: number;
}

function emptyBucket(date: string): DayBucket {
  return { date, shopifyRevenue: 0, adRevenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
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
      const rev = Number(row.order_current_total_price || row.order_subtotal_price || row.revenue || 0);
      byDate[date].shopifyRevenue += rev;
      byDate[date].orders += Math.round(Number(row.order_count || 0));
    } else {
      byDate[date].adSpend += spend;

      if (src.includes('facebook') || src.includes('meta')) {
        const roasArr = Array.isArray((row as Record<string, unknown>).purchase_roas)
          ? (row as Record<string, unknown>).purchase_roas as Array<{ value?: string }>
          : null;
        const roasVal = roasArr ? Number(roasArr[0]?.value || 0) : 0;
        byDate[date].adRevenue += roasVal > 0 ? roasVal * spend : 0;
        byDate[date].metaSpend += spend;
      } else if (src.includes('google')) {
        byDate[date].adRevenue += Number(row.conversion_value || row.revenue || 0);
        byDate[date].googleSpend += spend;
      } else if (src.includes('tiktok')) {
        byDate[date].adRevenue += Number(row.conversion_value || row.revenue || 0);
        byDate[date].tiktokSpend += spend;
      }
    }
  }

  const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const shopifyRevenueTotal = dailyData.reduce((s, d) => s + d.shopifyRevenue, 0);
  const hasShopifyRevenue = shopifyRevenueTotal > 0;

  const totalRevenue = hasShopifyRevenue
    ? shopifyRevenueTotal
    : dailyData.reduce((s, d) => s + d.adRevenue, 0);

  const totalAdSpend    = dailyData.reduce((s, d) => s + d.adSpend, 0);
  const totalOrders     = Math.round(dailyData.reduce((s, d) => s + d.orders, 0));
  const totalMetaSpend  = dailyData.reduce((s, d) => s + d.metaSpend, 0);
  const totalGoogleSpend = dailyData.reduce((s, d) => s + d.googleSpend, 0);
  const totalTikTokSpend = dailyData.reduce((s, d) => s + d.tiktokSpend, 0);
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
    newCustomers: totalNewCust,
    returningCustomers: totalRetCust,
    pctNew: totalOrders > 0 ? Math.round((totalNewCust / totalOrders) * 1000) / 10 : 0,
    pctReturning: totalOrders > 0 ? Math.round((totalRetCust / totalOrders) * 1000) / 10 : 0,
  };

  const revenueData = dailyData.map(d => ({
    date: d.date,
    revenue: Math.round(hasShopifyRevenue ? d.shopifyRevenue : d.adRevenue),
    orders: Math.round(d.orders),
    adSpend: Math.round(d.adSpend),
  }));

  return { metrics, revenueData, revenueSource: hasShopifyRevenue ? 'shopify' : 'ad_attribution' };
}

// Ad platform fields
const META_FIELDS = ['date', 'source', 'spend', 'impressions', 'clicks', 'ctr', 'purchase_roas', 'conversions'].join(',');
const GOOGLE_FIELDS = ['date', 'source', 'spend', 'impressions', 'clicks', 'conversions', 'conversion_value'].join(',');
// Shopify fields via Windsor /all endpoint
const SHOPIFY_FIELDS = ['date', 'source', 'order_count', 'order_current_total_price', 'order_subtotal_price', 'customer_is_returning'].join(',');

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
    return NextResponse.json({ source: 'mock', timeframe: tf, metrics: getMetricsForTimeframe(tf), revenueData: getRevenueForTimeframe(tf) });
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = addDays(todayStr, -1);

  try {
    let currentParams: Record<string, string>;
    if (isCustom && dateFrom && dateTo) {
      currentParams = { date_from: dateFrom, date_to: dateTo };
    } else if (tf === 'today') {
      currentParams = { date_from: todayStr, date_to: todayStr };
    } else if (tf === 'yesterday') {
      currentParams = { date_from: yesterdayStr, date_to: yesterdayStr };
    } else {
      currentParams = { date_preset: DATE_PRESETS[tf] || 'last_30dT' };
    }

    if (debug) {
      const [meta, google, shopifyAll] = await Promise.all([
        fetchFromWindsor('facebook', META_FIELDS, currentParams),
        fetchFromWindsor('google_ads', GOOGLE_FIELDS, currentParams),
        fetchFromWindsor('all', SHOPIFY_FIELDS, currentParams),
      ]);
      const shopifyRows = shopifyAll.rows.filter(r => String(r.source || '').toLowerCase().includes('shopify'));
      return NextResponse.json({
        debug: true,
        params: currentParams,
        meta: { rowCount: meta.rowCount, error: meta.error, sample: meta.rows.slice(0, 2) },
        google: { rowCount: google.rowCount, error: google.error, sample: google.rows.slice(0, 2) },
        shopify: {
          allRowCount: shopifyAll.rowCount,
          shopifySourceRows: shopifyRows.length,
          error: shopifyAll.error,
          sample: shopifyRows.slice(0, 3),
          // Show all unique sources from /all to understand what's in there
          sources: Array.from(new Set(shopifyAll.rows.map(r => r.source))).slice(0, 20),
        },
      });
    }

    const isShortTf = tf === 'today' || tf === 'yesterday';
    let currentRows = await fetchAllRows(currentParams);

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
        priorParams = { date_preset: COMPARE_PRESETS[tf] || 'last_60dT' };
        priorLabel = COMPARE_PRESETS[tf] || '';
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
    });

  } catch (err) {
    return NextResponse.json({
      source: 'mock_fallback',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      metrics: getMetricsForTimeframe(isCustom ? '30d' : tf),
      revenueData: getRevenueForTimeframe(isCustom ? '30d' : tf),
    });
  }
}
