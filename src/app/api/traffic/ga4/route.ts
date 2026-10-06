import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4 } from '@/src/lib/ga4';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Google Analytics 4 view of the Traffic tab.
//   /api/traffic/ga4?tf=30d  ·  ?tf=custom&date_from=…&date_to=…
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  try {
    const data = await fetchGa4(from, to);
    return NextResponse.json(data, { headers: data.status === 'error' ? { 'Cache-Control': 'no-store' } : cacheHeaders(tf === 'today') });
  } catch (e) {
    return NextResponse.json({ status: 'error', error: e instanceof Error ? e.message : String(e), range: { from, to } }, { status: 200 });
  }
}
