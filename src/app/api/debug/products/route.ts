import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { getProductSales } from '@/src/lib/bqProducts';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function rangeForTf(tfRaw: string): { from: string; to: string } {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (tfRaw === '7d') return { from: addDays(todayStr, -7), to: todayStr };
  if (tfRaw === '30d') return { from: addDays(todayStr, -30), to: todayStr };
  if (tfRaw === '6m') return { from: addDays(todayStr, -180), to: todayStr };
  if (tfRaw === 'ytd') return { from: `${todayStr.split('-')[0]}-01-01`, to: todayStr };
  return { from: addDays(todayStr, -30), to: todayStr };
}

async function runShopifyQL(query: string) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData { rows columns { name } } parseErrors
      }}`,
    }),
    next: { revalidate: 0 },
  });
  const json = await res.json();
  return { q: json?.data?.shopifyqlQuery, errors: json?.errors };
}

// Compare what the products tab produces across timeframes:
//   /api/debug/products            → compares ytd vs 30d
//   /api/debug/products?tf=ytd     → single timeframe, full detail
export async function GET(request: NextRequest) {
  const single = request.nextUrl.searchParams.get('tf');
  const tfs = single ? [single] : ['ytd', '30d', '7d'];

  const hasBqProducts = isBigQueryConfigured() && await tableExists('shopify_products').catch(() => false);

  const out: Record<string, unknown> = { hasBqProducts };

  for (const tf of tfs) {
    const { from, to } = rangeForTf(tf);
    const entry: Record<string, unknown> = { resolvedRange: { from, to } };

    // BigQuery path (only used if the table exists and returns rows).
    if (hasBqProducts) {
      const bq = await getProductSales(from, to).catch(e => ({ error: String(e) }));
      entry.bigquery = 'products' in bq
        ? { productCount: bq.products.length, totalRevenue: bq.totalRevenue, top3: bq.products.slice(0, 3) }
        : bq;
    }

    // ShopifyQL path (the live source when BigQuery is empty).
    const perProduct = await runShopifyQL(
      `FROM sales SHOW net_sales, orders, cost_of_goods_sold, gross_profit GROUP BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 50`
    );
    const totals = await runShopifyQL(
      `FROM sales SHOW net_sales, orders, gross_profit SINCE ${from} UNTIL ${to}`
    );
    entry.shopifyql = {
      parseErrors: perProduct.q?.parseErrors || null,
      graphqlErrors: perProduct.errors || null,
      rowCount: perProduct.q?.tableData?.rows?.length ?? 0,
      columns: perProduct.q?.tableData?.columns?.map((c: { name: string }) => c.name) ?? [],
      top3Rows: (perProduct.q?.tableData?.rows ?? []).slice(0, 3),
      storeWideTotals: totals.q?.tableData?.rows?.[0] ?? null,
      totalsParseErrors: totals.q?.parseErrors || null,
    };

    out[tf] = entry;
  }

  return NextResponse.json(out);
}
