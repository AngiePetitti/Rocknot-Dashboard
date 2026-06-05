import { NextRequest, NextResponse } from 'next/server';
import { getMetricsForTimeframe, getRevenueForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

// Windsor date presets — format: last_Xd (excludes today), last_XdT (includes today)
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

// Prior period presets for comparison
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
  roas?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  conversions?: number | string;
  purchases?: number | string;
  orders?: number | string;
  new_customers?: number | string;
  returning_customers?: number | string;
  [key: string]: string | number | undefined;
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

function aggregateRows(rows: WindsorRow[]) {
  const byDate: Record<string, {
    date: string;
    revenue: number;
    orders: number;
    adSpend: number;
    metaSpend: number;
    googleSpend: number;
    tiktokSpend: number;
    newCustomers: number;
    returningCustomers: number;
  }> = {};

  for (const row of rows) {
    const date = String(row.date || '').split('T')[0];
    if (!date) continue;
    if (!byDate[date]) {
      byDate[date] = { date, revenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
    }
    const spend = Number(row.spend || 0);
    const rowRevenue = Number(row.revenue || 0);
    const rowConvValue = Number(row.conversion_value || 0);
    const src = String(row.source || '').toLowerCase();

    byDate[date].adSpend += spend;
    byDate[date].revenue += rowRevenue || rowConvValue;
    byDate[date].orders += Math.round(Number(row.conversions || row.purchases || row.orders || 0));
    byDate[date].newCustomers += Math.round(Number(row.new_customers || 0));
    byDate[date].returningCustomers += Math.round(Number(row.returning_customers || 0));

    if (src.includes('facebook') || src.includes('meta') || src.includes('instagram')) {
      byDate[date].metaSpend += spend;
    } else if (src.includes('google') || src.includes('youtube')) {
      byDate[date].googleSpend += spend;
    } else if (src.includes('tiktok')) {
      byDate[date].tiktokSpend += spend;
    }
  }

  const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const shopifyRevenue = rows
    .filter(r => String(r.source || '').toLowerCase().includes('shopify'))
    .reduce((s, r) => s + Number(r.revenue || 0), 0);

  const totalRevenue = shopifyRevenue || dailyData.reduce((s, d) => s + d.revenue, 0);
  const totalAdSpend = dailyData.reduce((s, d) => s + d.adSpend, 0);
  const totalOrders = Math.round(dailyData.reduce((s, d) => s + d.orders, 0));
  const totalMetaSpend = dailyData.reduce((s, d) => s + d.metaSpend, 0);
  const totalGoogleSpend = dailyData.reduce((s, d) => s + d.googleSpend, 0);
  const totalTikTokSpend = dailyData.reduce((s, d) => s + d.tiktokSpend, 0);
  const totalNewCustomers = dailyData.reduce((s, d) => s + d.newCustomers, 0);
  const totalReturningCustomers = dailyData.reduce((s, d) => s + d.returningCustomers, 0);

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
    newCustomers: totalNewCustomers,
    returningCustomers: totalReturningCustomers,
    pctNew: totalOrders > 0 ? Math.round((totalNewCustomers / totalOrders) * 1000) / 10 : 0,
    pctReturning: totalOrders > 0 ? Math.round((totalReturningCustomers / totalOrders) * 1000) / 10 : 0,
  };

  const revenueData = dailyData.map(d => ({
    date: d.date,
    revenue: Math.round(d.revenue),
    orders: Math.round(d.orders),
    adSpend: Math.round(d.adSpend),
  }));

  return { metrics, revenueData };
}

async function fetchWindsor(params: Record<string, string>): Promise<WindsorRow[]> {
  const fields = 'date,source,spend,revenue,conversion_value,roas,impressions,clicks,conversions,purchases';
  const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
  const url = `https://connectors.windsor.ai/all?${qs}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data || [];
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
    const metrics = getMetricsForTimeframe(isCustom ? '30d' : tf);
    const revenueData = getRevenueForTimeframe(isCustom ? '30d' : tf);
    return NextResponse.json({ source: 'mock', timeframe: tf, metrics, revenueData });
  }

  try {
    // Build query params for current period
    const currentParams: Record<string, string> = isCustom && dateFrom && dateTo
      ? { date_from: dateFrom, date_to: dateTo }
      : { date_preset: DATE_PRESETS[tf] || 'last_30dT' };

    if (debug) {
      const fields = 'date,source,spend,revenue,conversion_value,roas,impressions,clicks,conversions,purchases';
      const qs = new URLSearchParams({ api_key: '[KEY]', fields, _renderer: 'json', ...currentParams });
      const raw = await fetchWindsor(currentParams);
      return NextResponse.json({ debug: true, url: `https://connectors.windsor.ai/all?${qs}`, raw: raw.slice(0, 5) });
    }

    // Fetch current period
    const currentRows = await fetchWindsor(currentParams);
    const current = aggregateRows(currentRows);

    // Fetch comparison period if requested
    let priorPeriod = null;
    let priorLabel = '';

    if (withCompare) {
      let priorParams: Record<string, string>;

      if (isCustom && dateFrom && dateTo) {
        // Mirror the exact same number of days before the selected range
        const days = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
        const priorTo = addDays(dateFrom, -1);
        const priorFrom = addDays(dateFrom, -days);
        priorParams = { date_from: priorFrom, date_to: priorTo };
        priorLabel = `${priorFrom} – ${priorTo}`;
      } else {
        // Use the second half of a doubled preset (e.g. last_60dT gives us the prior 30 in the first half)
        priorParams = { date_preset: COMPARE_PRESETS[tf] || 'last_60dT' };
        priorLabel = COMPARE_PRESETS[tf] || '';
      }

<<<<<<< HEAD
      const priorRows = await fetchWindsor(priorParams);
      const priorAgg = aggregateRows(priorRows);
=======
      byDate[date].adSpend += spend;
      byDate[date].revenue += revenue;
      byDate[date].orders += Math.round(Number(row.orders || row.purchases || 0));
      byDate[date].newCustomers += Number(row.new_customers || 0);
      byDate[date].returningCustomers += Number(row.returning_customers || 0);
>>>>>>> 207e5e3 (Fix decimal orders and use live Windsor spend in platform table)

      // For preset comparison, prior period data includes current + prior rows together
      // so we subtract current to isolate the prior window
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
<<<<<<< HEAD
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      metrics: current.metrics,
      revenueData: current.revenueData,
      ...(priorPeriod ? { priorPeriod, priorLabel } : {}),
=======
      revenueData: dailyData.map(d => ({
        date: d.date,
        revenue: Math.round(d.revenue),
        orders: Math.round(d.orders),
        adSpend: Math.round(d.adSpend),
      })),
      metrics: {
        totalRevenue: Math.round(totalRevenue),
        totalOrders: Math.round(totalOrders),
        totalAdSpend: Math.round(totalAdSpend),
        aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
        returns: 0,
        metaSpend: Math.round(totalMetaSpend),
        googleSpend: Math.round(totalGoogleSpend),
        tiktokSpend: Math.round(totalTikTokSpend),
        newCustomers: totalNewCustomers,
        returningCustomers: totalReturningCustomers,
        pctNew: totalOrders > 0 ? Math.round((totalNewCustomers / totalOrders) * 1000) / 10 : 0,
        pctReturning: totalOrders > 0 ? Math.round((totalReturningCustomers / totalOrders) * 1000) / 10 : 0,
      },
>>>>>>> 207e5e3 (Fix decimal orders and use live Windsor spend in platform table)
    });

  } catch (err) {
    const metrics = getMetricsForTimeframe(isCustom ? '30d' : tf);
    const revenueData = getRevenueForTimeframe(isCustom ? '30d' : tf);
    return NextResponse.json({
      source: 'mock_fallback',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      metrics,
      revenueData,
    });
  }
}
