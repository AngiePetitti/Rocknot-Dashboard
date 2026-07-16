import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { mtdRange } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

export interface ProductSales {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
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
  if (tfRaw === 'mtd') {
    const r = mtdRange(todayStr, yesterdayStr);
    return { from: r.from, to: r.to };
  }
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

    if (searchParams.get('debug') === 'true' && isBigQueryConfigured()) {
      const hasBqProducts = await tableExists('shopify_products');
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

    // Products come straight from ShopifyQL — the source of truth that has
    // category, COGS and gross profit per product. (The Windsor-synced
    // shopify_products BigQuery table has no cost data and is not used here.)

    // Per-product breakdown (top 50) plus a store-wide aggregate so the
    // "Total Revenue" card and "% of total" reflect ALL products, not just
    // the top 50 shown in the table.
    const [result, totalsResult] = await Promise.all([
      runShopifyQL(
        `FROM sales SHOW net_sales, orders, cost_of_goods_sold, gross_profit GROUP BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 50`
      ),
      runShopifyQL(
        `FROM sales SHOW net_sales, orders, gross_profit SINCE ${from} UNTIL ${to}`
      ),
    ]);

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
      .map((r, i) => {
        const revenue = Math.round(parseFloat(cell(r, 'net_sales') || '0'));
        const cogs = Math.round(parseFloat(cell(r, 'cost_of_goods_sold') || '0'));
        const grossProfit = Math.round(parseFloat(cell(r, 'gross_profit') || '0'));
        return {
          id: String(i),
          name: cell(r, 'product_title') || 'Unknown',
          category: cell(r, 'product_type') || 'Other',
          unitsSold: Math.round(parseFloat(cell(r, 'orders') || '0')),
          revenue,
          cogs,
          grossProfit,
          grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
          percentOfTotal: 0,
        };
      })
      .filter(p => p.name && p.name !== 'Unknown' && p.revenue > 0);

    // Store-wide totals (all products) from the aggregate query. Fall back to
    // the top-50 sum if the aggregate is missing for any reason.
    const tCols = totalsResult?.tableData?.columns || [];
    const tRows: Array<Record<string, string> | string[]> = totalsResult?.tableData?.rows || [];
    const tCell = (name: string): string => {
      const r = tRows[0];
      if (!r) return '';
      if (Array.isArray(r)) {
        const i = tCols.findIndex((c: { name: string }) => c.name === name);
        return i >= 0 ? (r[i] ?? '') : '';
      }
      return r[name] ?? '';
    };

    const top50Revenue = products.reduce((s, p) => s + p.revenue, 0);
    const top50Units = products.reduce((s, p) => s + p.unitsSold, 0);
    const top50GrossProfit = products.reduce((s, p) => s + p.grossProfit, 0);

    const totalRevenue = Math.round(parseFloat(tCell('net_sales') || '0')) || top50Revenue;
    const totalUnits = Math.round(parseFloat(tCell('orders') || '0')) || top50Units;
    const totalGrossProfit = Math.round(parseFloat(tCell('gross_profit') || '0')) || top50GrossProfit;

    // "% of total" is each product's share of the full store net sales.
    for (const p of products) {
      p.percentOfTotal = totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 1000) / 10 : 0;
    }

    return NextResponse.json(
      { source: 'shopify_live', products, totalRevenue, totalUnits, totalGrossProfit },
      { headers: cacheHeaders(tfRaw === 'today') }
    );
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), products: [], totalRevenue: 0, totalUnits: 0 });
  }
}
