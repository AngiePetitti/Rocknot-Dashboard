// Live intraday Snapchat spend via the Snapchat Marketing API — the same
// role metaLive.ts plays for Meta. Windsor's snapchat connector lags hours
// on intraday data; this queries Snap directly.
//
// Env:
//   SNAP_CLIENT_ID / SNAP_CLIENT_SECRET — OAuth app from Snapchat Business Manager
//   SNAP_REFRESH_TOKEN — long-lived token from the one-time /api/debug/snap-oauth flow
//   SNAP_AD_ACCOUNT_ID — the ad account UUID (e.g. cd018406-4f67-...)

const CLIENT_ID = (process.env.SNAP_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SNAP_CLIENT_SECRET || '').trim();
const REFRESH_TOKEN = (process.env.SNAP_REFRESH_TOKEN || '').trim();
const AD_ACCOUNT_ID = (process.env.SNAP_AD_ACCOUNT_ID || '').trim();

export function snapLiveConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && AD_ACCOUNT_ID);
}

// Access tokens last ~30 minutes — cache per warm lambda and refresh early.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const res = await fetch('https://accounts.snapchat.com/login/oauth2/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Snap token refresh failed: ${json.error_description || json.error || res.status}`);
  }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + 20 * 60 * 1000 };
  return json.access_token;
}

// Store-time (PST/PDT) day boundaries with the correct UTC offset — Snap
// requires start/end times aligned to the ad account's timezone day.
function laDayBounds(): { start: string; end: string } {
  const now = new Date();
  const laDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  // Offset in ±HH:MM for America/Los_Angeles right now (handles DST).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).formatToParts(now);
  const gmt = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-08:00'; // e.g. "GMT-07:00"
  const offset = gmt.replace('GMT', '') || '-08:00';
  const [y, m, d] = laDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return { start: `${laDate}T00:00:00.000${offset}`, end: `${nextStr}T00:00:00.000${offset}` };
}

export interface SnapToday { spend: number; revenue: number; purchases: number }

// Recursively find the first "stats" object in Snap's nested response
// ({timeseries_stats|total_stats: [{timeseries_stat|total_stat: {timeseries: [{stats}], stats}}]}).
function findStats(node: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.stats && typeof o.stats === 'object' && !Array.isArray(o.stats)) out.push(o.stats as Record<string, unknown>);
      for (const k of Object.keys(o)) if (k !== 'stats') walk(o[k]);
    }
  };
  walk(node);
  return out;
}

export interface SnapDay { date: string; spend: number; revenue: number }

function laOffset(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).formatToParts(new Date());
  return (parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-08:00').replace('GMT', '') || '-08:00';
}

// Per-day Snap spend/purchase value for a date range (inclusive), used to
// patch the most recent days of Windsor/BigQuery data.
export async function fetchSnapDaily(since: string, until: string): Promise<SnapDay[] | null> {
  if (!snapLiveConfigured()) return null;
  try {
    const token = await getAccessToken();
    const offset = laOffset();
    const [y, m, d] = until.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    const qs = new URLSearchParams({
      granularity: 'DAY',
      fields: 'spend,conversion_purchases_value',
      start_time: `${since}T00:00:00.000${offset}`,
      end_time: `${end}T00:00:00.000${offset}`,
    });
    const res = await fetch(`https://adsapi.snapchat.com/v1/adaccounts/${AD_ACCOUNT_ID}/stats?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) return null;
    // Collect {start_time, stats} entries anywhere in the nested response.
    const out: SnapDay[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.start_time === 'string' && o.stats && typeof o.stats === 'object') {
          const s = o.stats as Record<string, unknown>;
          out.push({
            date: o.start_time.slice(0, 10),
            spend: Math.round((Number(s.spend || 0) / 1_000_000) * 100) / 100,
            revenue: Math.round((Number(s.conversion_purchases_value || 0) / 1_000_000) * 100) / 100,
          });
        }
        for (const k of Object.keys(o)) walk(o[k]);
      }
    };
    walk(json);
    return out;
  } catch {
    return null;
  }
}

export async function fetchSnapToday(): Promise<SnapToday | null> {
  if (!snapLiveConfigured()) return null;
  try {
    const token = await getAccessToken();
    const { start, end } = laDayBounds();
    const qs = new URLSearchParams({
      granularity: 'DAY',
      fields: 'spend,conversion_purchases,conversion_purchases_value',
      start_time: start,
      end_time: end,
    });
    const res = await fetch(`https://adsapi.snapchat.com/v1/adaccounts/${AD_ACCOUNT_ID}/stats?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Snap stats ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    const statsBlocks = findStats(json);
    let spendMicro = 0, revMicro = 0, purchases = 0;
    for (const s of statsBlocks) {
      spendMicro += Number(s.spend || 0);
      revMicro += Number(s.conversion_purchases_value || 0);
      purchases += Number(s.conversion_purchases || 0);
    }
    // Snap reports money in micro-currency (millionths of a dollar).
    return {
      spend: Math.round((spendMicro / 1_000_000) * 100) / 100,
      revenue: Math.round((revMicro / 1_000_000) * 100) / 100,
      purchases,
    };
  } catch {
    return null; // live overlay is best-effort — Windsor data still shows
  }
}
