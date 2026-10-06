import { NextRequest, NextResponse } from 'next/server';
import { fetchNcac, type NcacData } from '@/src/lib/ncac';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, addDays } from '@/src/lib/timeframes';
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
    if (tf === 'last_month' || tf === 'mtd') {
      const [y, m] = from.split('-').map(Number);
      const pFrom = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
      const pTo = tf === 'mtd' ? new Date(y, m - 2, Number(to.slice(8, 10))).toLocaleDateString('en-CA') : new Date(y, m - 1, 0).toLocaleDateString('en-CA');
      prior = { from: pFrom, to: pTo < pFrom ? pFrom : pTo };
    } else {
      const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
      prior = { from: addDays(from, -days), to: addDays(from, -1) };
    }
  }
  try {
    const [cur, prev] = await Promise.all([fetchNcac(from, to), prior ? fetchNcac(prior.from, prior.to).catch(() => null) : Promise.resolve(null)]);
    const data: NcacData = { ...cur, prior: prev };
    return NextResponse.json(data, { headers: cacheHeaders(tf === 'today') });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), range: { from, to } }, { status: 200 });
  }
}
