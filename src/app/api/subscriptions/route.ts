import { NextRequest, NextResponse } from 'next/server';
import { fetchSubscriptions } from '@/src/lib/subscriptions';
import { getClient } from '@/src/lib/client';
import { shopifyConfigured } from '@/src/lib/shopifyAuth';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, parseCompareMode, priorRangeFor } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Subscriptions tab: /api/subscriptions?tf=30d&compare=true
export async function GET(request: NextRequest) {
  if (!getClient().subscriptions) return NextResponse.json({ source: 'error', error: 'No subscription channel on this dashboard.' }, { status: 404 });
  if (!shopifyConfigured()) return NextResponse.json({ source: 'error', error: 'Shopify not connected on this deployment.' });
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  // Always compare (prior period by default) — direction is the point of this tab.
  const pr = priorRangeFor(parseCompareMode(sp.get('compare_to')), tf, from, to);
  try {
    const data = await fetchSubscriptions(from, to, { from: pr.from, to: pr.to });
    return NextResponse.json({ source: 'shopify_live', ...data }, { headers: cacheHeaders(tf === 'today') });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}
