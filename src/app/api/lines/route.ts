import { NextRequest, NextResponse } from 'next/server';
import { getProductLineSplit } from '@/src/lib/productLines';
import { productLines } from '@/src/lib/client';
import { timeframeRange } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';

// Per-product-line split (women's vs kids …) for a dashboard timeframe.
//   /api/lines?tf=ytd   |   /api/lines?tf=custom&date_from=…&date_to=…
export async function GET(request: NextRequest) {
  if (productLines().length === 0) return NextResponse.json({ lines: [] });
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, request.nextUrl.searchParams.get('date_from'), request.nextUrl.searchParams.get('date_to'));
  try {
    const split = await getProductLineSplit(from, to);
    return NextResponse.json({ from, to, ...split });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
