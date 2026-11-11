import { NextRequest, NextResponse } from 'next/server';
import { fetchTraffic, trafficConfigured } from '@/src/lib/traffic';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, priorRangeFor, parseCompareMode } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Site traffic sources for a dashboard timeframe (Shopify sessions report).
//   /api/traffic?tf=30d
//   /api/traffic?tf=custom&date_from=…&date_to=…&compare=true
export async function GET(request: NextRequest) {
  if (!trafficConfigured()) {
    return NextResponse.json({ source: 'error', error: 'Shopify not connected — set SHOPIFY_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, on this deployment.' });
  }
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  const compare = sp.get('compare') === 'true';

  // Comparison basis follows the Overview's toggle: prior period (default),
  // the same dates last month, or the same dates last year.
  const prior = compare ? priorRangeFor(parseCompareMode(sp.get('compare_to')), tf, from, to) : null;

  try {
    const data = await fetchTraffic(from, to, prior);
    return NextResponse.json({ source: 'shopify_live', ...data }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e instanceof Error ? e.message : e) });
  }
}
