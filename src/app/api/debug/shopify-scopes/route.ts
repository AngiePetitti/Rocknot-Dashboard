import { NextResponse } from 'next/server';
import { shopifyDomain } from '@/src/lib/client';
import { shopifyConfigured, shopifyToken } from '@/src/lib/shopifyAuth';

export const dynamic = 'force-dynamic';

// Which Admin API scopes the installed Shopify app actually holds right now —
// e.g. to confirm read_all_orders after releasing a new app version. Also
// reports how far back Shopify will serve orders. Scope names are not secrets.
export async function GET() {
  if (!shopifyConfigured()) return NextResponse.json({ error: 'Shopify not configured' });
  try {
    const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await shopifyToken() },
      body: JSON.stringify({
        query: `{
          currentAppInstallation { accessScopes { handle } }
          oldest: orders(first: 1, sortKey: CREATED_AT) { nodes { createdAt } }
        }`,
      }),
      cache: 'no-store',
    });
    const json = await res.json() as {
      data?: { currentAppInstallation?: { accessScopes?: Array<{ handle: string }> }; oldest?: { nodes?: Array<{ createdAt: string }> } };
      errors?: unknown;
    };
    const scopes = (json.data?.currentAppInstallation?.accessScopes ?? []).map(s => s.handle).sort();
    return NextResponse.json({
      store: shopifyDomain(),
      hasReadAllOrders: scopes.includes('read_all_orders'),
      oldestOrderShopifyWillReturn: json.data?.oldest?.nodes?.[0]?.createdAt ?? null,
      scopes,
      ...(json.errors ? { errors: json.errors } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) });
  }
}
