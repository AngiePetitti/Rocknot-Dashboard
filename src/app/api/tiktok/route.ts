import { NextRequest, NextResponse } from 'next/server';
import { getPlatformSpendForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;
  const allPlatforms = getPlatformSpendForTimeframe(tf);
  const tiktok = allPlatforms.find(p => p.platform === 'TikTok');

  return NextResponse.json({
    source: 'tiktok',
    timeframe: tf,
    data: tiktok,
    // Real implementation: fetch from TikTok for Business API
    // https://ads.tiktok.com/marketing_api/docs
  });
}
