import { NextRequest, NextResponse } from 'next/server';
import { getMetricsForTimeframe, getRevenueForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';

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
  // Shopify-specific fields
  order_count?: number | string;
  order_current_total_price?: number | string;
  order_subtotal_price?: number | string;
  customer_is_returning?: number | string | boolean;
  new_customers?: number | string;
  returning_customers?: number | string;
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

function aggregateRows(adRows: WindsorRow[], shopifyRows: ShopifyDailyRow[]) {
  const byDate: Record<string, {
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
  }> = {};

  // Seed from Shopify direct data first (accurate revenue + orders)
  for (const row of shopifyRows) {
    if (!byDate[row.date]) {
      byDate[row.date] = { date: row.date, shopifyRevenue: 0, adRevenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
    }
    byDate[row.date].shopifyRevenue += row.revenue;
    byDate[row.date].orders += row.orders;
  }

  // Layer in ad platform spend + attributed revenue
  for (const row of adRows) {
    const date = String(row.date || '').split('T')[0];
    if (!date) continue;
    if (!byDate[date]) {
      byDate[date] = { date, shopifyRevenue: 0, adRevenue: 0, orders: 0, adSpend: 0, metaSpend: 0, googleSpend: 0, tiktokSpend: 0, newCustomers: 0, returningCustomers: 0 };
    }
    const spend = Number(row.spend || 0);
    const rowRevenue = Number(row.revenue || 0);
    const rowConvValue = Number(row.conversion_value || 0);
    const src = String(row.source || '').toLowerCase();

    byDate[date].adSpend += spend;

    if (src.includes('facebook') || src.includes('meta')) {
      // Meta: purchase_roas is [{action_type, value}] — back-calculate revenue from ROAS × spend
      const roasArr = Array.isArray((row as Record<string, unknown>).purchase_roas)
        ? (row as Record<string, unknown>).purchase_roas as Array<{ value?: string }>
        : null;
      const roasVal = roasArr ? Number(roasArr[0]?.value || 0) : 0;
      byDate[date].adRevenue += roasVal > 0 ? roasVal * spend : 0;
    } else {
      // Google and other ad platforms: use conversion_value
      byDate[date].adRevenue += rowConvValue || rowRevenue;
    }

    if (src.includes('facebook') || src.includes('meta') || src.includes('instagram')) {
      byDate[date].metaSpend += spend;
    } else if (src.includes('google') || src.includes('youtube') || src.includes('adwords') || src.includes('gads') || src.includes('pmax')) {
      byDate[date].googleSpend += spend;
    } else if (src.includes('tiktok')) {
      byDate[date].tiktokSpend += spend;
    }
  }

  const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const shopifyRevenueTotal = shopifyRows.length > 0
    ? dailyData.reduce((s, d) => s + d.shopifyRevenue, 0)
    : 0;
  const hasUsableShopifyRevenue = shopifyRevenueTotal > 0;

  // Always prefer direct Shopify revenue. Fall back to ad attribution only when Shopify API unavailable.
  const totalRevenue = hasUsableShopifyRevenue
    ? shopifyRevenueTotal
    : dailyData.reduce((s, d) => s + d.adRevenue, 0);
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
    revenue: Math.round(hasUsableShopifyRevenue ? d.shopifyRevenue : d.adRevenue),
    orders: Math.round(d.orders),
    adSpend: Math.round(d.adSpend),
  }));

  return { metrics, revenueData, revenueSource: hasUsableShopifyRevenue ? 'shopify' : 'ad_attribution' };
}

const META_FIELDS = [
  'date', 'source', 'spend', 'impressions', 'clicks', 'ctr',
  'purchase_roas', 'conversions',
].join(',');

const GOOGLE_FIELDS = [
  'date', 'source', 'spend', 'impressions', 'clicks',
  'conversions', 'conversion_value',
].join(',');

async function fetchSource(source: 'facebook' | 'google_ads', params: Record<string, string>): Promise<WindsorRow[]> {
  const fields = source === 'facebook' ? META_FIELDS : GOOGLE_FIELDS;
  const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
  const url = `https://connectors.windsor.ai/${source}?${qs}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  if (json.error || !json.data) return [];
  return (json.data as WindsorRow[]).map(r => ({ ...r, source: source === 'facebook' ? 'facebook' : source }));
}

const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com';

interface ShopifyDailyRow {
  date: string;
  revenue: number;
  orders: number;
}

async function fetchShopifyDirect(params: Record<string, string>): Promise<ShopifyDailyRow[]> {
  if (!SHOPIFY_TOKEN) return [];

  // Convert Windsor-style params to ShopifyQL date syntax
  let since = '';
  let until = 'today';

  if (params.date_from && params.date_to) {
    since = params.date_from;
    until = params.date_to;
  } else {
    // Map Windsor date_presets to ShopifyQL relative dates
    const presetMap: Record<string, { since: string; until: string }> = {
      last_1dT:   { since: 'today', until: 'today' },
      last_1d:    { since: 'yesterday', until: 'yesterday' },
      last_7dT:   { since: '-7d', until: 'today' },
      last_14dT:  { since: '-14d', until: 'today' },
      last_30dT:  { since: '-30d', until: 'today' },
      last_1m:    { since: '-60d', until: '-30d' },
      last_180d:  { since: '-180d', until: 'today' },
      this_year:  { since: '-365d', until: 'today' },
    };
    const mapped = presetMap[params.date_preset || ''] || { since: '-30d', until: 'today' };
    since = mapped.since;
    until = mapped.until;
  }

  const qlQuery = `FROM sales SHOW net_sales, orders TIMESERIES day SINCE ${since} UNTIL ${until}`;

  try {
    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: ${JSON.stringify(qlQuery)}) {
          tableData { rowData columns { name dataType } }
          parseErrors { code message }
        }}`,
      }),
      cache: 'no-store',
    });

    const json = await res.json();
    const result = json?.data?.shopifyqlQuery;
    if (!result || result.parseErrors?.length) return [];

    const cols: Array<{ name: string }> = result.tableData?.columns || [];
    const rows: string[][] = result.tableData?.rowData || [];
    const dayIdx = cols.findIndex(c => c.name === 'day');
    const revIdx = cols.findIndex(c => c.name === 'net_sales');
    const ordIdx = cols.findIndex(c => c.name === 'orders');

    return rows
      .map(r => ({
        date: String(r[dayIdx] || '').split('T')[0],
        revenue: parseFloat(r[revIdx] || '0') || 0,
        orders: parseInt(r[ordIdx] || '0') || 0,
      }))
      .filter(r => r.date);
  } catch {
    return [];
  }
}

async function fetchWindsor(params: Record<string, string>): Promise<{ adRows: WindsorRow[]; shopifyRows: ShopifyDailyRow[] }> {
  const [metaRows, googleRows, shopifyRows] = await Promise.all([
    fetchSource('facebook', params),
    fetchSource('google_ads', params),
    fetchShopifyDirect(params),
  ]);
  return { adRows: [...metaRows, ...googleRows], shopifyRows };
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

  // For today/yesterday use explicit dates to avoid preset issues + handle data lag
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = addDays(todayStr, -1);

  try {
    // Build query params for current period
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
      const debugFetch = async (source: 'facebook' | 'google_ads') => {
        try {
          const fields = source === 'facebook' ? META_FIELDS : GOOGLE_FIELDS;
          const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...currentParams });
          const url = `https://connectors.windsor.ai/${source}?${qs}`;
          const res = await fetch(url, { cache: 'no-store' });
          const json = await res.json();
          return { url: url.replace(WINDSOR_API_KEY!, '[KEY]'), rowCount: json.data?.length ?? 0, error: json.error ?? null, sample: (json.data || []).slice(0, 2) };
        } catch (e) {
          return { error: String(e), rowCount: 0, sample: [] };
        }
      };
      const [meta, google, shopifyDirect] = await Promise.all([
        debugFetch('facebook'),
        debugFetch('google_ads'),
        fetchShopifyDirect(currentParams),
      ]);
      return NextResponse.json({ debug: true, hasApiKey: !!WINDSOR_API_KEY, params: currentParams, meta, google, shopifyDirect: { rowCount: shopifyDirect.length, sample: shopifyDirect.slice(0, 3) } });
    }

    const isShortTf = tf === 'today' || tf === 'yesterday';

    // Fetch current period — ad spend from Windsor, revenue/orders direct from Shopify
    let { adRows: currentAdRows, shopifyRows: currentShopifyRows } = await fetchWindsor(currentParams);

    // If today/yesterday still returns no ad data, fall back to the most recent available day.
    let latestAvailableDate: string | null = null;
    if (currentAdRows.length === 0 && isShortTf) {
      const recent = await fetchWindsor({ date_preset: 'last_7dT' });
      if (recent.adRows.length > 0) {
        const dates = recent.adRows.map(r => String(r.date || '').split('T')[0]).filter(Boolean).sort();
        latestAvailableDate = dates[dates.length - 1];
        currentAdRows = recent.adRows.filter(r => String(r.date || '').split('T')[0] === latestAvailableDate);
      }
    }

    const shopifyDataLag = false;
    const shopifyLatestDate: string | null = null;

    const current = aggregateRows(currentAdRows, currentShopifyRows);
    const hasDataLag = latestAvailableDate !== null;

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

      const { adRows: priorAdRows, shopifyRows: priorShopifyRows } = await fetchWindsor(priorParams);
      const priorAgg = aggregateRows(priorAdRows, priorShopifyRows);

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
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      revenueSource: current.revenueSource,
      metrics: current.metrics,
      revenueData: current.revenueData,
      ...(hasDataLag ? { dataLag: true, latestAvailableDate } : {}),
      ...(shopifyDataLag ? { shopifyDataLag: true, shopifyLatestDate } : {}),
      ...(priorPeriod ? { priorPeriod, priorLabel } : {}),
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
