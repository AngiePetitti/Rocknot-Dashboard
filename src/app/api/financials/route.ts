import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDSOR_API_KEY = (process.env.WINDSOR_API_KEY || '').trim();

// P&L straight from Windsor's QuickBooks profitandloss table. Field names use
// the API's double-underscore form (confirmed from a real Windsor query URL,
// Aug 2026); QuickBooks' own computed totals (netincome, totalincome,
// totalexpenses) are used directly rather than re-derived.
const PNL_FIELDS = [
  'date',
  'account_name',
  'profitandloss__totalincome',
  'profitandloss__income',
  'profitandloss__revenue',
  'profitandloss__expenses',
  'profitandloss__cogs',
  'profitandloss__grossprofit',
  'profitandloss__operatingexpenses',
  'profitandloss__totalexpenses',
  'profitandloss__otherincome',
  'profitandloss__otherexpenses',
  'profitandloss__incometaxexpenses',
  'profitandloss__netoperatingincome',
  'profitandloss__netincome',
];

interface QBRow { [key: string]: string | number | null | undefined }
const num = (v: unknown) => Number(v ?? 0) || 0;

export async function GET(req: NextRequest) {
  // Admin-only, enforced server-side — P&L never reaches non-admin sessions.
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  if (!WINDSOR_API_KEY) {
    return NextResponse.json({ error: 'Windsor API key not configured' }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const dateFrom = searchParams.get('date_from') || `${today.slice(0, 4)}-01-01`;
  const dateTo = searchParams.get('date_to') || today;

  const qs = new URLSearchParams({
    api_key: WINDSOR_API_KEY,
    date_from: dateFrom,
    date_to: dateTo,
    fields: PNL_FIELDS.join(','),
    _renderer: 'json',
  });
  try {
    const res = await fetch(`https://connectors.windsor.ai/quickbooks?${qs}`, {
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (json.error) {
      return NextResponse.json({ source: 'error', error: String(json.error), fields: PNL_FIELDS }, { status: 502 });
    }
    let rows = (json.data || []) as QBRow[];

    // The Windsor connection can carry multiple QuickBooks companies — only
    // Rocknot LLC belongs on this P&L. Track what we saw for verification.
    const accountsSeen = Array.from(new Set(rows.map(r => String(r.account_name || '')))).filter(Boolean);
    const rocknotRows = rows.filter(r => /rocknot/i.test(String(r.account_name || '')));
    if (rocknotRows.length > 0) rows = rocknotRows;

    const totals = {
      income: 0, cogs: 0, grossProfit: 0, expenses: 0, totalExpenses: 0,
      otherIncome: 0, otherExpenses: 0, incomeTax: 0, netOperatingIncome: 0, netIncome: 0,
    };
    const monthly = new Map<string, { income: number; cogs: number; expenses: number; net: number }>();

    for (const r of rows) {
      const date = String(r.date || '').split('T')[0];
      // QuickBooks P&Ls populate different column variants depending on the
      // chart of accounts — take the first non-zero of each family.
      const income = num(r.profitandloss__totalincome) || num(r.profitandloss__income) || num(r.profitandloss__revenue);
      const cogs = num(r.profitandloss__cogs);
      const opex = num(r.profitandloss__operatingexpenses) || num(r.profitandloss__expenses);
      const net = num(r.profitandloss__netincome);

      totals.income += income;
      totals.cogs += cogs;
      totals.grossProfit += num(r.profitandloss__grossprofit);
      totals.expenses += opex;
      totals.totalExpenses += num(r.profitandloss__totalexpenses);
      totals.otherIncome += num(r.profitandloss__otherincome);
      totals.otherExpenses += num(r.profitandloss__otherexpenses);
      totals.incomeTax += num(r.profitandloss__incometaxexpenses);
      totals.netOperatingIncome += num(r.profitandloss__netoperatingincome);
      totals.netIncome += net;

      const mk = date.slice(0, 7);
      if (mk) {
        const m = monthly.get(mk) || { income: 0, cogs: 0, expenses: 0, net: 0 };
        m.income += income; m.cogs += cogs; m.expenses += opex; m.net += net;
        monthly.set(mk, m);
      }
    }

    // Fall back to derived figures when QuickBooks' computed columns are zero.
    if (totals.grossProfit === 0) totals.grossProfit = totals.income - totals.cogs;
    if (totals.netIncome === 0 && (totals.income || totals.totalExpenses)) {
      totals.netIncome = totals.income - totals.cogs - (totals.expenses || totals.totalExpenses)
        + totals.otherIncome - totals.otherExpenses - totals.incomeTax;
    }

    // ── Account-level line items (like QuickBooks' actual P&L report) ──
    // Windsor may expose the ProfitAndLossDetail report as its own table;
    // probe the likely field spellings and group by account when one works.
    const round = (n: number) => Math.round(n * 100) / 100;
    let lineItems: Array<{ account: string; amount: number }> | null = null;
    const detailAttempts: Array<{ fields: string; error: string }> = [];
    const DETAIL_CANDIDATES = [
      ['date', 'profitandlossdetail__accountname', 'profitandlossdetail__amount'],
      ['date', 'profitandlossdetail__account_name', 'profitandlossdetail__amount'],
      ['date', 'profitandlossdetail__account', 'profitandlossdetail__amount'],
      ['date', 'profitandlossdetail__name', 'profitandlossdetail__subtotal'],
    ];
    for (const fs of DETAIL_CANDIDATES) {
      const dqs = new URLSearchParams({
        api_key: WINDSOR_API_KEY, date_from: dateFrom, date_to: dateTo,
        fields: ['account_name', ...fs].join(','), _renderer: 'json',
      });
      try {
        const dres = await fetch(`https://connectors.windsor.ai/quickbooks?${dqs}`, {
          next: { revalidate: 900 }, signal: AbortSignal.timeout(20000),
        });
        const djson = await dres.json();
        if (djson.error) { detailAttempts.push({ fields: fs.join(','), error: String(djson.error) }); continue; }
        const drows = ((djson.data || []) as QBRow[]).filter(r => /rocknot/i.test(String(r.account_name || '')) || accountsSeen.length <= 1);
        if (!drows.length) { detailAttempts.push({ fields: fs.join(','), error: 'accepted, 0 rows' }); continue; }
        const nameKey = fs[1];
        const amtKey = fs[2];
        const byAccount = new Map<string, number>();
        for (const r of drows) {
          const name = String(r[nameKey] ?? '').trim();
          const amt = num(r[amtKey]);
          if (!name || !amt) continue;
          byAccount.set(name, (byAccount.get(name) ?? 0) + amt);
        }
        if (byAccount.size > 0) {
          lineItems = Array.from(byAccount.entries())
            .map(([account, amount]) => ({ account, amount: round(amount) }))
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
          break;
        }
        detailAttempts.push({ fields: fs.join(','), error: 'rows had no usable account/amount values' });
      } catch (e) {
        detailAttempts.push({ fields: fs.join(','), error: String(e) });
      }
    }

    return NextResponse.json({
      source: 'windsor_quickbooks_pnl',
      range: { from: dateFrom, to: dateTo },
      rowCount: rows.length,
      accountsSeen,
      accountUsed: accountsSeen.find(a => /rocknot/i.test(a)) || accountsSeen[0] || 'unknown',
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])),
      monthly: Array.from(monthly.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([month, m]) => ({ month, income: round(m.income), cogs: round(m.cogs), expenses: round(m.expenses), net: round(m.net) })),
      lineItems,
      detailAttempts: lineItems ? undefined : detailAttempts,
    });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e) }, { status: 502 });
  }
}
