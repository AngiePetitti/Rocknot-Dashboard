import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4, ga4Configured } from '@/src/lib/ga4';
import { windsorAccount } from '@/src/lib/client';
import { timeframeRange } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only (middleware gates /api/debug/*). Shows which Windsor connector
// slug and field sets GA4 accepted, with the raw error for anything rejected.
//   /api/debug/ga4?tf=7d
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '7d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  const data = await fetchGa4(from, to, true);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    configured: ga4Configured(),
    account: windsorAccount('google_analytics'),
    range: data.range,
    status: data.status,
    error: data.error,
    connector: data.connector,
    blocks: data.blocks,
    totals: data.totals,
    counts: { daily: data.daily.length, channels: data.channels.length, sources: data.sources.length, landingPages: data.landingPages.length, pages: data.pages.length },
    channels: data.channels.slice(0, 10),
    topLanding: data.landingPages.slice(0, 5),
    attempts: data.attempts,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
