import { NextRequest, NextResponse } from 'next/server';
import { fetchOrganic } from '@/src/lib/organic';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Organic Content tab: Pinterest pins, Instagram posts and blog articles for
// a dashboard timeframe.  /api/organic?tf=30d  ·  ?tf=custom&date_from&date_to
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  try {
    const data = await fetchOrganic(from, to);
    return NextResponse.json({ source: 'live', ...data }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}
