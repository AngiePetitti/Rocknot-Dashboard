import { NextRequest, NextResponse } from 'next/server';
import { getRevenueForTimeframe, getMetricsForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;

  const metrics = getMetricsForTimeframe(tf);
  const revenueData = getRevenueForTimeframe(tf);

  return NextResponse.json({
    source: 'shopify',
    timeframe: tf,
    metrics,
    revenueData,
    // Real implementation: fetch from Shopify Admin API
    // https://shopify.dev/docs/api/admin-rest/2024-01/resources/order
  });
}
