import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDSOR_API_KEY = (process.env.WINDSOR_API_KEY || '').trim();

// P&L data from QuickBooks via Windsor's quickbooks connector. Windsor's QB
// field names aren't fully documented, so we probe candidate field sets in
// order and use the first one the connector accepts; every failure's exact
// error is returned so unknown-field messages are visible on the tab and the
// list below can be corrected in one pass.
// Windsor namespaces QuickBooks fields by entity table in CamelCase
// (confirmed in their field picker: accounts.AccountType, accounts.
// CurrentBalance, …). QuickBooks entities use TxnDate/TotalAmt naming.
// P&L flows come from the transaction tables; the accounts table only has
// point-in-time balances.
const FIELDSETS: string[][] = [
  // P&L-report style tables, if Windsor exposes them
  ['date', 'profit_and_loss.AccountName', 'profit_and_loss.Amount'],
  ['date', 'profitandloss.AccountName', 'profitandloss.Amount'],
  // Transaction entities (QuickBooks API naming)
  ['date', 'invoices.TxnDate', 'invoices.TotalAmt'],
  ['date', 'salesreceipts.TxnDate', 'salesreceipts.TotalAmt'],
  ['date', 'purchases.TxnDate', 'purchases.TotalAmt'],
  ['date', 'bills.TxnDate', 'bills.TotalAmt'],
  // Account list with classification + balances (fallback context)
  ['date', 'account_name', 'accounts.Classification', 'accounts.AccountType', 'accounts.CurrentBalance'],
  ['date', 'account_name', 'accounts.AccountType', 'accounts.CurrentBalance'],
];

interface QBRow { [key: string]: string | number | null | undefined }

// Windsor's docs page is the authority on QB field ids (their API errors
// point to it). Fetch and parse it server-side, then build field sets from
// what actually exists. Cached a day — the schema rarely changes.
async function discoverQbFields(): Promise<string[]> {
  try {
    const res = await fetch('https://windsor.ai/data-field/quickbooks/', {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RocknotDashboard/1.0)' },
    });
    const html = await res.text();
    const tokens = html.match(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g) || [];
    const blacklist = /^(utm_|wp_|data_|font_|text_|margin_|border_|nav_|menu_|post_|page_id)/;
    return Array.from(new Set(tokens)).filter(t => !blacklist.test(t) && t.length <= 48);
  } catch {
    return [];
  }
}

function buildDiscoveredSets(fields: string[]): string[][] {
  const has = (re: RegExp) => fields.filter(f => re.test(f));
  const dates = has(/(^|_)date$/).concat(fields.includes('date') ? ['date'] : []);
  const names = has(/account.*name|(^|_)name$/);
  const types = has(/account.*type|classification|category/);
  const amounts = has(/amount|balance|(^|_)total|net_income|income$|expense/);
  const sets: string[][] = [];
  for (const d of dates.slice(0, 2)) {
    for (const a of amounts.slice(0, 6)) {
      const base = [d, a];
      const n = names[0]; const t = types[0];
      if (n && t) sets.push([...base, n, t]);
      if (n) sets.push([...base, n]);
      sets.push(base);
    }
  }
  return sets.slice(0, 12);
}

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
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const dateFrom = searchParams.get('date_from') || yearStart;
  const dateTo = searchParams.get('date_to') || today;

  const attempts: Array<{ fields: string; error: string }> = [];
  // Static guesses first (cheap), then field sets built from Windsor's own
  // published QuickBooks field reference.
  const discovered = await discoverQbFields();
  const candidates = [...FIELDSETS, ...buildDiscoveredSets(discovered)];
  for (const fs of candidates) {
    const qs = new URLSearchParams({
      api_key: WINDSOR_API_KEY,
      date_from: dateFrom,
      date_to: dateTo,
      fields: fs.join(','),
      _renderer: 'json',
    });
    try {
      const res = await fetch(`https://connectors.windsor.ai/quickbooks?${qs}`, {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json();
      if (json.error) {
        attempts.push({ fields: fs.join(','), error: String(json.error) });
        continue;
      }
      const rows = (json.data || []) as QBRow[];
      if (!Array.isArray(rows)) {
        attempts.push({ fields: fs.join(','), error: 'no data array in response' });
        continue;
      }
      // Valid fields but zero rows: remember it, keep probing for a set that
      // actually carries data in this range.
      if (rows.length === 0) {
        attempts.push({ fields: fs.join(','), error: 'accepted, but 0 rows in range' });
        continue;
      }
      return NextResponse.json({
        source: 'windsor_quickbooks',
        fieldsUsed: fs,
        range: { from: dateFrom, to: dateTo },
        rowCount: rows.length,
        rows: rows.slice(0, 2000),
        attempts,
      });
    } catch (e) {
      attempts.push({ fields: fs.join(','), error: String(e) });
    }
  }

  return NextResponse.json({
    source: 'error',
    error: 'No candidate QuickBooks field set was accepted by Windsor — see attempts for the exact connector errors.',
    attempts,
    discoveredFields: discovered.filter(f => /account|amount|balance|income|expense|invoice|bill|total|date|net|gross/.test(f)).slice(0, 120),
  }, { status: 502 });
}
