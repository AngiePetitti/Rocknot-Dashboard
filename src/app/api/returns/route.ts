import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { fetchReturnsSummary, returnsConfigured } from '@/src/lib/returns';
import { timeframeRange } from '@/src/lib/timeframes';
import type { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Return rate for a timeframe with a trailing six-month baseline (Shopify).
// Any signed-in dashboard user can read it; it carries no cost data.
export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!returnsConfigured()) return NextResponse.json({ error: 'Shopify is not connected on this client profile' }, { status: 404 });
  try {
    const sp = req.nextUrl.searchParams;
    const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
    const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
    const data = await fetchReturnsSummary(from, to);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
