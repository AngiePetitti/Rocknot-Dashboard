import { NextRequest, NextResponse } from 'next/server';
import { fetchShowroom, fetchShowroomOrderLines } from '@/src/lib/showroom';
import { showroomByKey } from '@/src/lib/client';
import { shopifyConfigured } from '@/src/lib/shopifyAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One showroom's orders and pending drafts (e.g. /api/showroom/la-showroom).
// With ?order=<Shopify order gid> it returns that order's line items instead.
// Never CDN-cached: sales (showroom) logins and the team share the URL, and a
// rep checking on a backorder needs the current state.
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  if (!showroomByKey(params.key)) return NextResponse.json({ source: 'error', error: 'No such showroom on this dashboard.' }, { status: 404 });
  if (!shopifyConfigured()) return NextResponse.json({ source: 'error', error: 'Shopify not connected — set SHOPIFY_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, on this deployment.' });
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const order = request.nextUrl.searchParams.get('order');
    if (order) return NextResponse.json({ source: 'shopify_live', lines: await fetchShowroomOrderLines(params.key, order) }, { headers });
    return NextResponse.json({ source: 'shopify_live', ...(await fetchShowroom(params.key)) }, { headers });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e instanceof Error ? e.message : e) }, { headers });
  }
}
