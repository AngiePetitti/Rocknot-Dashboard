import { NextRequest, NextResponse } from 'next/server';
import { getPinterestAccessToken, pinterestConnectionStatus } from '@/src/lib/pinterestAuth';
import { fetchPinterestAccountRaw, fetchPinterestDaily, pinterestAccountIds, pinterestAttribution, pinterestAttributionLabel } from '@/src/lib/pinterestLive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only match check (/api/debug/pinterest-api?days=7 or ?from=&to=):
// what the Pinterest Ads API returns for the range on Ads Manager's
// conversion settings, per account and summed, plus the raw first rows —
// to line up against the Pinterest dashboard for the same dates.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(90, Number(sp.get('days') || 7)));
  // Default = Ads Manager's "Last 7 days": the 7 full days ending yesterday.
  const from = sp.get('from') || new Date(Date.parse(`${yesterday}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const to = sp.get('to') || yesterday;
  const out: Record<string, unknown> = {
    range: { from, to },
    attribution: pinterestAttribution(),
    label: pinterestAttributionLabel(),
    status: await pinterestConnectionStatus(),
    accounts: pinterestAccountIds(),
  };
  const token = await getPinterestAccessToken();
  if (!token) {
    out.error = 'No Pinterest access token — connect via /api/debug/pinterest-oauth';
    return NextResponse.json(out);
  }
  const perAccount: Record<string, unknown> = {};
  for (const id of pinterestAccountIds()) {
    const r = await fetchPinterestAccountRaw(token, id, from, to,
      ['SPEND_IN_DOLLAR', 'TOTAL_CHECKOUT', 'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR', 'TOTAL_CLICK_CHECKOUT', 'TOTAL_ENGAGEMENT_CHECKOUT', 'TOTAL_VIEW_CHECKOUT', 'CHECKOUT_ROAS', 'IMPRESSION_1', 'CLICKTHROUGH_1'],
      'TOTAL').catch(e => ({ ok: false, status: 0, body: String(e) }));
    perAccount[id] = { status: r.status, body: Array.isArray(r.body) ? r.body : r.body };
  }
  out.perAccountTotals = perAccount;
  const daily = await fetchPinterestDaily(from, to).catch(e => ({ error: String(e) }));
  if (Array.isArray(daily)) {
    const sum = daily.reduce((s, d) => ({
      spend: s.spend + d.spend, conversions: s.conversions + d.conversions, revenue: s.revenue + d.revenue,
      viewConversions: s.viewConversions + d.viewConversions, clicks: s.clicks + d.clicks, impressions: s.impressions + d.impressions,
    }), { spend: 0, conversions: 0, revenue: 0, viewConversions: 0, clicks: 0, impressions: 0 });
    out.dashboardBasis = {
      ...sum,
      spend: Math.round(sum.spend * 100) / 100,
      revenue: Math.round(sum.revenue * 100) / 100,
      roas: sum.spend > 0 ? Math.round((sum.revenue / sum.spend) * 100) / 100 : 0,
      costPerCheckout: sum.conversions > 0 ? Math.round((sum.spend / sum.conversions) * 100) / 100 : 0,
    };
    out.daily = daily;
  } else {
    out.daily = daily;
  }
  return NextResponse.json(out);
}
