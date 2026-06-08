import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

const DATE_PRESETS: Record<string, string> = {
  today:      'last_1dT',
  yesterday:  'last_1d',
  '7d':       'last_7dT',
  '14d':      'last_14dT',
  '30d':      'last_30dT',
  last_month: 'last_1m',
  '6m':       'last_180d',
  ytd:        'this_year',
};

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

async function fetchSource(source: 'facebook' | 'google_ads' | 'tiktok', params: Record<string, string>): Promise<WindsorRow[]> {
  const fieldMap = {
    facebook:   'date,source,spend,impressions,clicks,ctr,purchase_roas,conversions',
    google_ads: 'date,source,spend,impressions,clicks,ctr,conversions,conversion_value',
    tiktok:     'date,source,spend,impressions,clicks,ctr,conversion_value',
  };
  try {
    const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields: fieldMap[source], _renderer: 'json', ...params });
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []) as WindsorRow[];
  } catch {
    return [];
  }
}

function aggregatePlatform(rows: WindsorRow[], platform: 'Meta' | 'Google' | 'TikTok', color: string): PlatformData {
  let spend = 0, impressions = 0, clicks = 0, revenue = 0;

  for (const row of rows) {
    const s = Number(row.spend || 0);
    spend += s;
    impressions += Number(row.impressions || 0);
    clicks += Number(row.clicks || 0);

    if (platform === 'Meta') {
      const roasArr = Array.isArray((row as Record<string, unknown>).purchase_roas)
        ? (row as Record<string, unknown>).purchase_roas as Array<{ value?: string }>
        : null;
      const roasVal = roasArr ? Number(roasArr[0]?.value || 0) : 0;
      revenue += roasVal > 0 ? roasVal * s : 0;
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

function buildDailySpend(metaRows: WindsorRow[], googleRows: WindsorRow[], tiktokRows: WindsorRow[]): DaySpend[] {
  const byDate: Record<string, DaySpend> = {};

  const add = (rows: WindsorRow[], key: 'meta' | 'google' | 'tiktok') => {
    for (const row of rows) {
      const date = String(row.date || '').split('T')[0];
      if (!date) continue;
      if (!byDate[date]) byDate[date] = { date, meta: 0, google: 0, tiktok: 0 };
      byDate[date][key] += Number(row.spend || 0);
    }
  };

  add(metaRows, 'meta');
  add(googleRows, 'google');
  add(tiktokRows, 'tiktok');

  return Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      date: d.date,
      meta: Math.round(d.meta),
      google: Math.round(d.google),
      tiktok: Math.round(d.tiktok),
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

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = addDays(todayStr, -1);

  let params: Record<string, string>;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  if (tfRaw === 'custom' && dateFrom && dateTo) {
    params = { date_from: dateFrom, date_to: dateTo };
  } else if (tfRaw === 'today') {
    params = { date_from: todayStr, date_to: todayStr };
  } else if (tfRaw === 'yesterday') {
    params = { date_from: yesterdayStr, date_to: yesterdayStr };
  } else {
    params = { date_preset: DATE_PRESETS[tfRaw] || 'last_30dT' };
  }

  try {
    const [metaRows, googleRows, tiktokRows] = await Promise.all([
      fetchSource('facebook', params),
      fetchSource('google_ads', params),
      fetchSource('tiktok', params),
    ]);

    const platforms: PlatformData[] = [];

    const meta = aggregatePlatform(metaRows, 'Meta', '#818cf8');
    if (meta.spend > 0) platforms.push(meta);

    const google = aggregatePlatform(googleRows, 'Google', '#34d399');
    if (google.spend > 0) platforms.push(google);

    const tiktok = aggregatePlatform(tiktokRows, 'TikTok', '#f472b6');
    if (tiktok.spend > 0) platforms.push(tiktok);

    const dailySpend = buildDailySpend(metaRows, googleRows, tiktokRows);

    return NextResponse.json({ source: 'windsor_live', platforms, dailySpend });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), platforms: [], dailySpend: [] });
  }
}
