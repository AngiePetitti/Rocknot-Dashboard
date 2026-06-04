import { NextRequest, NextResponse } from 'next/server';
import { getPlatformSpendForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;
  const allPlatforms = getPlatformSpendForTimeframe(tf);
  const google = allPlatforms.find(p => p.platform === 'Google');

  return NextResponse.json({
    source: 'google',
    timeframe: tf,
    data: google,
    // Real implementation: fetch from Google Ads API
    // https://developers.google.com/google-ads/api/docs/start
  });
}
