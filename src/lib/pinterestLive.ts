// Pinterest numbers straight from the Pinterest Ads API — the same source
// Ads Manager reads — with the SAME conversion settings as the account's
// Ads Manager view (click / engagement / view windows and the report-time
// basis), so the dashboard's Pinterest row equals the Pinterest dashboard.
// Windsor's copy can't do this: its API ignores the window parameters and
// reports on Pinterest's 30-day defaults, which is where the mismatch came
// from.
import { getClient } from '@/src/lib/client';
import { getPinterestAccessToken, pinterestDirectConfigured } from '@/src/lib/pinterestAuth';

export interface PinterestAttribution {
  clickWindowDays: 1 | 7 | 30;
  engagementWindowDays: 1 | 7 | 30;
  viewWindowDays: 1 | 7 | 30;
  conversionReportTime: 'TIME_OF_AD_ACTION' | 'TIME_OF_CONVERSION';
}

// Kailee's Ads Manager conversion settings (Oct 2026): 7-day click,
// 7-day engagement, 1-day view, reported on the ad-event date.
export const DEFAULT_PINTEREST_ATTRIBUTION: PinterestAttribution = {
  clickWindowDays: 7,
  engagementWindowDays: 7,
  viewWindowDays: 1,
  conversionReportTime: 'TIME_OF_AD_ACTION',
};

export function pinterestAttribution(): PinterestAttribution {
  return getClient().ads.pinterestAttribution ?? DEFAULT_PINTEREST_ATTRIBUTION;
}

export function pinterestAttributionLabel(): string {
  const a = pinterestAttribution();
  const when = a.conversionReportTime === 'TIME_OF_CONVERSION' ? 'by conversion date' : 'by ad date';
  return `Pinterest Ads API · ${a.clickWindowDays}-day click · ${a.engagementWindowDays}-day engagement · ${a.viewWindowDays}-day view, ${when} — same conversion settings as Ads Manager`;
}

export interface PinterestDay {
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  viewConversions: number;
  viewRevenue: number;
}

export function pinterestAccountIds(): string[] {
  const raw = getClient().windsor.accounts.pinterest || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Pinterest's analytics endpoint only reaches back 90 days and serves at most
// 90 days per call; anything older stays on the BigQuery copy.
const MAX_LOOKBACK_DAYS = 89;

const COLUMNS = ['SPEND_IN_DOLLAR', 'TOTAL_CHECKOUT', 'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
  'TOTAL_VIEW_CHECKOUT', 'TOTAL_VIEW_CHECKOUT_VALUE_IN_MICRO_DOLLAR', 'IMPRESSION_1', 'CLICKTHROUGH_1'];
const COLUMNS_MIN = ['SPEND_IN_DOLLAR', 'TOTAL_CHECKOUT', 'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR'];

export async function fetchPinterestAccountRaw(
  token: string, accountId: string, since: string, until: string, columns: string[], granularity: 'DAY' | 'TOTAL' = 'DAY',
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const a = pinterestAttribution();
  const qs = new URLSearchParams({
    start_date: since,
    end_date: until,
    columns: columns.join(','),
    granularity,
    click_window_days: String(a.clickWindowDays),
    engagement_window_days: String(a.engagementWindowDays),
    view_window_days: String(a.viewWindowDays),
    conversion_report_time: a.conversionReportTime,
  });
  const res = await fetch(`https://api.pinterest.com/v5/ad_accounts/${accountId}/analytics?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    // 5-min cache: Pinterest's own reporting refreshes on roughly that cadence.
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(12000),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

function num(v: unknown): number { return Number(v || 0) || 0; }

/**
 * Per-day Pinterest spend / checkouts / checkout value for the range, summed
 * over the client's ad accounts, on Ads Manager's conversion settings.
 * Returns null when the direct API isn't connected or every call failed,
 * so callers fall back to Windsor / BigQuery.
 */
export async function fetchPinterestDaily(since: string, until: string): Promise<PinterestDay[] | null> {
  if (!pinterestDirectConfigured()) return null;
  const accounts = pinterestAccountIds();
  if (!accounts.length) return null;
  const token = await getPinterestAccessToken();
  if (!token) return null;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const earliest = new Date(Date.parse(`${today}T12:00:00Z`) - MAX_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const from = since < earliest ? earliest : since;
  const to = until > today ? today : until;
  if (from > to) return null;

  const byDate = new Map<string, PinterestDay>();
  let anyOk = false;
  for (const accountId of accounts) {
    let r = await fetchPinterestAccountRaw(token, accountId, from, to, COLUMNS);
    if (!r.ok && r.status === 400) r = await fetchPinterestAccountRaw(token, accountId, from, to, COLUMNS_MIN);
    if (!r.ok || !Array.isArray(r.body)) continue;
    anyOk = true;
    for (const row of r.body as Array<Record<string, unknown>>) {
      const date = String(row.DATE || '').slice(0, 10);
      if (!date) continue;
      const d = byDate.get(date) || { date, spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, viewConversions: 0, viewRevenue: 0 };
      d.spend += num(row.SPEND_IN_DOLLAR);
      d.conversions += num(row.TOTAL_CHECKOUT);
      d.revenue += num(row.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR) / 1e6;
      d.clicks += num(row.CLICKTHROUGH_1);
      d.impressions += num(row.IMPRESSION_1);
      d.viewConversions += num(row.TOTAL_VIEW_CHECKOUT);
      d.viewRevenue += num(row.TOTAL_VIEW_CHECKOUT_VALUE_IN_MICRO_DOLLAR) / 1e6;
      byDate.set(date, d);
    }
  }
  if (!anyOk) return null;
  return Array.from(byDate.values()).sort((x, y) => x.date.localeCompare(y.date));
}
