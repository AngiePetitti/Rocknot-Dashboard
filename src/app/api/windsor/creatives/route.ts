import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '165092079662754';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function buildDateParams(tfRaw: string): Record<string, string> {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayStr = addDays(todayStr, -1);

  if (tfRaw === 'today') return { date_from: todayStr, date_to: todayStr };
  if (tfRaw === 'yesterday') return { date_from: yesterdayStr, date_to: yesterdayStr };
  if (tfRaw === '7d') return { date_from: addDays(todayStr, -7), date_to: yesterdayStr };
  if (tfRaw === '14d') return { date_from: addDays(todayStr, -14), date_to: yesterdayStr };
  if (tfRaw === '30d') return { date_from: addDays(todayStr, -30), date_to: yesterdayStr };
  if (tfRaw === '6m') return { date_from: addDays(todayStr, -180), date_to: yesterdayStr };
  if (tfRaw === 'ytd') {
    const year = todayStr.split('-')[0];
    return { date_from: `${year}-01-01`, date_to: yesterdayStr };
  }
  if (tfRaw === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    const firstOfPrev = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
    const lastOfPrev = new Date(y, m - 1, 0).toLocaleDateString('en-CA');
    return { date_from: firstOfPrev, date_to: lastOfPrev };
  }
  return { date_from: addDays(todayStr, -30), date_to: yesterdayStr };
}

interface CreativeRow {
  source?: string;
  ad_name?: string;
  ad_id?: string;
  account_id?: string;
  adset_name?: string;
  campaign?: string;
  spend?: number | string;
  conversion_value?: number | string;
  conversion_values?: number | string;
  revenue?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  ctr?: number | string;
  [key: string]: string | number | boolean | undefined;
}

export interface CreativePerformance {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok';
  thumbnailUrl: string | null;
  adUrl: string | null;
  campaign: string;
  adset: string;
  accountId: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
  conversions: number;
  costPerConversion: number;
}

const FIELDS_BY_SOURCE: Record<'facebook' | 'tiktok', string> = {
  facebook: [
    'source', 'ad_name', 'ad_id', 'account_id', 'adset_name', 'campaign',
    'spend', 'impressions', 'clicks', 'ctr',
    'purchase_roas', 'conversion_values', 'actions_omni_purchase',
  ].join(','),
  tiktok: [
    'source', 'ad_name', 'ad_id', 'account_id', 'adset_name', 'campaign',
    'spend', 'impressions', 'clicks', 'ctr',
    'conversion_value', 'revenue', 'conversions',
  ].join(','),
};

async function fetchCreatives(source: 'facebook' | 'tiktok', params: Record<string, string>): Promise<{ rows: CreativeRow[]; raw?: unknown }> {
  const fields = FIELDS_BY_SOURCE[source];
  const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
  const url = `https://connectors.windsor.ai/${source}?${qs}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  return { rows: json.data || [], raw: json };
}

function buildAdUrl(platform: 'Meta' | 'TikTok', adId: string, accountId: string): string | null {
  if (platform === 'Meta' && adId) {
    // Use the known correct account ID from env — Windsor's account_id field can be unreliable
    const act = `act_${META_AD_ACCOUNT_ID.replace('act_', '')}`;
    return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${adId}`;
  }
  if (platform === 'TikTok') {
    // Use Windsor's account_id for TikTok if available, fall back to env
    const tiktokAccount = accountId || '';
    return tiktokAccount
      ? `https://ads.tiktok.com/i18n/perf/campaign?aadvid=${tiktokAccount}`
      : null;
  }
  return null;
}

function aggregateCreatives(rows: CreativeRow[], platform: 'Meta' | 'TikTok'): CreativePerformance[] {
  const byAd: Record<string, CreativePerformance> = {};

  for (const row of rows) {
    const id = String(row.ad_id || row.ad_name || '');
    if (!id) continue;
    if (!row.spend && !row.impressions) continue;

    const accountId = String(row.account_id || '');

    if (!byAd[id]) {
      byAd[id] = {
        id,
        name: String(row.ad_name || 'Untitled creative'),
        platform,
        thumbnailUrl: null,
        adUrl: buildAdUrl(platform, id, accountId),
        campaign: String(row.campaign || ''),
        adset: String(row.adset_name || ''),
        accountId,
        spend: 0,
        revenue: 0,
        roas: 0,
        ctr: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        costPerConversion: 0,
      };
    }

    const entry = byAd[id];
    entry.spend += Number(row.spend || 0);

    const rawRow = row as Record<string, unknown>;
    const roasArr = Array.isArray(rawRow.purchase_roas) ? rawRow.purchase_roas as Array<{ value?: string }> : null;
    const roasVal = roasArr ? Number(roasArr[0]?.value || 0) : 0;
    const adSpend = Number(row.spend || 0);
    if (roasVal > 0 && adSpend > 0) {
      entry.revenue += roasVal * adSpend;
    } else {
      entry.revenue += Number(row.conversion_values || row.conversion_value || row.revenue || 0);
    }

    entry.impressions += Number(row.impressions || 0);
    entry.clicks += Number(row.clicks || 0);
    entry.conversions += Number(rawRow.actions_omni_purchase || rawRow.conversions || 0);
  }

  return Object.values(byAd).map(c => ({
    ...c,
    spend: Math.round(c.spend * 100) / 100,
    revenue: Math.round(c.revenue * 100) / 100,
    roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
    ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
    conversions: Math.round(c.conversions),
    costPerConversion: c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const debug = searchParams.get('debug') === 'true';

  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ source: 'mock', creatives: [] });
  }

  const params = buildDateParams(tfRaw);

  try {
    const [metaResult, tiktokResult] = await Promise.all([
      fetchCreatives('facebook', params),
      fetchCreatives('tiktok', params),
    ]);

    const metaActId = `act_${META_AD_ACCOUNT_ID.replace('act_', '')}`;

    if (debug) {
      return NextResponse.json({
        debug: true,
        metaActId,
        META_AD_ACCOUNT_ID,
        metaRaw: metaResult.raw,
        tiktokRaw: tiktokResult.raw,
      });
    }

    const creatives = [
      ...aggregateCreatives(metaResult.rows, 'Meta'),
      ...aggregateCreatives(tiktokResult.rows, 'TikTok'),
    ].sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ source: 'windsor_live', metaActId, creatives });
  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: String(err),
      creatives: [],
    });
  }
}
