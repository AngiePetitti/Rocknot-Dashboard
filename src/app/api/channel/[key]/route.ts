import { NextRequest, NextResponse } from 'next/server';
import { fetchChannel, channelConfigured } from '@/src/lib/channel';
import { marketplaceByKey } from '@/src/lib/client';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, addDays } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One marketplace channel (e.g. /api/channel/nordstrom?tf=30d&compare=true).
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  if (!marketplaceByKey(params.key)) return NextResponse.json({ source: 'error', error: 'No such channel on this dashboard.' }, { status: 404 });
  if (!channelConfigured()) return NextResponse.json({ source: 'error', error: 'Shopify not connected — SHOPIFY_ACCESS_TOKEN is missing on this deployment.' });
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  let prior: { from: string; to: string } | null = null;
  if (sp.get('compare') === 'true') {
    if (tf === 'last_month' || tf === 'mtd') {
      const [y, m] = from.split('-').map(Number);
      const pFrom = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
      const pTo = tf === 'mtd' ? new Date(y, m - 2, Number(to.slice(8, 10))).toLocaleDateString('en-CA') : new Date(y, m - 1, 0).toLocaleDateString('en-CA');
      prior = { from: pFrom, to: pTo < pFrom ? pFrom : pTo };
    } else {
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      prior = { from: addDays(from, -days), to: addDays(from, -1) };
    }
  }
  try {
    const data = await fetchChannel(params.key, from, to, prior);
    return NextResponse.json({ source: 'shopify_live', ...data }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e instanceof Error ? e.message : e) });
  }
}
