import { NextRequest, NextResponse } from 'next/server';
import { getMetricsForTimeframe, getRevenueForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

// Windsor.ai date presets — format: last_Xd (excludes today), last_XdT (includes today)
// last_XdT includes today's partial data; last_Xd is fully completed days only
const DATE_PRESETS: Record<Timeframe, string> = {
  today:      'last_1dT',    // today only (partial)
  yesterday:  'last_1d',     // yesterday only (completed)
  '7d':       'last_7dT',    // last 7 days including today
  '14d':      'last_14dT',   // last 14 days including today
  '30d':      'last_30dT',   // last 30 days including today
  last_month: 'last_1m',     // previous calendar month (May when current is June)
  '6m':       'last_180d',   // last 180 days
  ytd:        'this_year',   // Jan 1 to today
};

interface WindsorRow {
  date?: string;
  source?: string;
  spend?: number;
  revenue?: number;
  roas?: number;
  impressions?: number;
  clicks?: number;
  purchases?: number;
  [key: string]: string | number | undefined;
}

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;

  if (!WINDSOR_API_KEY) {
    const metrics = getMetricsForTimeframe(tf);
    const revenueData = getRevenueForTimeframe(tf);
    return NextResponse.json({ source: 'mock', timeframe: tf, metrics, revenueData });
  }

  try {
    const datePreset = DATE_PRESETS[tf] || 'last_30_days';
    const debug = request.nextUrl.searchParams.get('debug') === 'true';

    // Windsor field names: spend, revenue (Shopify), conversion_value (ad platforms), conversions, impressions, clicks, roas
    const fields = 'date,source,spend,revenue,conversion_value,roas,impressions,clicks,conversions,purchases';
    const url = `https://connectors.windsor.ai/all?api_key=${WINDSOR_API_KEY}&date_preset=${datePreset}&fields=${fields}&_renderer=json`;

    const res = await fetch(url, { next: { revalidate: 3600 } });
    const json = await res.json();

    if (debug) {
      return NextResponse.json({ debug: true, url: url.replace(WINDSOR_API_KEY!, '[KEY]'), raw: json });
    }

    if (!res.ok || json.error) {
      throw new Error(json.error || `Windsor API error: ${res.status}`);
    }

    const rows: WindsorRow[] = json.data || [];

    // Aggregate by date across all sources
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
      const date = row.date || '';
      if (!date) continue;
      if (!byDate[date]) {
        byDate[date] = { date, revenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
      }
      const spend = Number(row.spend || 0);
      // 'revenue' = Shopify total; 'conversion_value' = ad-attributed revenue from Meta/Google
      const rowRevenue = Number(row.revenue || 0);
      const rowConvValue = Number(row.conversion_value || 0);
      const src = (row.source || '').toLowerCase();

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

    // Also fetch Shopify revenue separately if available
    const shopifyRows = rows.filter(r => (r.source || '').toLowerCase().includes('shopify'));
    const shopifyRevenue = shopifyRows.reduce((s, r) => s + Number(r.revenue || 0), 0);

    const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    const totalRevenue = shopifyRevenue || dailyData.reduce((s, d) => s + d.revenue, 0);
    const totalAdSpend = dailyData.reduce((s, d) => s + d.adSpend, 0);
    const totalOrders = Math.round(dailyData.reduce((s, d) => s + d.orders, 0));
    const totalMetaSpend = dailyData.reduce((s, d) => s + d.metaSpend, 0);
    const totalGoogleSpend = dailyData.reduce((s, d) => s + d.googleSpend, 0);
    const totalTikTokSpend = dailyData.reduce((s, d) => s + d.tiktokSpend, 0);
    const totalNewCustomers = dailyData.reduce((s, d) => s + d.newCustomers, 0);
    const totalReturningCustomers = dailyData.reduce((s, d) => s + d.returningCustomers, 0);

    return NextResponse.json({
      source: 'windsor_live',
      timeframe: tf,
      revenueData: dailyData.map(d => ({
        date: d.date,
        revenue: Math.round(d.revenue),
        orders: Math.round(d.orders),
        adSpend: Math.round(d.adSpend),
      })),
      metrics: {
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
      },
    });

  } catch (err) {
    const metrics = getMetricsForTimeframe(tf);
    const revenueData = getRevenueForTimeframe(tf);
    return NextResponse.json({
      source: 'mock_fallback',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      metrics,
      revenueData,
    });
  }
}
