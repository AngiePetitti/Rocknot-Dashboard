import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com';

// Surfaces exactly what the app's ShopifyQL call returns (auth/scope/parse
// errors), using the same token the overview uses.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from') || '2026-06-14';
  const to = searchParams.get('to') || '2026-06-16';

  if (!TOKEN) {
    return NextResponse.json({ hasToken: false, domain: DOMAIN, error: 'SHOPIFY_ACCESS_TOKEN not set' });
  }

  const ql = `FROM sales SHOW orders, net_sales, total_sales TIMESERIES day SINCE ${from} UNTIL ${to}`;
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
          tableData { rowData columns { name } }
          parseErrors { code message }
        }}`,
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    return NextResponse.json({
      hasToken: true,
      tokenPrefix: TOKEN.slice(0, 8),
      domain: DOMAIN,
      httpStatus: res.status,
      raw: json,
    });
  } catch (e) {
    return NextResponse.json({ hasToken: true, domain: DOMAIN, error: String(e) });
  }
}
