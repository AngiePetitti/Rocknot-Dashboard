import { NextRequest, NextResponse } from 'next/server';
import { getPlatformSpendForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;
  const allPlatforms = getPlatformSpendForTimeframe(tf);
  const ctv = allPlatforms.find(p => p.platform === 'CTV');

  return NextResponse.json({
    source: 'ctv',
    timeframe: tf,
    data: ctv,
    // Real implementation: fetch from CTV platform API (Roku, Hulu, etc.)
  });
}
