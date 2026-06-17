import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { getProductSales } from '@/src/lib/bqProducts';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

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
  if (tfRaw === '7d') return { from: addDays(todayStr, -7), to: todayStr };
  if (tfRaw === '14d') return { from: addDays(todayStr, -14), to: todayStr };
  if (tfRaw === '30d') return { from: addDays(todayStr, -30), to: todayStr };
  if (tfRaw === '6m') return { from: addDays(todayStr, -180), to: todayStr };
  if (tfRaw === 'ytd') return { from: `${todayStr.split('-')[0]}-01-01`, to: todayStr };
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
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN!,
    },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData {
          rows
          columns { name dataType }
        }
        parseErrors
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
      const bqResult = await getProductSales(from, to).catch(() => null);
      // Only use BigQuery if it actually returned products. The shopify_products
      // table can be empty/stale (e.g. not synced for recent days), in which case
      // we fall through to ShopifyQL — the source of truth that always has data.
      if (bqResult && bqResult.products.length > 0) {
        const { products, totalRevenue, totalUnits } = bqResult;
        return NextResponse.json({ source: 'shopify_live', products, totalRevenue, totalUnits }, { headers: cacheHeaders(tfRaw === 'today') });
      }
      // BigQuery table empty or query failed — fall through to ShopifyQL
    }

    const result = await runShopifyQL(
      `FROM sales SHOW net_sales, orders GROUP BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 50`
    );

    if (typeof result?.parseErrors === 'string' && result.parseErrors) {
      throw new Error(result.parseErrors);
    }

    const cols = result?.tableData?.columns || [];
    // Live Admin API returns rows as objects keyed by column name; support
    // positional arrays too for safety.
    const rows: Array<Record<string, string> | string[]> = result?.tableData?.rows || [];
    const cell = (r: Record<string, string> | string[], name: string): string => {
      if (Array.isArray(r)) {
        const i = cols.findIndex((c: { name: string }) => c.name === name);
        return i >= 0 ? (r[i] ?? '') : '';
      }
      return r[name] ?? '';
    };

    const products: ProductSales[] = rows
      .map((r, i) => ({
        id: String(i),
        name: cell(r, 'product_title') || 'Unknown',
        category: cell(r, 'product_type') || 'Other',
        unitsSold: Math.round(parseFloat(cell(r, 'orders') || '0')),
        revenue: Math.round(parseFloat(cell(r, 'net_sales') || '0')),
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
