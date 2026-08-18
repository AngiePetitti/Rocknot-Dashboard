import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDSOR_API_KEY = (process.env.WINDSOR_API_KEY || '').trim();

// Profitability data for the Overview's net-profit card.
// For the requested range it returns:
//  - actual: QB net income summed over the days of the range that fall in
//    BOOKED months (QB income ≥ 60% of Shopify sales for that month), plus
//    the Shopify revenue and ad spend of those same days so the caller can
//    estimate only the unbooked remainder.
//  - cogsPct / nonAdOpexPct: cost rates from the most recent booked months,
//    for estimating the remainder.
// Admin-only, like everything financial.
export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  if (!WINDSOR_API_KEY) return NextResponse.json({ error: 'Windsor not configured' }, { status: 500 });

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const [y, m] = today.split('-').map(Number);
    // Resolve the range: explicit dates win; otherwise the tf preset (same
    // presets the Overview uses); default MTD.
    const tf = req.nextUrl.searchParams.get('tf') || 'mtd';
    const addDays = (d: string, n: number) => {
      const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n);
      return t.toLocaleDateString('en-CA');
    };
    const preset = ((): { from: string; to: string } => {
      if (tf === 'today') return { from: today, to: today };
      if (tf === 'yesterday') { const d = addDays(today, -1); return { from: d, to: d }; }
      if (tf === '7d') return { from: addDays(today, -7), to: today };
      if (tf === '14d') return { from: addDays(today, -14), to: today };
      if (tf === '30d') return { from: addDays(today, -30), to: today };
      if (tf === '6m') return { from: addDays(today, -180), to: today };
      if (tf === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today };
      if (tf === 'last_month') {
        return {
          from: new Date(y, m - 2, 1).toLocaleDateString('en-CA'),
          to: new Date(y, m - 1, 0).toLocaleDateString('en-CA'),
        };
      }
      return { from: `${today.slice(0, 7)}-01`, to: today }; // mtd
    })();
    const rangeFrom = req.nextUrl.searchParams.get('date_from') || preset.from;
    const rangeTo = req.nextUrl.searchParams.get('date_to') || preset.to;
    // Fetch wide enough to cover both the range and the basis lookback.
    const lookbackFrom = new Date(y, m - 7, 1).toLocaleDateString('en-CA');
    const from = rangeFrom < lookbackFrom ? rangeFrom : lookbackFrom;
    const to = rangeTo > today ? rangeTo : today;

    const qs = new URLSearchParams({
      api_key: WINDSOR_API_KEY, date_from: from, date_to: to,
      fields: ['date', 'account_name', 'profitandloss__totalincome', 'profitandloss__income', 'profitandloss__revenue',
        'profitandloss__cogs', 'profitandloss__operatingexpenses', 'profitandloss__expenses', 'profitandloss__netincome'].join(','),
      _renderer: 'json',
    });
    const [qbRes, shopifyDays, ads] = await Promise.all([
      fetch(`https://connectors.windsor.ai/quickbooks?${qs}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(30000) }).then(r => r.json()),
      import('@/src/lib/bqOverview').then(mod => mod.fetchShopifyDaily(from, to)).catch(() => []),
      import('@/src/lib/bqAds').then(mod => mod.getAdsOverview(from, to)).catch(() => null),
    ]);
    if (qbRes.error) return NextResponse.json({ error: String(qbRes.error) }, { status: 502 });

    const num = (v: unknown) => Number(v ?? 0) || 0;
    interface Row { [k: string]: string | number | null | undefined }
    let rows = (qbRes.data || []) as Row[];
    const rocknot = rows.filter(r => /rocknot/i.test(String(r.account_name || '')));
    if (rocknot.length) rows = rocknot;

    // Daily QB figures + monthly aggregates for bookedness detection.
    const qbDaily = new Map<string, { net: number }>();
    const qbMonthly = new Map<string, { income: number; cogs: number; opex: number }>();
    for (const r of rows) {
      const date = String(r.date || '').split('T')[0];
      if (!date) continue;
      const income = num(r.profitandloss__totalincome) || num(r.profitandloss__income) || num(r.profitandloss__revenue);
      const d = qbDaily.get(date) || { net: 0 };
      d.net += num(r.profitandloss__netincome);
      qbDaily.set(date, d);
      const mk = date.slice(0, 7);
      const b = qbMonthly.get(mk) || { income: 0, cogs: 0, opex: 0 };
      b.income += income;
      b.cogs += num(r.profitandloss__cogs);
      b.opex += num(r.profitandloss__operatingexpenses) || num(r.profitandloss__expenses);
      qbMonthly.set(mk, b);
    }

    const shopifyDaily = new Map<string, number>();
    const shopifyMonthly = new Map<string, number>();
    for (const d of shopifyDays) {
      shopifyDaily.set(d.date, (shopifyDaily.get(d.date) ?? 0) + d.totalSales);
      const mk = d.date.slice(0, 7);
      shopifyMonthly.set(mk, (shopifyMonthly.get(mk) ?? 0) + d.totalSales);
    }
    const adsDaily = new Map<string, number>();
    const adsMonthly = new Map<string, number>();
    for (const d of ads?.dailySpend ?? []) {
      const spend = d.meta + d.google + d.tiktok + (d.snapchat || 0);
      adsDaily.set(d.date, (adsDaily.get(d.date) ?? 0) + spend);
      const mk = d.date.slice(0, 7);
      adsMonthly.set(mk, (adsMonthly.get(mk) ?? 0) + spend);
    }

    const currentMonth = today.slice(0, 7);
    const isBooked = (mk: string) => {
      if (mk >= currentMonth) return false; // current month is never "actuals"
      const sales = shopifyMonthly.get(mk) ?? 0;
      const qb = qbMonthly.get(mk);
      return Boolean(qb && sales > 0 && qb.income >= sales * 0.6);
    };

    // Basis rates from the most recent booked months (≤3).
    const basisMonths: string[] = [];
    let sumSales = 0, sumCogs = 0, sumNonAdOpex = 0;
    for (const mk of Array.from(qbMonthly.keys()).sort().reverse()) {
      if (!isBooked(mk)) continue;
      const sales = shopifyMonthly.get(mk) ?? 0;
      sumSales += sales;
      sumCogs += qbMonthly.get(mk)!.cogs;
      sumNonAdOpex += Math.max(0, qbMonthly.get(mk)!.opex - (adsMonthly.get(mk) ?? 0));
      basisMonths.push(mk);
      if (basisMonths.length >= 3) break;
    }

    // Actuals over the requested range: QB net for days in booked months.
    let actualNet = 0, actualRevenue = 0, actualAdSpend = 0;
    const actualMonths = new Set<string>();
    for (const [date, d] of Array.from(qbDaily.entries())) {
      if (date < rangeFrom || date > rangeTo) continue;
      const mk = date.slice(0, 7);
      if (!isBooked(mk)) continue;
      actualNet += d.net;
      actualMonths.add(mk);
    }
    for (const [date, sales] of Array.from(shopifyDaily.entries())) {
      if (date < rangeFrom || date > rangeTo || !isBooked(date.slice(0, 7))) continue;
      actualRevenue += sales;
    }
    for (const [date, spend] of Array.from(adsDaily.entries())) {
      if (date < rangeFrom || date > rangeTo || !isBooked(date.slice(0, 7))) continue;
      actualAdSpend += spend;
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    // Past months inside the range whose books aren't done — surfaced on the
    // card so "why is this still an estimate?" answers itself.
    const unbookedPastMonths: Array<{ month: string; qbIncome: number; shopifySales: number }> = [];
    const monthsInRange = new Set<string>();
    for (let d = rangeFrom; d <= rangeTo; d = addDays(d, 1)) monthsInRange.add(d.slice(0, 7));
    for (const mk of Array.from(monthsInRange).sort()) {
      if (mk >= currentMonth || isBooked(mk)) continue;
      unbookedPastMonths.push({
        month: mk,
        qbIncome: round(qbMonthly.get(mk)?.income ?? 0),
        shopifySales: round(shopifyMonthly.get(mk) ?? 0),
      });
    }

    return NextResponse.json({
      unbookedPastMonths,
      cogsPct: sumSales > 0 ? Math.round((sumCogs / sumSales) * 1000) / 10 : null,
      nonAdOpexPct: sumSales > 0 ? Math.round((sumNonAdOpex / sumSales) * 1000) / 10 : null,
      basisMonths: basisMonths.sort(),
      actual: {
        net: round(actualNet),
        revenue: round(actualRevenue),
        adSpend: round(actualAdSpend),
        months: Array.from(actualMonths).sort(),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
