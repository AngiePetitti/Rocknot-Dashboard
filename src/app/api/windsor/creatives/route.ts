import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

const DATE_PRESETS: Record<string, string> = {
  today: 'last_1dT',
  yesterday: 'last_1d',
  '7d': 'last_7dT',
  '14d': 'last_14dT',
  '30d': 'last_30dT',
  last_month: 'last_1m',
  '6m': 'last_180d',
  ytd: 'this_year',
};

interface CreativeRow {
  source?: string;
  ad_name?: string;
  ad_id?: string;
  creative_name?: string;
  creative_thumb_url?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_thumbnail_url?: string;
  spend?: number | string;
  conversion_value?: number | string;
  revenue?: number | string;
  impressions?: number | string;
  clicks?: number | string;
  ctr?: number | string;
  roas?: number | string;
  [key: string]: string | number | boolean | undefined;
}

export interface CreativePerformance {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok';
  thumbnailUrl: string | null;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
}

async function fetchCreatives(source: 'facebook' | 'tiktok', params: Record<string, string>): Promise<{ rows: CreativeRow[]; raw?: unknown }> {
  const fields = [
    'source', 'ad_name', 'ad_id', 'creative_name',
    'creative_thumb_url', 'thumbnail_url', 'image_url', 'video_thumbnail_url',
    'spend', 'conversion_value', 'revenue', 'impressions', 'clicks', 'ctr', 'roas',
  ].join(',');
  const qs = new URLSearchParams({ api_key: WINDSOR_API_KEY!, fields, _renderer: 'json', ...params });
  const url = `https://connectors.windsor.ai/${source}?${qs}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  return { rows: json.data || [], raw: json };
}

function aggregateCreatives(rows: CreativeRow[], platform: 'Meta' | 'TikTok'): CreativePerformance[] {
  const byAd: Record<string, CreativePerformance> = {};

  for (const row of rows) {
    const id = String(row.ad_id || row.ad_name || row.creative_name || '');
    if (!id) continue;
    if (!byAd[id]) {
      byAd[id] = {
        id,
        name: String(row.ad_name || row.creative_name || 'Untitled creative'),
        platform,
        thumbnailUrl: String(
          row.creative_thumb_url || row.thumbnail_url || row.image_url || row.video_thumbnail_url || ''
        ) || null,
        spend: 0,
        revenue: 0,
        roas: 0,
        ctr: 0,
        impressions: 0,
        clicks: 0,
      };
    }
    const entry = byAd[id];
    entry.spend += Number(row.spend || 0);
    entry.revenue += Number(row.revenue || row.conversion_value || 0);
    entry.impressions += Number(row.impressions || 0);
    entry.clicks += Number(row.clicks || 0);
  }

  return Object.values(byAd).map(c => ({
    ...c,
    spend: Math.round(c.spend * 100) / 100,
    revenue: Math.round(c.revenue * 100) / 100,
    roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
    ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const datePreset = DATE_PRESETS[tfRaw] || 'last_30dT';
  const debug = searchParams.get('debug') === 'true';

  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ source: 'mock', creatives: [] });
  }

  try {
    const [metaResult, tiktokResult] = await Promise.all([
      fetchCreatives('facebook', { date_preset: datePreset }),
      fetchCreatives('tiktok', { date_preset: datePreset }),
    ]);

    if (debug) {
      return NextResponse.json({
        debug: true,
        metaRaw: metaResult.raw,
        tiktokRaw: tiktokResult.raw,
      });
    }

    const creatives = [
      ...aggregateCreatives(metaResult.rows, 'Meta'),
      ...aggregateCreatives(tiktokResult.rows, 'TikTok'),
    ].sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ source: 'windsor_live', creatives });
  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: String(err),
      creatives: [],
    });
  }
}
