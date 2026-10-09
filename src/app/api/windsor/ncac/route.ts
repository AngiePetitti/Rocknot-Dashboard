import { NextRequest, NextResponse } from 'next/server';
import { fetchNcac, type NcacData } from '@/src/lib/ncac';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, addDays, parseCompareMode, priorRangeFor } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// New-customer CAC by platform (Overview + Ad Performance + Cleo).
//   /api/windsor/ncac?tf=last_month&compare=true
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  const compare = sp.get('compare') === 'true';
  let prior: { from: string; to: string } | null = null;
  if (compare) {
    const pr = priorRangeFor(parseCompareMode(sp.get('compare_to')), tf, from, to);
    prior = { from: pr.from, to: pr.to };
  }
  try {
    const [cur, prev] = await Promise.all([fetchNcac(from, to), prior ? fetchNcac(prior.from, prior.to).catch(() => null) : Promise.resolve(null)]);
    const data: NcacData = { ...cur, prior: prev };
    return NextResponse.json(data, { headers: cacheHeaders(tf === 'today') });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), range: { from, to } }, { status: 200 });
  }
}
