import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDSOR_API_KEY = (process.env.WINDSOR_API_KEY || '').trim();

// Profitability basis for the Overview's live net-profit estimate: from the
// last complete, booked months, how much of each Shopify revenue dollar goes
// to COGS and to non-ad overhead (QB opex minus ad spend, which the live
// view counts separately). Admin-only, like everything financial.
export async function GET() {
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
    // Look back over the last 6 complete months; use the booked ones.
    const from = new Date(y, m - 7, 1).toLocaleDateString('en-CA');
    const to = new Date(y, m - 1, 0).toLocaleDateString('en-CA'); // end of last month

    const qs = new URLSearchParams({
      api_key: WINDSOR_API_KEY, date_from: from, date_to: to,
      fields: ['date', 'account_name', 'profitandloss__totalincome', 'profitandloss__income', 'profitandloss__revenue',
        'profitandloss__cogs', 'profitandloss__operatingexpenses', 'profitandloss__expenses'].join(','),
      _renderer: 'json',
    });
    const [qbRes, shopifyDays, ads] = await Promise.all([
      fetch(`https://connectors.windsor.ai/quickbooks?${qs}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(30000) }).then(r => r.json()),
      import('@/src/lib/bqOverview').then(m => m.fetchShopifyDaily(from, to)).catch(() => []),
      import('@/src/lib/bqAds').then(m => m.getAdsOverview(from, to)).catch(() => null),
    ]);
    if (qbRes.error) return NextResponse.json({ error: String(qbRes.error) }, { status: 502 });

    const num = (v: unknown) => Number(v ?? 0) || 0;
    interface Row { [k: string]: string | number | null | undefined }
    let rows = (qbRes.data || []) as Row[];
    const rocknot = rows.filter(r => /rocknot/i.test(String(r.account_name || '')));
    if (rocknot.length) rows = rocknot;

    const qbMonthly = new Map<string, { income: number; cogs: number; opex: number }>();
    for (const r of rows) {
      const mk = String(r.date || '').slice(0, 7);
      if (!mk) continue;
      const b = qbMonthly.get(mk) || { income: 0, cogs: 0, opex: 0 };
      b.income += num(r.profitandloss__totalincome) || num(r.profitandloss__income) || num(r.profitandloss__revenue);
      b.cogs += num(r.profitandloss__cogs);
      b.opex += num(r.profitandloss__operatingexpenses) || num(r.profitandloss__expenses);
      qbMonthly.set(mk, b);
    }

    const shopifyMonthly = new Map<string, number>();
    for (const d of shopifyDays) {
      const mk = d.date.slice(0, 7);
      shopifyMonthly.set(mk, (shopifyMonthly.get(mk) ?? 0) + d.totalSales);
    }
    const adsMonthly = new Map<string, number>();
    for (const d of ads?.dailySpend ?? []) {
      const mk = d.date.slice(0, 7);
      adsMonthly.set(mk, (adsMonthly.get(mk) ?? 0) + d.meta + d.google + d.tiktok + (d.snapchat || 0));
    }

    // A month counts as "booked" when QB income reaches at least 60% of
    // Shopify sales — below that the bookkeeping clearly isn't done.
    const used: string[] = [];
    let sumSales = 0, sumCogs = 0, sumNonAdOpex = 0;
    for (const [mk, qb] of Array.from(qbMonthly.entries()).sort(([a], [b]) => b.localeCompare(a))) {
      const sales = shopifyMonthly.get(mk) ?? 0;
      if (sales <= 0 || qb.income < sales * 0.6) continue;
      const adSpend = adsMonthly.get(mk) ?? 0;
      sumSales += sales;
      sumCogs += qb.cogs;
      sumNonAdOpex += Math.max(0, qb.opex - adSpend);
      used.push(mk);
      if (used.length >= 3) break;
    }
    if (!used.length || sumSales <= 0) {
      return NextResponse.json({ error: 'No fully booked months to base estimates on yet' }, { status: 404 });
    }

    return NextResponse.json({
      cogsPct: Math.round((sumCogs / sumSales) * 1000) / 10,
      nonAdOpexPct: Math.round((sumNonAdOpex / sumSales) * 1000) / 10,
      basisMonths: used.sort(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
