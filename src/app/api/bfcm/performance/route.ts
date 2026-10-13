import { NextRequest, NextResponse } from 'next/server';
import { bfcmYear, loadBfcmPlan, bfcmPhase } from '@/src/lib/bfcm';
import { getOverview } from '@/src/lib/bqOverview';
import { getAdsOverview } from '@/src/lib/bqAds';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { makeFetcher } from '@/src/lib/analystTools';
import { shiftMonths } from '@/src/lib/timeframes';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Everything the BFCM tab tracks for the sale window, from the dashboard's
// own sources: store totals (Overview definitions), platforms, creatives,
// products, Klaviyo email/SMS. ?year=2026 · ?window=last_year previews last
// year's same dates before this year's sale starts.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get('year')) || bfcmYear();
  const plan = await loadBfcmPlan(year);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const phase = bfcmPhase(plan, today);
  const previewLastYear = sp.get('window') === 'last_year' || phase === 'before';
  const from = previewLastYear ? shiftMonths(plan.earlyAccessFrom && plan.earlyAccessFrom < plan.window.from ? plan.earlyAccessFrom : plan.window.from, 12) : (plan.earlyAccessFrom && plan.earlyAccessFrom < plan.window.from ? plan.earlyAccessFrom : plan.window.from);
  const toRaw = previewLastYear ? shiftMonths(plan.window.to, 12) : plan.window.to;
  const to = toRaw > today ? today : toRaw;
  const pyFrom = shiftMonths(from, 12); const pyTo = shiftMonths(to, 12);
  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const q = `tf=custom&date_from=${from}&date_to=${to}`;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const [ov, pyOv, ads, creatives, products, retention] = await Promise.all([
    isBigQueryConfigured() ? getOverview(from, to).catch(() => null) : Promise.resolve(null),
    isBigQueryConfigured() ? getOverview(pyFrom, pyTo).catch(() => null) : Promise.resolve(null),
    isBigQueryConfigured() ? getAdsOverview(from, to).catch(() => null) : Promise.resolve(null),
    get(`/api/windsor/creatives?${q}`).catch(() => null),
    get(`/api/windsor/products?${q}`).catch(() => null),
    get(`/api/retention?${q}`).catch(() => null),
  ]);
  const m = ov?.metrics; const pm = pyOv?.metrics;
  const store = (x: typeof m) => x ? {
    revenue: num(x.totalRevenue), netSales: num(x.netSales ?? x.totalRevenue), orders: num(x.totalOrders), aov: num(x.aov),
    spend: num(x.netAdSpend ?? x.totalAdSpend), mer: num(x.mer), newCustomers: num(x.newCustomers), returningCustomers: num(x.returningCustomers),
    sessions: num((x as unknown as { humanSessions?: number }).humanSessions), cvr: num(x.conversionRate),
  } : null;
  type Cr = { id: string; name: string; platform: string; thumbnailUrl: string | null; adUrl: string | null; campaign: string; spend: number; revenue: number; roas: number; conversions: number; costPerConversion: number; ctr: number };
  const crs = ((creatives?.creatives as Cr[]) || []).filter(c => c.spend > 0);
  const bySpend = [...crs].sort((a, b) => b.spend - a.spend);
  const significant = bySpend.filter(c => c.spend >= Math.max(50, (bySpend[0]?.spend || 0) * 0.05));
  const best = [...significant].sort((a, b) => b.roas - a.roas).slice(0, 8);
  const worst = [...significant].sort((a, b) => a.roas - b.roas).slice(0, 8).filter(c => !best.some(b => b.id === c.id));
  type Pr = { id: string; name: string; unitsSold: number; revenue: number; percentOfTotal: number };
  const prods = ((products?.products as Pr[]) || []).slice(0, 12);
  type Camp = { id: string; name: string; channel: 'email' | 'sms'; sendTime: string | null; recipients?: number; openRate?: number; clickRate?: number; revenue?: number };
  const recent = ((retention?.recent as Camp[]) || []).filter(c => !c.sendTime || (c.sendTime.slice(0, 10) >= from && c.sendTime.slice(0, 10) <= to));
  const email = recent.filter(c => c.channel === 'email').sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 10);
  const sms = recent.filter(c => c.channel === 'sms').sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 10);
  return NextResponse.json({
    year, phase, previewLastYear, window: { from, to }, priorYearWindow: { from: pyFrom, to: pyTo },
    store: store(m), priorYear: store(pm),
    daily: ov?.revenueData || [],
    platforms: ads?.platforms || [],
    creatives: { best, worst, total: crs.length, error: creatives?.error || null },
    products: prods, productsError: products?.error || null,
    owned: retention ? { overview: retention.overview, flows: retention.flows, email, sms, error: retention.error || retention.statsError || null } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
