import { NextRequest, NextResponse } from 'next/server';
import { shopifyDomain } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!;
const SCOPES = 'read_orders,read_analytics,read_reports,read_products';

export async function GET(req: NextRequest) {
  const shop = shopifyDomain();
  if (!shop) return NextResponse.json({ error: 'SHOPIFY_STORE_DOMAIN is not set' }, { status: 500 });
  const redirectUri = `${req.nextUrl.origin}/api/shopify/auth/callback`;
  const state = Math.random().toString(36).slice(2);
  const url = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  return NextResponse.redirect(url);
}
