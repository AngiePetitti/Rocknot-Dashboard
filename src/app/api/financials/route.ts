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
const FIELDSETS: string[][] = [
  ['date', 'account_name', 'account_type', 'amount'],
  ['date', 'account_name', 'account_type', 'total_amount'],
  ['transaction_date', 'account_name', 'account_type', 'amount'],
  ['date', 'account_fully_qualified_name', 'account_type', 'amount'],
  ['expense_transaction_date', 'expense_account_name', 'expense_total_amount'],
  ['date', 'account_name', 'account_current_balance'],
];

interface QBRow { [key: string]: string | number | null | undefined }

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
  for (const fs of FIELDSETS) {
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
  }, { status: 502 });
}
