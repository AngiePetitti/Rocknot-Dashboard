import { NextRequest, NextResponse } from 'next/server';
import { shopifyDomain } from '@/src/lib/client';
import { isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { mtdRange } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = shopifyDomain();

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

// Live fallback for "Today": ShopifyQL's sales dataset lags behind live
// orders (often by an hour+), so early in the day it reports zero product
// sales while the store is actively selling. This walks today's actual
// orders and aggregates line items instead. COGS/gross profit aren't
// available per line item live, so those stay blank until QL catches up.
async function fetchTodayLineItems(from: string): Promise<{
  products: ProductSales[];
  variants: Array<{ product: string; variant: string; revenue: number; unitsSold: number }>;
  totalRevenue: number;
  totalUnits: number;
} | null> {
  type Agg = { units: number; revenue: number };
  const byProduct = new Map<string, Agg>();
  const byVariant = new Map<string, Agg>();
  let cursor: string | null = null;
  let orderCount = 0;

  for (let page = 0; page < 6; page++) {
    const query: string = `{
      orders(first: 100${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}, query: ${JSON.stringify(`created_at:>=${from} -status:cancelled`)}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          lineItems(first: 50) {
            nodes {
              title
              variantTitle
              quantity
              discountedTotalSet { shopMoney { amount } }
            }
          }
        }
      }
    }`;
    const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN! },
      body: JSON.stringify({ query }),
      next: { revalidate: 0 },
    });
    const json = await res.json();
    const orders = json?.data?.orders;
    if (!orders) return null;
    for (const o of orders.nodes || []) {
      orderCount++;
      for (const li of o?.lineItems?.nodes || []) {
        const title = li?.title || 'Unknown';
        const amount = Number(li?.discountedTotalSet?.shopMoney?.amount || 0);
        const qty = Number(li?.quantity || 0);
        const p = byProduct.get(title) || { units: 0, revenue: 0 };
        p.units += qty; p.revenue += amount;
        byProduct.set(title, p);
        const vt = (li?.variantTitle || '').replace(/^Default Title$/i, '');
        const vKey = `${title}||${vt}`;
        const v = byVariant.get(vKey) || { units: 0, revenue: 0 };
        v.units += qty; v.revenue += amount;
        byVariant.set(vKey, v);
      }
    }
    if (!orders.pageInfo?.hasNextPage) break;
    cursor = orders.pageInfo.endCursor;
  }
  if (orderCount === 0) return null;

  const totalRevenue = Math.round(Array.from(byProduct.values()).reduce((s, a) => s + a.revenue, 0));
  const totalUnits = Array.from(byProduct.values()).reduce((s, a) => s + a.units, 0);
  const products: ProductSales[] = Array.from(byProduct.entries())
    .map(([name, a], i) => ({
      id: String(i), name, category: 'Other',
      unitsSold: a.units, revenue: Math.round(a.revenue),
      cogs: 0, grossProfit: 0, grossMargin: 0,
      percentOfTotal: totalRevenue > 0 ? Math.round((a.revenue / totalRevenue) * 1000) / 10 : 0,
    }))
    .filter(p => p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 50);
  const variants = Array.from(byVariant.entries())
    .map(([key, a]) => {
      const [product, variant] = key.split('||');
      return { product, variant, revenue: Math.round(a.revenue), unitsSold: a.units };
    })
    .filter(v => v.product && v.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 300);
  return { products, variants, totalRevenue, totalUnits };
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
    const [result, totalsResult, variantsResult] = await Promise.all([
      runShopifyQL(
        `FROM sales SHOW net_sales, orders, cost_of_goods_sold, gross_profit GROUP BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 50`
      ),
      runShopifyQL(
        `FROM sales SHOW net_sales, orders, gross_profit SINCE ${from} UNTIL ${to}`
      ),
      // Variant-level (size/color) performance for the drill-down.
      runShopifyQL(
        `FROM sales SHOW net_sales, orders GROUP BY product_title, product_variant_title SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT 300`
      ).catch(() => null),
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

    // Variant rows: keyed to their parent product for the table drill-down,
    // plus a store-wide top list ("which size/color is winning overall").
    const vCols = variantsResult?.tableData?.columns || [];
    const vRows: Array<Record<string, string> | string[]> = variantsResult?.tableData?.rows || [];
    const vCell = (r: Record<string, string> | string[], name: string): string => {
      if (Array.isArray(r)) {
        const i = vCols.findIndex((c: { name: string }) => c.name === name);
        return i >= 0 ? (r[i] ?? '') : '';
      }
      return r[name] ?? '';
    };
    const variants = vRows
      .map(r => ({
        product: vCell(r, 'product_title') || '',
        variant: (vCell(r, 'product_variant_title') || '').replace(/^Default Title$/i, ''),
        revenue: Math.round(parseFloat(vCell(r, 'net_sales') || '0')),
        unitsSold: Math.round(parseFloat(vCell(r, 'orders') || '0')),
      }))
      .filter(v => v.product && v.revenue > 0);

    // ShopifyQL's analytics tables lag live orders — when a range that
    // includes today comes back empty (or clearly under-reports), rebuild
    // today's product sales from actual live orders instead of showing $0.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (to >= todayStr && from === todayStr && (products.length === 0 || totalRevenue === 0)) {
      const live = await fetchTodayLineItems(from).catch(() => null);
      if (live && live.totalRevenue > 0) {
        return NextResponse.json(
          { source: 'shopify_orders_live', ...live, totalGrossProfit: 0 },
          { headers: cacheHeaders(true) }
        );
      }
    }

    return NextResponse.json(
      { source: 'shopify_live', products, variants, totalRevenue, totalUnits, totalGrossProfit },
      { headers: cacheHeaders(tfRaw === 'today') }
    );
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), products: [], totalRevenue: 0, totalUnits: 0 });
  }
}
