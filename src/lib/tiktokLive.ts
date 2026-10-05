// Per-day spend/revenue straight from Windsor's live connector API for
// platforms without (or awaiting) a direct API hookup. The BigQuery tables
// only update on Windsor's daily sync, so the most recent days understate
// spend badly — the connector endpoint is fresher.
import { windsorParams, getClient } from '@/src/lib/client';

export interface PlatformDay {
  date: string;
  spend: number;
  revenue: number;
  /** Platform-reported purchases for the day, when the connector exposes them. */
  conversions?: number;
  /** Pinterest only: the view-through share of conversions / revenue. */
  viewConversions?: number;
  viewRevenue?: number;
  clicks?: number;
  impressions?: number;
}

async function fetchWindsorDaily(
  source: 'tiktok' | 'snapchat' | 'google_ads' | 'pinterest',
  revenueFields: string[],
  since: string,
  until: string
): Promise<PlatformDay[] | null> {
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  if (!key) return null;
  // Scope to this client's account in the shared Windsor workspace; skip
  // entirely when the client has no account of this type.
  const scoped = windsorParams(source, { date_from: since, date_to: until });
  if (!scoped) return null;
  const attempt = async (fields: string[]): Promise<PlatformDay[] | null> => {
    const qs = new URLSearchParams({
      api_key: key,
      ...scoped,
      fields: fields.join(','),
      _renderer: 'json',
    });
    // Hard timeout: this runs inside the main metrics request — a slow Windsor
    // response must degrade to "no patch", never hang the whole dashboard.
    // Cached 10 min: Windsor itself refreshes hourly at best, so re-fetching
    // this on every dashboard load was pure added latency.
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return null;
    const byDate = new Map<string, PlatformDay>();
    for (const row of json.data as Array<Record<string, unknown>>) {
      const date = String(row.date || '');
      if (!date) continue;
      const d = byDate.get(date) || { date, spend: 0, revenue: 0 };
      d.spend += Number(row.spend || 0);
      d.revenue += revenueFields.reduce((s, f) => s || Number(row[f] || 0), 0);
      byDate.set(date, d);
    }
    return Array.from(byDate.values());
  };
  try {
    // A revenue field the connector doesn't recognize fails the WHOLE request
    // (this zeroed Google spend for a week) — retry with date+spend only:
    // patched spend without revenue beats no patch at all.
    return (await attempt(['date', 'spend', ...revenueFields]))
      ?? (revenueFields.length ? await attempt(['date', 'spend']) : null);
  } catch {
    try {
      return revenueFields.length ? await attempt(['date', 'spend']) : null;
    } catch {
      return null;
    }
  }
}

export function fetchTiktokDaily(since: string, until: string): Promise<PlatformDay[] | null> {
  return fetchWindsorDaily('tiktok', ['total_complete_payment_rate', 'complete_payment_value'], since, until);
}

// Fallback for Snapchat when the direct Snap Marketing API creds aren't set.
export function fetchSnapDailyFromWindsor(since: string, until: string): Promise<PlatformDay[] | null> {
  return fetchWindsorDaily('snapchat', ['conversion_purchases_value'], since, until);
}

// Google via Windsor REST — Google has no direct-API hookup (dev-token
// approval), and its BigQuery sync trails the REST endpoint enough to trip
// the reconcile banner. The REST totals ARE the reconcile reference, so
// patching from them keeps dashboard and reference aligned by construction.
export function fetchGoogleDailyFromWindsor(since: string, until: string): Promise<PlatformDay[] | null> {
  return fetchWindsorDaily('google_ads', ['conversions_value', 'conversion_value'], since, until);
}

// Pinterest via Windsor REST (no direct Pinterest Ads API hookup).
//
// Windsor's REST endpoint reports Pinterest conversions on whatever
// attribution window its API defaults to (30/30/1 — the URL parameters are
// ignored), while the BigQuery task carries the window set in the task's
// "Attribution Window" dropdown. The two can disagree, so this feed is used
// for SPEND only (identical on any window); checkouts and checkout value
// stay on the BigQuery copy, which the task refreshes hourly. The view
// split is still fetched for the audit endpoint.
export const PINTEREST_REVENUE_FIELDS = ['total_checkout_value', 'total_conversions_value', 'conversion_value'];
export const PINTEREST_CONVERSION_FIELDS = ['total_checkout', 'total_conversions', 'conversions'];
// Label for the Windsor/BigQuery path. Assumes the BigQuery task's
// Attribution Window + Conversion Report Time are set to the profile's
// values (the task's dropdowns, not the URL — see above).
export function pinterestWindsorNote(): string {
  const a = getClient().ads.pinterestAttribution ?? { clickWindowDays: 7, engagementWindowDays: 7, viewWindowDays: 1, conversionReportTime: 'TIME_OF_AD_ACTION' };
  const when = a.conversionReportTime === 'TIME_OF_CONVERSION' ? 'by conversion date' : 'by ad date';
  return `Pinterest checkouts · ${a.clickWindowDays}-day click · ${a.engagementWindowDays}-day engagement · ${a.viewWindowDays}-day view, ${when} — Windsor sync (hourly), same conversion settings as Ads Manager`;
}
export const PINTEREST_ATTRIBUTION_NOTE = 'Pinterest checkouts (Windsor sync)';
export async function fetchPinterestDailyFromWindsor(since: string, until: string): Promise<PlatformDay[] | null> {
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  if (!key) return null;
  const scoped = windsorParams('pinterest', { date_from: since, date_to: until });
  if (!scoped) return null;
  try {
    const qs = new URLSearchParams({
      api_key: key,
      ...scoped,
      fields: 'date,spend,total_checkout,total_checkout_value,total_view_checkout,total_view_checkout_value',
      _renderer: 'json',
    });
    const res = await fetch(`https://connectors.windsor.ai/pinterest?${qs}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (!json.error && Array.isArray(json.data)) {
      const byDate = new Map<string, PlatformDay>();
      for (const row of json.data as Array<Record<string, unknown>>) {
        const date = String(row.date || '');
        if (!date) continue;
        const d = byDate.get(date) || { date, spend: 0, revenue: 0, conversions: 0, viewConversions: 0, viewRevenue: 0 };
        d.spend += Number(row.spend || 0);
        d.revenue += Number(row.total_checkout_value || 0);
        d.conversions = (d.conversions || 0) + Number(row.total_checkout || 0);
        d.viewConversions = (d.viewConversions || 0) + Number(row.total_view_checkout || 0);
        d.viewRevenue = (d.viewRevenue || 0) + Number(row.total_view_checkout_value || 0);
        byDate.set(date, d);
      }
      return Array.from(byDate.values());
    }
  } catch {
    // fall through to the generic fetch
  }
  // Field names drift between Windsor connector versions — fall back to the
  // generic first-field-that-works fetch (spend + revenue only).
  return fetchWindsorDaily('pinterest', PINTEREST_REVENUE_FIELDS, since, until);
}

export interface PinterestLiveResult {
  days: PlatformDay[];
  /**
   * true = straight from the Pinterest Ads API on Ads Manager's conversion
   * settings: these days REPLACE the synced copy outright. false = Windsor's
   * feed (Pinterest's 30-day defaults): only fills in where it's fresher.
   */
  authoritative: boolean;
  label: string;
}

// Pinterest, best available source: the Pinterest Ads API when connected
// (exact Ads Manager numbers), otherwise Windsor's live feed.
export async function fetchPinterestDailyLive(since: string, until: string): Promise<PinterestLiveResult | null> {
  try {
    const { fetchPinterestDaily, pinterestAttributionLabel } = await import('@/src/lib/pinterestLive');
    const direct = await fetchPinterestDaily(since, until);
    if (direct) return { days: direct, authoritative: true, label: pinterestAttributionLabel() };
  } catch {
    // fall through to Windsor
  }
  const windsor = await fetchPinterestDailyFromWindsor(since, until);
  return windsor ? { days: windsor, authoritative: false, label: pinterestWindsorNote() } : null;
}
