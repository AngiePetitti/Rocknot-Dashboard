import { NextRequest, NextResponse } from 'next/server';
import { bfcmYear, loadBfcmPlan, bfcmPhase, detectSaleWindow, addDays } from '@/src/lib/bfcm';
import { getOverview, fetchShopifyDaily, freshShopifyDays } from '@/src/lib/bqOverview';
import { getAdsOverview } from '@/src/lib/bqAds';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { makeFetcher } from '@/src/lib/analystTools';
import { shiftMonths } from '@/src/lib/timeframes';
import { merBasis } from '@/src/lib/client';

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
  const thisFrom = plan.earlyAccessFrom && plan.earlyAccessFrom < plan.window.from ? plan.earlyAccessFrom : plan.window.from;
  // Last year's baseline is last year's ACTUAL sale (set on the plan or
  // detected from the revenue lift), not this year's dates shifted back —
  // brands run sales of different lengths from one year to the next.
  const daily = await fetchShopifyDaily(`${year - 1}-10-20`, `${year - 1}-12-12`).catch(() => []);
  const detected = detectSaleWindow(daily.map(d => ({ date: d.date, revenue: d.totalSales || d.netSales || 0 })), year - 1);
  const ly = plan.lastYear || (detected ? { from: detected.from, to: detected.to, source: 'detected' as const } : { from: shiftMonths(thisFrom, 12), to: shiftMonths(plan.window.to, 12), source: 'default' as const });
  const from = previewLastYear ? ly.from : thisFrom;
  const toRaw = previewLastYear ? ly.to : plan.window.to;
  const to = toRaw > today ? today : toRaw;
  const pyFrom = ly.from; const pyTo = ly.to;
  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const q = `tf=custom&date_from=${from}&date_to=${to}`;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const ea = plan.lastYear?.earlyAccess;
  // Store totals per window: BigQuery overview where the client has it
  // (Rocknot, Kailee P); otherwise the Overview's direct path (Skimpies:
  // Shopify + Meta live), so the tab works on every dashboard.
  type Ov = Awaited<ReturnType<typeof getOverview>>;
  const overviewFor = (f: string, t: string): Promise<Ov | null> => isBigQueryConfigured()
    ? getOverview(f, t).catch(() => null)
    : get(`/api/windsor?tf=custom&date_from=${f}&date_to=${t}`)
        .then(r => (r && r.metrics ? { metrics: r.metrics, revenueData: r.revenueData || [], revenueSource: 'shopify', shopifySource: 'direct' } as unknown as Ov : null))
        .catch(() => null);
  // "vs last year" compares the same point of last year's sale, not last
  // year's whole sale against a sale still in progress: last year's early
  // access (when this year's window includes early access) plus last year's
  // public sale days 1..N, N = public sale days elapsed this year.
  const dayCount = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  const publicDays = !previewLastYear && to >= plan.window.from ? dayCount(plan.window.from, to) : 0;
  const pyToDateTo = publicDays > 0 ? (addDays(ly.from, publicDays - 1) < ly.to ? addDays(ly.from, publicDays - 1) : ly.to) : null;
  const eaInBaseline = !previewLastYear && !!ea && thisFrom < plan.window.from;
  const [ov, pyOv, eaOv, pyToDateOv, ads, creatives, products, retention] = await Promise.all([
    overviewFor(from, to),
    overviewFor(pyFrom, pyTo),
    ea ? overviewFor(ea.from, ea.to) : Promise.resolve(null),
    pyToDateTo && pyToDateTo !== pyTo ? overviewFor(pyFrom, pyToDateTo) : Promise.resolve(null),
    isBigQueryConfigured() ? getAdsOverview(from, to).catch(() => null) : Promise.resolve(null),
    get(`/api/windsor/creatives?${q}`).catch(() => null),
    get(`/api/windsor/products?${q}`).catch(() => null),
    get(`/api/retention?${q}`).catch(() => null),
  ]);
  // Day by day from Shopify itself, not the once-a-day synced copy (asked
  // again now that the queries above have released Shopify's rate limit).
  const days = await freshShopifyDays(from, to, ov?.revenueData || [], ov?.shopifySource).catch(() => ({ daily: ov?.revenueData || [], source: 'synced' as const, error: undefined }));
  // The ad spend goal counts from the public sale start (Black Friday), not
  // from early access, per Angie; revenue keeps counting from early access.
  const spendGoalFrom = previewLastYear ? ly.from : (plan.adSpendFrom || plan.window.from);
  const goalSpendSoFar = days.daily.filter(d => d.date >= spendGoalFrom).reduce((t, d) => t + (d.adSpend || 0), 0);
  // MER goal progress: revenue (gross − discounts) ÷ ad spend over the same
  // days the ad spend goal counts, so both sides cover one window.
  const merRevenue = days.daily.filter(d => d.date >= spendGoalFrom).reduce((t, d) => t + (d.grossLessDiscounts || 0), 0);
  const m = ov?.metrics; const pm = pyOv?.metrics;
  type Store = { revenue: number; totalSales: number; netSales: number; orders: number; aov: number; spend: number; mer: number; newCustomers: number; returningCustomers: number; sessions: number; cvr: number };
  const store = (x: typeof m): Store | null => x ? {
    // Revenue on this tab is gross sales minus discounts (before returns), per Angie.
    revenue: num(x.grossLessDiscounts) || num(x.totalRevenue), totalSales: num(x.totalSales ?? x.totalRevenue), netSales: num(x.netSales ?? x.totalRevenue), orders: num(x.totalOrders), aov: num(x.aov),
    spend: num(x.netAdSpend ?? x.totalAdSpend), mer: num(x.mer), newCustomers: num(x.newCustomers), returningCustomers: num(x.returningCustomers),
    sessions: num((x as unknown as { humanSessions?: number }).humanSessions), cvr: num(x.conversionRate),
  } : null;
  // The cards add up the same fresh day-by-day numbers as the table, so they
  // never lag behind it (the store totals above can come from the once-a-day
  // synced copy, which misses the latest orders).
  const thisStore = store(m);
  if (thisStore && days.daily.length && days.source !== 'synced') {
    const sum = (f: (d: typeof days.daily[number]) => number) => days.daily.reduce((t, d) => t + (f(d) || 0), 0);
    const revenue = sum(d => d.grossLessDiscounts || 0); const orders = sum(d => d.orders); const spend = sum(d => d.adSpend);
    const netSales = sum(d => d.netSales ?? 0);
    const merSales = merBasis() === 'gross_less_discounts' ? revenue : netSales;
    Object.assign(thisStore, {
      revenue: Math.round(revenue), netSales: Math.round(netSales), orders, spend: Math.round(spend),
      aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
      mer: spend > 0 ? Math.round((merSales / spend) * 100) / 100 : 0,
    });
  }
  // Sum of store totals over several windows (early access + public days).
  const combine = (parts: Array<Store | null>): Store | null => {
    const ps = parts.filter((p): p is Store => !!p);
    if (!ps.length) return null;
    const t = (k: keyof Store) => ps.reduce((a, p) => a + (p[k] || 0), 0);
    const revenue = t('revenue'), orders = t('orders'), spend = t('spend'), netSales = t('netSales'), sessions = t('sessions');
    const merSales = merBasis() === 'gross_less_discounts' ? revenue : netSales;
    return {
      revenue, totalSales: t('totalSales'), netSales, orders, spend, sessions,
      newCustomers: t('newCustomers'), returningCustomers: t('returningCustomers'),
      aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
      mer: spend > 0 ? Math.round((merSales / spend) * 100) / 100 : 0,
      cvr: sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : 0,
    };
  };
  const eaStore = eaOv ? store(eaOv.metrics) : null;
  const pyPublicToDate = pyToDateTo ? (pyToDateTo === pyTo ? store(pm) : (pyToDateOv ? store(pyToDateOv.metrics) : null)) : null;
  const priorYearToDate = previewLastYear ? null : combine([eaInBaseline ? eaStore : null, pyPublicToDate]);
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
    year, phase, previewLastYear, window: { from, to }, priorYearWindow: { from: pyFrom, to: pyTo, source: ly.source }, detectedLastYear: detected,
    store: thisStore, priorYear: store(pm),
    priorYearEarlyAccess: ea && eaStore ? { window: ea, ...eaStore } : null,
    // The "vs last year" baseline: same point of last year's sale.
    priorYearToDate: priorYearToDate ? {
      earlyAccess: eaInBaseline ? ea : null,
      publicWindow: pyToDateTo ? { from: pyFrom, to: pyToDateTo } : null,
      publicDays, ...priorYearToDate,
    } : null,
    // Each day: revenue = gross − discounts; MER on the client's MER basis.
    daily: days.daily.map(d => {
      const revenue = d.grossLessDiscounts || 0;
      const merSales = merBasis() === 'gross_less_discounts' ? revenue : (d.netSales ?? 0);
      return { date: d.date, revenue, totalSales: d.revenue, netSales: d.netSales, orders: d.orders, adSpend: d.adSpend, mer: d.adSpend > 0 ? merSales / d.adSpend : 0 };
    }),
    dailySource: days.source, merBasis: merBasis(),
    adSpendGoal: { from: spendGoalFrom, spend: Math.round(goalSpendSoFar) },
    merGoal: { from: spendGoalFrom, revenue: Math.round(merRevenue), spend: Math.round(goalSpendSoFar), mer: goalSpendSoFar > 0 ? Math.round((merRevenue / goalSpendSoFar) * 100) / 100 : 0 },
    platforms: ads?.platforms || [],
    creatives: { best, worst, total: crs.length, error: creatives?.error || null },
    products: prods, productsError: products?.error || null,
    owned: retention ? { overview: retention.overview, flows: retention.flows, email, sms, error: retention.error || retention.statsError || null } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
