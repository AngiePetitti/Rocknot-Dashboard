import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { getProductSales } from '@/src/lib/bqProducts';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com';

export interface ProductSales {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  percentOfTotal: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function rangeForTf(tfRaw: string, dateFrom: string, dateTo: string): { from: string; to: string } {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayStr = addDays(todayStr, -1);

  if (tfRaw === 'custom' && dateFrom && dateTo) return { from: dateFrom, to: dateTo };
  if (tfRaw === 'today') return { from: todayStr, to: todayStr };
  if (tfRaw === 'yesterday') return { from: yesterdayStr, to: yesterdayStr };
  if (tfRaw === '7d') return { from: addDays(todayStr, -7), to: yesterdayStr };
  if (tfRaw === '14d') return { from: addDays(todayStr, -14), to: yesterdayStr };
  if (tfRaw === '30d') return { from: addDays(todayStr, -30), to: yesterdayStr };
  if (tfRaw === '6m') return { from: addDays(todayStr, -180), to: yesterdayStr };
  if (tfRaw === 'ytd') return { from: `${todayStr.split('-')[0]}-01-01`, to: yesterdayStr };
  if (tfRaw === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    return {
      from: new Date(y, m - 2, 1).toLocaleDateString('en-CA'),
      to: new Date(y, m - 1, 0).toLocaleDateString('en-CA'),
    };
  }
  return { from: addDays(todayStr, -30), to: yesterdayStr };
}

async function runShopifyQL(query: string) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN!,
    },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData {
          rowData
          columns { name dataType }
        }
        parseErrors { code message }
      }}`,
    }),
    next: { revalidate: 0 },
  });
  const json = await res.json();
  return json?.data?.shopifyqlQuery;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  if (!TOKEN) {
    return NextResponse.json({ source: 'error', error: 'Shopify access token not configured', products: [], totalRevenue: 0, totalUnits: 0 });
  }

  try {
    const { from, to } = rangeForTf(tfRaw, dateFrom, dateTo);

    // BigQuery path — uses Windsor-synced shopify_products table
    const hasBqProducts = isBigQueryConfigured() && await tableExists('shopify_products');

    if (searchParams.get('debug') === 'true' && isBigQueryConfigured()) {
      const { runQuery, getDataset } = await import('@/src/lib/bigquery');
      const ds = getDataset();
      const cols = hasBqProducts ? await runQuery(`
        SELECT column_name, data_type
        FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
        WHERE table_name = 'shopify_products'
        ORDER BY ordinal_position
      `).catch(e => [{ error: String(e) }]) : [];
      const sample = hasBqProducts ? await runQuery(`
        SELECT * FROM \`${ds}.shopify_products\` LIMIT 3
      `).catch(e => [{ error: String(e) }]) : [];
      const withTitle = hasBqProducts ? await runQuery(`
        SELECT * FROM \`${ds}.shopify_products\` WHERE line_item__title IS NOT NULL LIMIT 3
      `).catch(e => [{ error: String(e) }]) : [];
      const counts = hasBqProducts ? await runQuery(`
        SELECT COUNT(*) AS total_rows,
               COUNTIF(line_item__title IS NOT NULL) AS rows_with_title,
               COUNTIF(line_item__price > 0) AS rows_with_price
        FROM \`${ds}.shopify_products\`
      `).catch(e => [{ error: String(e) }]) : [];
      return NextResponse.json({ hasBqProducts, columns: cols, sample, withTitle, counts, from, to });
    }

    if (hasBqProducts) {
      const { products, totalRevenue, totalUnits } = await getProductSales(from, to);
      return NextResponse.json({ source: 'shopify_live', products, totalRevenue, totalUnits }, { headers: cacheHeaders(tfRaw === 'today') });
    }

    const result = await runShopifyQL(
      `FROM sales SHOW net_sales, net_quantity BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 50`
    );

    if (result?.parseErrors?.length) {
      throw new Error(result.parseErrors[0].message);
    }

    const cols = result?.tableData?.columns || [];
    const rows: string[][] = result?.tableData?.rowData || [];
    const idx = (name: string) => cols.findIndex((c: { name: string }) => c.name === name);
    const titleIdx = idx('product_title');
    const typeIdx = idx('product_type');
    const salesIdx = idx('net_sales');
    const qtyIdx = idx('net_quantity');

    const products: ProductSales[] = rows
      .map((r, i) => ({
        id: String(i),
        name: r[titleIdx] || 'Unknown',
        category: r[typeIdx] || 'Other',
        unitsSold: Math.round(parseFloat(r[qtyIdx] || '0')),
        revenue: Math.round(parseFloat(r[salesIdx] || '0')),
        percentOfTotal: 0,
      }))
      .filter(p => p.name && p.name !== 'Unknown' && p.revenue > 0);

    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalUnits = products.reduce((s, p) => s + p.unitsSold, 0);
    for (const p of products) {
      p.percentOfTotal = totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 1000) / 10 : 0;
    }

    return NextResponse.json({ source: 'shopify_live', products, totalRevenue, totalUnits }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), products: [], totalRevenue: 0, totalUnits: 0 });
  }
}
