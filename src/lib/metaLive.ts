// Today's Meta numbers straight from the Graph API — the same source Ads
// Manager reads — bypassing Windsor's refresh lag for the live view.

export interface MetaToday {
  spend: number;
  revenue: number;
  purchases: number;
  clicks: number;
}

export interface MetaDay { date: string; spend: number; revenue: number }

// Per-day Meta spend/revenue for a date range, straight from the Graph API.
// Used to patch the most recent days of BigQuery data, which understate
// spend until Windsor's next daily sync completes.
export async function fetchMetaDaily(since: string, until: string): Promise<MetaDay[] | null> {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const accountId = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');
  if (!token || !accountId) return null;
  try {
    const fields = 'spend,action_values';
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&time_range=${timeRange}&time_increment=1&level=account&access_token=${token}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return null;
    const pick = (arr: Array<{ action_type: string; value: string }> | undefined) =>
      arr?.find(a => a.action_type === 'omni_purchase')?.value ??
      arr?.find(a => a.action_type === 'purchase')?.value;
    return json.data.map((d: { date_start?: string; spend?: string; action_values?: Array<{ action_type: string; value: string }> }) => ({
      date: String(d.date_start || ''),
      spend: parseFloat(d.spend || '0'),
      revenue: parseFloat(pick(d.action_values) || '0'),
    })).filter((d: MetaDay) => d.date);
  } catch {
    return null;
  }
}

export async function fetchMetaToday(): Promise<MetaToday | null> {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const accountId = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');
  if (!token || !accountId) return null;

  try {
    // level=account forces a single aggregated row for the whole account.
    const fields = 'spend,clicks,actions,action_values';
    const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&date_preset=today&level=account&access_token=${token}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json.error || !json.data?.length) return null;

    // Sum all rows in case the API returns more than one (e.g. paged results)
    const pick = (arr: Array<{ action_type: string; value: string }> | undefined) =>
      arr?.find(a => a.action_type === 'omni_purchase')?.value ??
      arr?.find(a => a.action_type === 'purchase')?.value;

    let spend = 0, revenue = 0, purchases = 0, clicks = 0;
    for (const d of json.data) {
      spend += parseFloat(d.spend || '0');
      revenue += parseFloat(pick(d.action_values) || '0');
      purchases += parseInt(pick(d.actions) || '0', 10);
      clicks += parseInt(d.clicks || '0', 10);
    }

    return { spend, revenue, purchases, clicks };
  } catch {
    return null;
  }
}

// Per-ad creative previews straight from the Graph API. Windsor's facebook
// connector returns one shared image_url for most video ads (every card shows
// the same picture), so the ad's own creative thumbnail — and the playable
// video source — must come from Meta. Requests exactly the ad ids the page
// shows (batched ?ids= lookups) instead of paging the whole account, which
// missed the currently-spending ads.
export interface MetaAdMedia { thumbnailUrl?: string; videoUrl?: string; previewUrl?: string }

// Most recent per-video Graph error (e.g. permission message) — surfaced in
// the creatives API response for debugging token/asset issues.
export let lastMetaVideoError: string | null = null;
export async function fetchMetaAdMedia(adIds: string[]): Promise<Record<string, MetaAdMedia> | null> {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!token || adIds.length === 0) return null;
  const ids = Array.from(new Set(adIds.filter(id => /^\d+$/.test(id)))).sort();
  if (ids.length === 0) return null;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  try {
    const media: Record<string, MetaAdMedia> = {};
    const videoToAds = new Map<string, string[]>();

    // previews{body} is Meta's official embeddable ad preview (an iframe that
    // plays the real creative) — it works with ads-scope tokens even when the
    // raw video `source` is gated to the owning Page.
    const fields = 'creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url,video_id},previews.ad_format(MOBILE_FEED_STANDARD){body}';
    await Promise.all(chunks.map(async chunk => {
      const url = `https://graph.facebook.com/v19.0/?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields)}&access_token=${token}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      const json: Record<string, {
        creative?: { thumbnail_url?: string; image_url?: string; video_id?: string };
        previews?: { data?: Array<{ body?: string }> };
      }> & { error?: unknown } = await res.json();
      if (json.error) return;
      for (const id of chunk) {
        const node = json[id];
        if (!node) continue;
        const m: MetaAdMedia = (media[id] = media[id] || {});
        const c = node.creative;
        const thumb = c?.thumbnail_url || c?.image_url || '';
        if (thumb.startsWith('http')) m.thumbnailUrl = thumb;
        const src = /src="([^"]+)"/.exec(node.previews?.data?.[0]?.body || '')?.[1];
        if (src) m.previewUrl = src.replace(/&amp;/g, '&');
        if (c?.video_id) {
          const g = videoToAds.get(c.video_id);
          if (g) g.push(id); else videoToAds.set(c.video_id, [id]);
        }
      }
    }));

    // Playable video sources (and full-size video posters) for video ads.
    // Fetched one video at a time: a batched ?ids= call fails WHOLE if any
    // single video in it is permission-gated, which starved every ad of its
    // videoUrl. Individually, one gated video costs only itself.
    const videoIds = Array.from(videoToAds.keys()).sort();
    await Promise.all(videoIds.map(async vid => {
      try {
        const res = await fetch(`https://graph.facebook.com/v19.0/${vid}?fields=source,picture&access_token=${token}`, { next: { revalidate: 3600 } });
        const v: { source?: string; picture?: string; error?: { message?: string } } = await res.json();
        if (v.error) {
          lastMetaVideoError = String(v.error.message || 'unknown Graph error');
          return;
        }
        for (const adId of videoToAds.get(vid) || []) {
          const m = media[adId] || (media[adId] = {});
          if (v.source?.startsWith('http')) m.videoUrl = v.source;
          if (!m.thumbnailUrl && v.picture?.startsWith('http')) m.thumbnailUrl = v.picture;
        }
      } catch {
        /* single video failed — skip it */
      }
    }));

    return Object.keys(media).length > 0 ? media : null;
  } catch {
    return null;
  }
}
