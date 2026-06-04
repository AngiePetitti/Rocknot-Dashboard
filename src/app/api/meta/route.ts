import { NextRequest, NextResponse } from 'next/server';
import { getPlatformSpendForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;
  const allPlatforms = getPlatformSpendForTimeframe(tf);
  const meta = allPlatforms.find(p => p.platform === 'Meta');

  return NextResponse.json({
    source: 'meta',
    timeframe: tf,
    data: meta,
    // Real implementation: fetch from Meta Marketing API
    // https://developers.facebook.com/docs/marketing-apis
  });
}
