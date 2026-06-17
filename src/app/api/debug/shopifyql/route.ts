import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

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
  const body = JSON.stringify({
    query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
      tableData { rows columns { name } }
      parseErrors
    }}`,
  });

  const attempts: Array<{ version: string; header: string }> = [
    { version: '2026-04', header: 'X-Shopify-Access-Token' },
  ];

  const results: Record<string, unknown>[] = [];
  for (const a of attempts) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      headers[a.header] = a.header === 'Authorization' ? `Bearer ${TOKEN}` : TOKEN;
      const res = await fetch(`https://${DOMAIN}/admin/api/${a.version}/graphql.json`, {
        method: 'POST', headers, body, cache: 'no-store',
      });
      const json = await res.json();
      results.push({ ...a, status: res.status, ok: !!json?.data?.shopifyqlQuery?.tableData, raw: json });
    } catch (e) {
      results.push({ ...a, error: String(e) });
    }
  }

  return NextResponse.json({ hasToken: true, tokenPrefix: TOKEN.slice(0, 8), domain: DOMAIN, results });
}
