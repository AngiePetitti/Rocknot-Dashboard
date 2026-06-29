// Self-check that the dashboard's ad spend matches the source of truth.
//
// The June 2026 incident: a "fix" silently changed Meta spend aggregation and
// undercounted spend for days before anyone noticed by eyeballing Ads Manager.
// This module compares the dashboard's BigQuery-derived spend against
// INDEPENDENT sources so any divergence (dedup mistakes, missing adsets, date
// offsets, broken account filters, Windsor schema drift) is caught automatically:
//
//   - Meta: the Meta Graph API — the exact source Ads Manager reads. Strongest.
//   - Meta/Google/TikTok: the Windsor REST API totals — a code path fully
//     independent of our BigQuery SQL, so an aggregation bug in one won't hide
//     in the other (this alone would have caught the June dedup regression).
//
// Reconciliation runs over a window of COMPLETE past days (ending yesterday) to
// avoid false alarms from today's partial spend and BigQuery's ~1h sync lag.

import { getAdsOverview } from '@/src/lib/bqAds';

const META_TOKEN = (process.env.META_ACCESS_TOKEN || '').trim();
const META_ACCOUNT_ID = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');
const WINDSOR_API_KEY = (process.env.WINDSOR_API_KEY || '').trim();
const ROCKNOT_META_ACCOUNT_ID = META_ACCOUNT_ID;

export type ReconcileStatus = 'ok' | 'warn' | 'unavailable';

export interface PlatformReconcile {
  platform: 'Meta' | 'Google' | 'TikTok';
  dashboardSpend: number;            // what the dashboard shows (BigQuery)
  referenceSpend: number | null;     // independent ground truth
  referenceSource: string;           // where the reference came from
  diff: number | null;               // dashboard - reference
  diffPct: number | null;            // diff / reference * 100
  status: ReconcileStatus;
}

export interface ReconcileResult {
  range: { from: string; to: string };
  thresholdPct: number;
  thresholdDollars: number;
  allOk: boolean;
  platforms: PlatformReconcile[];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Meta Graph API account-level spend for a date range — the Ads Manager number.
async function fetchMetaApiSpend(from: string, to: string): Promise<number | null> {
  if (!META_TOKEN || !META_ACCOUNT_ID) return null;
  try {
    const timeRange = JSON.stringify({ since: from, until: to });
    const url = `https://graph.facebook.com/v19.0/act_${META_ACCOUNT_ID}/insights`
      + `?fields=spend&level=account&time_range=${encodeURIComponent(timeRange)}`
      + `&access_token=${META_TOKEN}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return null;
    return json.data.reduce((s: number, d: { spend?: string }) => s + parseFloat(d.spend || '0'), 0);
  } catch {
    return null;
  }
}

// Windsor REST API spend total for a range — an aggregation path independent of
// our BigQuery SQL. For Meta, filter to the Rocknot account_id.
async function fetchWindsorSpend(source: 'facebook' | 'google_ads' | 'tiktok', from: string, to: string): Promise<number | null> {
  if (!WINDSOR_API_KEY) return null;
  try {
    const fields = source === 'facebook' ? 'account_id,source,spend' : 'source,spend';
    const qs = new URLSearchParams({
      api_key: WINDSOR_API_KEY, fields, _renderer: 'json',
      date_from: from, date_to: to,
    });
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    let rows = (json.data || []) as Array<{ account_id?: string; spend?: number | string }>;
    if (source === 'facebook') {
      rows = rows.filter(r => String(r.account_id ?? '').replace('act_', '') === ROCKNOT_META_ACCOUNT_ID);
    }
    return rows.reduce((s, r) => s + Number(r.spend || 0), 0);
  } catch {
    return null;
  }
}

function compare(
  platform: PlatformReconcile['platform'],
  dashboardSpend: number,
  referenceSpend: number | null,
  referenceSource: string,
  thresholdPct: number,
  thresholdDollars: number,
): PlatformReconcile {
  if (referenceSpend === null) {
    return { platform, dashboardSpend, referenceSpend: null, referenceSource, diff: null, diffPct: null, status: 'unavailable' };
  }
  const diff = Math.round((dashboardSpend - referenceSpend) * 100) / 100;
  const diffPct = referenceSpend > 0 ? Math.round((diff / referenceSpend) * 1000) / 10 : (diff === 0 ? 0 : 100);
  const within = Math.abs(diff) <= thresholdDollars || Math.abs(diffPct) <= thresholdPct;
  return { platform, dashboardSpend, referenceSpend: Math.round(referenceSpend * 100) / 100, referenceSource, diff, diffPct, status: within ? 'ok' : 'warn' };
}

// Reconcile a trailing window of complete days (default: the 7 days ending
// yesterday). `from`/`to` override the window for ad-hoc checks.
export async function reconcileAdSpend(opts?: { from?: string; to?: string; days?: number }): Promise<ReconcileResult> {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterday = addDays(todayStr, -1);
  const days = opts?.days ?? 7;
  const to = opts?.to ?? yesterday;
  const from = opts?.from ?? addDays(to, -(days - 1));

  const thresholdPct = 1;       // 1% tolerance for rounding / minor attribution lag
  const thresholdDollars = 50;  // ignore sub-$50 absolute noise on small windows

  // Dashboard (BigQuery) spend per platform.
  const ads = await getAdsOverview(from, to).catch(() => ({ platforms: [] as Array<{ platform: string; spend: number }>, dailySpend: [] }));
  const dashSpend = (p: string) => ads.platforms.find(x => x.platform === p)?.spend ?? 0;

  const [metaApi, metaWindsor, googleWindsor, tiktokWindsor] = await Promise.all([
    fetchMetaApiSpend(from, to),
    fetchWindsorSpend('facebook', from, to),
    fetchWindsorSpend('google_ads', from, to),
    fetchWindsorSpend('tiktok', from, to),
  ]);

  const platforms: PlatformReconcile[] = [
    // Prefer the Meta Graph API (true ground truth); fall back to Windsor REST.
    compare('Meta', dashSpend('Meta'),
      metaApi ?? metaWindsor,
      metaApi !== null ? 'Meta Graph API (Ads Manager)' : 'Windsor REST',
      thresholdPct, thresholdDollars),
    compare('Google', dashSpend('Google'), googleWindsor, 'Windsor REST', thresholdPct, thresholdDollars),
    compare('TikTok', dashSpend('TikTok'), tiktokWindsor, 'Windsor REST', thresholdPct, thresholdDollars),
  ];

  return {
    range: { from, to },
    thresholdPct,
    thresholdDollars,
    allOk: platforms.every(p => p.status !== 'warn'),
    platforms,
  };
}
