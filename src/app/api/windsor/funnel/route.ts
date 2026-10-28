import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { fetchFunnel } from '@/src/lib/funnel';
import { timeframeRange, todayPst } from '@/src/lib/timeframes';
import type { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ad spend by funnel stage per platform for a timeframe.
export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
    const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
    const data = await fetchFunnel(from, to, from === todayPst() && to === todayPst());
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
