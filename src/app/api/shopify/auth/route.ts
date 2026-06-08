import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!;
const SHOP = 'shop-rocknot.myshopify.com';
const REDIRECT_URI = 'https://rocknot-dashboard.vercel.app/api/shopify/auth/callback';
const SCOPES = 'read_orders,read_analytics';

export async function GET() {
  const state = Math.random().toString(36).slice(2);
  const url = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
  return NextResponse.redirect(url);
}
