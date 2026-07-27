import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getAdsOverview } from '@/src/lib/bqAds';
import { fetchMetaToday } from '@/src/lib/metaLive';
import { fetchSnapToday } from '@/src/lib/snapLive';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { mtdRange } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;
// Rocknot's Meta ad account. Other clients connected to the same Windsor
// workspace are returned by the facebook feed too and must be excluded.
const ROCKNOT_META_ACCOUNT_ID = (process.env.META_AD_ACCOUNT_ID || '165092079662754').trim().replace('act_', '');


interface WindsorRow {
  date?: string;
  source?: string;
  spend?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  ctr?: number | string;
  conversion_value?: number | string;
  conversions?: number | string;
  [key: string]: string | number | boolean | undefined;
}

interface DaySpend {
  date: string;
  meta: number;
  google: number;
  tiktok: number;
  snapchat: number;
}

export interface PlatformData {
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  color: string;
}

// Totals request: no date field — Windsor returns per-ad aggregated rows (avoids row-limit truncation)
async function fetchSourceTotals(source: 'facebook' | 'google_ads' | 'tiktok' | 'snapchat', params: Record<string, string>): Promise<WindsorRow[]> {
  const fieldMap = {
    facebook:   'account_id,source,spend,impressions,clicks,action_values_omni_purchase,actions_omni_purchase',
    google_ads: 'source,spend,impressions,clicks,conversion_value',
    tiktok:     'source,spend,impressions,clicks,complete_payment,total_complete_payment_rate,onsite_total_purchase_value,conversion_value',
    snapchat:   'source,spend,impressions,clicks,conversion_purchases,conversion_purchases_value',
  };
  try {
    const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields: fieldMap[source], _renderer: 'json', ...params });
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return onlyRocknot(source, (json.data || []) as WindsorRow[]);
  } catch {
    return [];
  }
}

// Facebook feed can contain multiple clients' accounts; keep Rocknot only.
function onlyRocknot(source: string, rows: WindsorRow[]): WindsorRow[] {
  if (source !== 'facebook') return rows;
  return rows.filter(r => String(r.account_id ?? '').replace('act_', '') === ROCKNOT_META_ACCOUNT_ID);
}

// Daily request: only date+spend — Windsor returns ~1 row per day (small row count for chart)
async function fetchSourceDaily(source: 'facebook' | 'google_ads' | 'tiktok' | 'snapchat', params: Record<string, string>): Promise<WindsorRow[]> {
  try {
    const fields = source === 'facebook' ? 'date,account_id,source,spend' : 'date,source,spend';
    const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return onlyRocknot(source, (json.data || []) as WindsorRow[]);
  } catch {
    return [];
  }
}

function aggregatePlatform(rows: WindsorRow[], platform: 'Meta' | 'Google' | 'TikTok' | 'Snapchat', color: string): PlatformData {
  let spend = 0, impressions = 0, clicks = 0, revenue = 0;

  for (const row of rows) {
    const s = Number(row.spend || 0);
    spend += s;
    impressions += Number(row.impressions || 0);
    clicks += Number(row.clicks || 0);

    if (platform === 'Meta') {
      revenue += Number((row as Record<string, unknown>).action_values_omni_purchase || 0);
    } else if (platform === 'Snapchat') {
      revenue += Number((row as Record<string, unknown>).conversion_purchases_value || 0);
    } else if (platform === 'TikTok') {
      const tk = row as Record<string, unknown>;
      // total_complete_payment_rate is TikTok's total purchase value (Windsor's
      // misleading name); complete_payment_value is empty for this account.
      revenue += Number(tk.total_complete_payment_rate || tk.onsite_total_purchase_value || row.conversion_value || 0);
    } else {
      revenue += Number(row.conversion_value || 0);
    }
  }

  return {
    platform,
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    color,
  };
}

function buildDailySpend(metaRows: WindsorRow[], googleRows: WindsorRow[], tiktokRows: WindsorRow[], snapRows: WindsorRow[]): DaySpend[] {
  const byDate: Record<string, DaySpend> = {};

  const add = (rows: WindsorRow[], key: 'meta' | 'google' | 'tiktok' | 'snapchat') => {
    for (const row of rows) {
      const date = String(row.date || '').split('T')[0];
      if (!date) continue;
      if (!byDate[date]) byDate[date] = { date, meta: 0, google: 0, tiktok: 0, snapchat: 0 };
      byDate[date][key] += Number(row.spend || 0);
    }
  };

  add(metaRows, 'meta');
  add(googleRows, 'google');
  add(tiktokRows, 'tiktok');
  add(snapRows, 'snapchat');

  return Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      date: d.date,
      meta: Math.round(d.meta),
      google: Math.round(d.google),
      tiktok: Math.round(d.tiktok),
      snapchat: Math.round(d.snapchat),
    }));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';

  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ source: 'mock', platforms: [], dailySpend: [] });
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayStr = addDays(todayStr, -1);

  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  // Build explicit date ranges. Ranges end on today to match how Shopify and
  // the overview report rolling windows (today's portion lags ~1h on BigQuery).
  function rangeParams(daysBack: number): Record<string, string> {
    return { date_from: addDays(todayStr, -daysBack), date_to: todayStr };
  }

  function firstOfMonth(monthsBack: number): string {
    // Use PST date parts to avoid UTC day-shift
    const pst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const [y, m] = pst.split('-').map(Number);
    const target = new Date(y, m - 1 - monthsBack, 1);
    return target.toLocaleDateString('en-CA');
  }
  function lastOfPrevMonth(): string {
    const pst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const [y, m] = pst.split('-').map(Number);
    const lastDay = new Date(y, m - 1, 0);
    return lastDay.toLocaleDateString('en-CA');
  }

  let params: Record<string, string>;
  if (tfRaw === 'custom' && dateFrom && dateTo) {
    params = { date_from: dateFrom, date_to: dateTo };
  } else if (tfRaw === 'today') {
    params = { date_from: todayStr, date_to: todayStr };
  } else if (tfRaw === 'yesterday') {
    params = { date_from: yesterdayStr, date_to: yesterdayStr };
  } else if (tfRaw === '7d') {
    params = rangeParams(7);
  } else if (tfRaw === '14d') {
    params = rangeParams(14);
  } else if (tfRaw === '30d') {
    params = rangeParams(30);
  } else if (tfRaw === 'mtd') {
    const r = mtdRange(todayStr, yesterdayStr);
    params = { date_from: r.from, date_to: r.to };
  } else if (tfRaw === 'last_month') {
    params = { date_from: firstOfMonth(1), date_to: lastOfPrevMonth() };
  } else if (tfRaw === '6m') {
    params = rangeParams(180);
  } else if (tfRaw === 'ytd') {
    const year = todayStr.split('-')[0];
    params = { date_from: `${year}-01-01`, date_to: todayStr };
  } else {
    params = rangeParams(30);
  }

  const debug = searchParams.get('debug') === 'true';

  // Prefer BigQuery; if it fails (e.g. a column not yet synced by Windsor)
  // fall through to the Windsor REST API below. Only the explicit "today" tab
  // goes straight to the live Windsor API (with Meta Graph overlay); multi-day
  // ranges that include today still use BigQuery — today's portion lags ~1h on
  // Windsor's sync but stays consistent with the overview tab.
  const useLiveToday = tfRaw === 'today';
  if (isBigQueryConfigured() && !debug && !useLiveToday) {
    try {
      const { platforms, dailySpend } = await getAdsOverview(params.date_from, params.date_to);
      return NextResponse.json({ source: 'bigquery_live', platforms, dailySpend }, { headers: cacheHeaders(false) });
    } catch {
      // fall through to Windsor REST
    }
  }

  try {
    const [metaTotals, googleTotals, tiktokTotals, snapTotals, metaDaily, googleDaily, tiktokDaily, snapDaily] = await Promise.all([
      fetchSourceTotals('facebook', params),
      fetchSourceTotals('google_ads', params),
      fetchSourceTotals('tiktok', params),
      fetchSourceTotals('snapchat', params),
      fetchSourceDaily('facebook', params),
      fetchSourceDaily('google_ads', params),
      fetchSourceDaily('tiktok', params),
      fetchSourceDaily('snapchat', params),
    ]);

    if (debug) {
      const metaSpend = metaTotals.reduce((s, r) => s + Number(r.spend || 0), 0);
      return NextResponse.json({
        debug: true,
        params,
        metaTotalsRowCount: metaTotals.length,
        metaSpendTotal: Math.round(metaSpend * 100) / 100,
        metaTotalsSample: metaTotals.slice(0, 5),
        metaDailyRowCount: metaDaily.length,
        metaDailySample: metaDaily.slice(0, 5),
        googleTotalsRowCount: googleTotals.length,
        tiktokTotalsRowCount: tiktokTotals.length,
      });
    }

    const platforms: PlatformData[] = [];

    const meta = aggregatePlatform(metaTotals, 'Meta', '#818cf8');
    // Live Graph API numbers for today — Windsor's intraday Meta data lags
    if (tfRaw === 'today') {
      const metaLive = await fetchMetaToday();
      if (metaLive && metaLive.spend >= meta.spend) {
        meta.spend = Math.round(metaLive.spend * 100) / 100;
        meta.revenue = Math.round(metaLive.revenue * 100) / 100;
        meta.roas = meta.spend > 0 ? Math.round((meta.revenue / meta.spend) * 100) / 100 : 0;
        meta.clicks = metaLive.clicks;
      }
    }
    if (meta.spend > 0) platforms.push(meta);

    const google = aggregatePlatform(googleTotals, 'Google', '#34d399');
    if (google.spend > 0) platforms.push(google);

    const tiktok = aggregatePlatform(tiktokTotals, 'TikTok', '#f472b6');
    if (tiktok.spend > 0) platforms.push(tiktok);

    const snapchat = aggregatePlatform(snapTotals, 'Snapchat', '#facc15');
    // Live Snap Marketing API numbers for today — Windsor's intraday
    // snapchat sync lags by hours (same treatment as Meta above).
    if (tfRaw === 'today') {
      const snapLive = await fetchSnapToday().catch(() => null);
      if (snapLive && snapLive.spend >= snapchat.spend) {
        snapchat.spend = snapLive.spend;
        snapchat.revenue = snapLive.revenue;
        snapchat.roas = snapchat.spend > 0 ? Math.round((snapchat.revenue / snapchat.spend) * 100) / 100 : 0;
      }
    }
    if (snapchat.spend > 0) platforms.push(snapchat);

    const dailySpend = buildDailySpend(metaDaily, googleDaily, tiktokDaily, snapDaily);

    return NextResponse.json({ source: 'windsor_live', platforms, dailySpend }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), platforms: [], dailySpend: [] });
  }
}
