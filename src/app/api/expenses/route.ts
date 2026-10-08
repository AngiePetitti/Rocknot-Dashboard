import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { expensesConfigured, expensesForRange, fetchExpenseSheet } from '@/src/lib/expenses';
import { timeframeRange } from '@/src/lib/timeframes';
import type { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Marketing expenses (from the budgeting sheet) for a timeframe — admin-only,
// like every other financial endpoint.
export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!expensesConfigured()) return NextResponse.json({ error: 'No marketing expenses sheet on this client profile' }, { status: 404 });
  try {
    const sp = req.nextUrl.searchParams;
    const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
    const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
    const sheet = await fetchExpenseSheet(sp.get('refresh') === '1');
    const range = expensesForRange(sheet, from, to);
    return NextResponse.json({ sheet: { title: sheet.title, year: sheet.year, fetchedAt: sheet.fetchedAt, months: sheet.months }, range });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
