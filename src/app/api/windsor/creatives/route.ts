import { NextRequest, NextResponse } from 'next/server';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

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
  if (tfRaw === '7d') return { date_from: addDays(todayStr, -7), date_to: todayStr };
  if (tfRaw === '14d') return { date_from: addDays(todayStr, -14), date_to: todayStr };
  if (tfRaw === '30d') return { date_from: addDays(todayStr, -30), date_to: todayStr };
  if (tfRaw === '6m') return { date_from: addDays(todayStr, -180), date_to: todayStr };
  if (tfRaw === 'ytd') {
    const year = todayStr.split('-')[0];
    return { date_from: `${year}-01-01`, date_to: todayStr };
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
  videoUrl: string | null;
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

// 'ctr' is intentionally excluded: it's a rate metric, and Windsor can only
// return it un-aggregated (one row per ad per day) — which made larger
// ranges (30d, ytd) return far more rows and run far slower. ctr is
// re-derived from clicks/impressions in aggregateCreatives anyway.
const FIELDS_BY_SOURCE: Record<'facebook' | 'tiktok', string> = {
  facebook: [
    'source', 'ad_name', 'ad_id', 'account_id', 'adset_name', 'campaign',
    'spend', 'impressions', 'clicks',
    'action_values_omni_purchase', 'actions_omni_purchase',
  ].join(','),
  tiktok: [
    'source', 'ad_name', 'ad_id', 'account_id', 'adset_name', 'campaign',
    'spend', 'impressions', 'clicks',
    'onsite_total_purchase_value', 'conversion_value', 'revenue', 'conversions',
  ].join(','),
};

async function fetchCreatives(source: 'facebook' | 'tiktok', params: Record<string, string>, isToday: boolean): Promise<{ rows: CreativeRow[]; raw?: unknown }> {
  const fields = FIELDS_BY_SOURCE[source];
  const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
  const url = `https://connectors.windsor.ai/${source}?${qs}`;
  // "Today" must stay live (intraday spend changes by the minute). Past
  // ranges are historical and won't change, so cache the Windsor response —
  // this is the main latency cost on a date-range switch.
  const res = await fetch(url, isToday ? { cache: 'no-store' } : { next: { revalidate: 1800 } });
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
        videoUrl: null,
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
    entry.revenue += Number(
      rawRow.action_values_omni_purchase ||
      rawRow.onsite_total_purchase_value ||
      row.conversion_values ||
      row.conversion_value ||
      row.revenue ||
      0
    );

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

// Creative previews come from Windsor too (its Meta connection is already
// authorized, unlike our direct Meta token which keeps expiring). This is a
// separate request from the performance fetch so an unsupported field here
// can never break the main data.
//
// Thumbnails/video URLs don't change with the selected timeframe, but
// re-fetching them on every timeframe switch was a big chunk of this
// endpoint's latency. Always fetch them over a fixed wide window (so the
// URL — and Next's fetch cache — is identical across timeframes) and let
// Next cache the response for an hour.
async function fetchWindsorAdUrls(
  source: 'facebook' | 'tiktok',
  params: Record<string, string>,
  fields: string[]
): Promise<{ urls: Record<string, string>; error: string | null }> {
  const qs = new URLSearchParams({
    api_key: WINDSOR_API_KEY!,
    fields: ['ad_id', ...fields].join(','),
    _renderer: 'json',
    ...params,
  });
  try {
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { next: { revalidate: 3600 } });
    const json = await res.json();
    if (json.error) return { urls: {}, error: String(json.error) };
    const urls: Record<string, string> = {};
    for (const row of (json.data || []) as Array<Record<string, unknown>>) {
      const id = String(row.ad_id || '');
      if (!id || urls[id]) continue;
      for (const f of fields) {
        const url = String(row[f] || '');
        if (url && url !== 'null' && url.startsWith('http')) {
          urls[id] = url;
          break;
        }
      }
    }
    return { urls, error: null };
  } catch (e) {
    return { urls: {}, error: String(e) };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const debug = searchParams.get('debug') === 'true';

  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ source: 'error', error: 'Windsor API key not configured', creatives: [] });
  }

  const params = buildDateParams(tfRaw);
  // Fixed wide window for thumbnail/video URL lookups, independent of `tf`,
  // so the request URL — and Next's revalidate: 3600 fetch cache — is
  // identical across timeframe switches.
  const urlParams = buildDateParams('6m');

  const isToday = tfRaw === 'today';

  try {
    const [metaResult, tiktokResult, metaThumbs, tiktokThumbs, tiktokVideos] = await Promise.all([
      fetchCreatives('facebook', params, isToday),
      fetchCreatives('tiktok', params, isToday),
      fetchWindsorAdUrls('facebook', urlParams, ['thumbnail_url', 'image_url']),
      fetchWindsorAdUrls('tiktok', urlParams, ['video_thumbnail_url']),
      // Playable video sources. Only TikTok: Windsor's facebook connector is
      // Insights-based and has no video source field (verified Jun 2026) —
      // Meta playback would need the Graph API ad-preview embed + valid token.
      fetchWindsorAdUrls('tiktok', urlParams, ['video_url']),
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

    const metaCreatives = aggregateCreatives(metaResult.rows, 'Meta');
    const tiktokCreatives = aggregateCreatives(tiktokResult.rows, 'TikTok');
    for (const c of metaCreatives) {
      c.thumbnailUrl = metaThumbs.urls[c.id] || null;
    }
    for (const c of tiktokCreatives) {
      c.thumbnailUrl = tiktokThumbs.urls[c.id] || null;
      c.videoUrl = tiktokVideos.urls[c.id] || null;
    }

    const creatives = [...metaCreatives, ...tiktokCreatives].sort((a, b) => b.spend - a.spend);

    return NextResponse.json({
      source: 'windsor_live',
      metaActId,
      thumbnailsFound: Object.keys(metaThumbs.urls).length + Object.keys(tiktokThumbs.urls).length,
      videosFound: Object.keys(tiktokVideos.urls).length,
      thumbnailError: metaThumbs.error || tiktokThumbs.error,
      videoError: tiktokVideos.error,
      creatives,
    }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: String(err),
      creatives: [],
    });
  }
}
