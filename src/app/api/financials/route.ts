import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { qbAccountRegex, windsorParams } from '@/src/lib/client';

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

// Expense buckets for the grouped P&L view and fully-loaded MER.
export type ExpenseBucket = 'marketing' | 'software' | 'payroll' | 'fulfillment' | 'other';
const BUCKET_RULES: Array<[ExpenseBucket, RegExp]> = [
  ['marketing', /market|advertis|\bads?\b|meta|facebook|instagram|google ads|adwords|tiktok|snap|pinterest|influencer|affiliate|ugc|creative|agency|klaviyo|sms|email|promo|sponsor|photo|content/i],
  ['payroll', /payroll|wage|salar|contract(or| labor)|freelance|1099|commission|benefit|gusto|adp/i],
  ['fulfillment', /shipping|freight|fulfill|postage|3pl|warehouse|packag|ship(bob|station)|carrier|duties|customs/i],
  ['software', /software|subscript|saas|app\b|shopify|slack|zoom|adobe|canva|figma|quickbooks|windsor|vercel|notion|asana|hosting|domain|tech/i],
];
function autoBucket(account: string): ExpenseBucket {
  for (const [bucket, re] of BUCKET_RULES) if (re.test(account)) return bucket;
  return 'other';
}
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

  const scoped = windsorParams('quickbooks', { date_from: dateFrom, date_to: dateTo });
  if (!scoped) return NextResponse.json({ source: 'not_connected', error: 'QuickBooks is not connected for this client', fields: PNL_FIELDS }, { status: 200 });
  const qs = new URLSearchParams({
    api_key: WINDSOR_API_KEY,
    ...scoped,
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
    // this client's entity belongs on this P&L. Track what we saw for verification.
    const accountsSeen = Array.from(new Set(rows.map(r => String(r.account_name || '')))).filter(Boolean);
    const qbMatch = qbAccountRegex();
    const ownRows = qbMatch ? rows.filter(r => qbMatch.test(String(r.account_name || ''))) : rows;
    if (ownRows.length > 0) rows = ownRows;

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

    // ── Account-level line items — straight from QuickBooks' own P&L report
    // (Windsor's connector carries only summary rollups; verified Aug 2026).
    // Requires the one-time connect at /api/debug/qb-oauth.
    const round = (n: number) => Math.round(n * 100) / 100;

    // Reconciliation column: Shopify's own monthly total sales next to the
    // QuickBooks income — a visible books-vs-store gap check (bookkeeping
    // lag, fee-netting, or missing entries show up as deltas).
    const shopifyMonthly = new Map<string, number>();
    try {
      const { fetchShopifyDaily } = await import('@/src/lib/bqOverview');
      const days = await fetchShopifyDaily(dateFrom, dateTo);
      for (const d of days) {
        const mk = d.date.slice(0, 7);
        if (mk) shopifyMonthly.set(mk, (shopifyMonthly.get(mk) ?? 0) + d.totalSales);
      }
    } catch { /* Shopify column is optional */ }

    let lineItems: Array<{ account: string; amount: number; section: string; isSummary?: boolean }> | null = null;
    let qbDirect = false;
    let qbError: string | null = null;
    try {
      const { getQbAccess } = await import('@/src/lib/qbAuth');
      const qb = await getQbAccess();
      if (qb) {
        const rurl = `https://quickbooks.api.intuit.com/v3/company/${qb.realmId}/reports/ProfitAndLoss?start_date=${dateFrom}&end_date=${dateTo}&accounting_method=Accrual&minorversion=73`;
        const rres = await fetch(rurl, {
          headers: { Authorization: `Bearer ${qb.token}`, Accept: 'application/json' },
          next: { revalidate: 900 },
          signal: AbortSignal.timeout(30000),
        });
        const report = await rres.json();
        if (report?.Rows) {
          const items: Array<{ account: string; amount: number; section: string; isSummary?: boolean }> = [];
          interface RRow { type?: string; group?: string; Header?: { ColData?: Array<{ value?: string }> }; Rows?: { Row?: RRow[] }; Summary?: { ColData?: Array<{ value?: string }> }; ColData?: Array<{ value?: string }> }
          const walk = (rowsArr: RRow[], section: string) => {
            for (const row of rowsArr) {
              if (row.type === 'Section' || row.Rows) {
                const title = row.Header?.ColData?.[0]?.value || row.group || section;
                if (row.Header?.ColData?.length) {
                  const headerAmt = Number(row.Header.ColData[1]?.value || 0);
                  if (row.Header.ColData[0]?.value && headerAmt) {
                    items.push({ account: String(row.Header.ColData[0].value), amount: round(headerAmt), section });
                  }
                }
                if (row.Rows?.Row) walk(row.Rows.Row, title);
                const sum = row.Summary?.ColData;
                if (sum?.length && sum[0]?.value) {
                  items.push({ account: String(sum[0].value), amount: round(Number(sum[1]?.value || 0)), section, isSummary: true });
                }
              } else if (row.ColData?.length) {
                const name = String(row.ColData[0]?.value || '').trim();
                const amt = Number(row.ColData[1]?.value || 0);
                if (name) items.push({ account: name, amount: round(amt), section });
              }
            }
          };
          walk((report.Rows.Row || []) as RRow[], '');
          if (items.length) { lineItems = items; qbDirect = true; }
        } else if (report?.Fault) {
          qbError = JSON.stringify(report.Fault?.Error?.[0]?.Message || report.Fault);
        }
      }
    } catch (e) {
      qbError = String(e);
    }

    // Bucket the expense line items (manual overrides win over keyword rules).
    let overrides: Record<string, string> = {};
    try {
      const { getKV } = await import('@/src/lib/chatStore');
      overrides = JSON.parse((await getKV('finance_account_categories')) || '{}');
    } catch { /* no overrides yet */ }
    let buckets: Record<string, number> | null = null;
    let categorized: Array<{ account: string; amount: number; bucket: string; overridden: boolean }> | null = null;
    if (lineItems) {
      const expenseLines = lineItems.filter(li => !li.isSummary && /expense/i.test(li.section) && li.amount !== 0);
      categorized = expenseLines.map(li => {
        const ov = overrides[li.account];
        return { account: li.account, amount: li.amount, bucket: ov || autoBucket(li.account), overridden: Boolean(ov) };
      });
      buckets = { marketing: 0, software: 0, payroll: 0, fulfillment: 0, other: 0 };
      for (const c of categorized) buckets[c.bucket] = round((buckets[c.bucket] || 0) + c.amount);
    }
    // Fully-loaded MER: booked revenue ÷ booked TOTAL marketing expense
    // (platform ad spend as billed + agency + influencers + tools tagged
    // marketing) — the "what does marketing really cost us" ratio.
    const revenueBooked = round(Array.from(monthly.values()).reduce((sum0, m) => sum0 + m.income, 0));
    const fullyLoadedMer = buckets && buckets.marketing > 0 && revenueBooked > 0
      ? Math.round((revenueBooked / buckets.marketing) * 100) / 100 : null;

    return NextResponse.json({
      source: 'windsor_quickbooks_pnl',
      categorized,
      buckets,
      fullyLoadedMer,
      revenueBooked,
      range: { from: dateFrom, to: dateTo },
      rowCount: rows.length,
      accountsSeen,
      accountUsed: accountsSeen.find(a => (qbMatch ? qbMatch.test(a) : true)) || accountsSeen[0] || 'unknown',
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])),
      monthly: Array.from(monthly.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([month, m]) => ({
          month,
          income: round(m.income),
          shopifySales: round(shopifyMonthly.get(month) ?? 0),
          cogs: round(m.cogs),
          expenses: round(m.expenses),
          net: round(m.net),
        })),
      lineItems,
      qbDirect,
      qbError,
    });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e) }, { status: 502 });
  }
}

// Save a manual bucket override for one account (admin). Overrides persist in
// KV and win over the keyword auto-classification.
export async function PATCH(req: NextRequest) {
  const { getServerSession } = await import('next-auth');
  const { authOptions, authConfigured } = await import('@/src/lib/auth');
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const account = String(body.account || '').trim();
  const bucket = String(body.bucket || '').trim();
  if (!account || !['marketing', 'software', 'payroll', 'fulfillment', 'other', 'auto'].includes(bucket)) {
    return NextResponse.json({ error: 'account and bucket (marketing|software|payroll|fulfillment|other|auto) required' }, { status: 400 });
  }
  const { getKV, setKV } = await import('@/src/lib/chatStore');
  let overrides: Record<string, string> = {};
  try { overrides = JSON.parse((await getKV('finance_account_categories')) || '{}'); } catch { /* fresh */ }
  if (bucket === 'auto') delete overrides[account];
  else overrides[account] = bucket;
  await setKV('finance_account_categories', JSON.stringify(overrides));
  return NextResponse.json({ ok: true, overrides });
}
