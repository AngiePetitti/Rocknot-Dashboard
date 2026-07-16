import { NextRequest, NextResponse } from 'next/server';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { mtdRange } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

export interface ReturnedProduct {
  name: string;
  category: string;
  grossSales: number;
  returns: number;  // positive dollar value
  netSales: number;
  returnRate: number; // returns / grossSales %
}

export interface ReturnTrendPoint {
  date: string;
  returns: number;
}

export interface CategoryReturn {
  category: string;
  returns: number;
  grossSales: number;
  returnRate: number;
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
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData { rows columns { name dataType } }
        parseErrors
      }}`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return { rows, cell };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  if (!TOKEN) {
    return NextResponse.json({ source: 'error', error: 'Shopify token not configured' });
  }

  try {
    const { from, to } = rangeForTf(tfRaw, dateFrom, dateTo);

    // Use monthly timeseries for multi-month ranges, daily for short ones
    const tsTz = (to > from && (new Date(to).getTime() - new Date(from).getTime()) / 86400000 > 60)
      ? 'month' : 'day';
    const tsField = tsTz === 'month' ? 'month' : 'day';

    const [summary, trend, byProduct, byCategory] = await Promise.all([
      runShopifyQL(`FROM sales SHOW gross_sales, returns, net_sales SINCE ${from} UNTIL ${to}`),
      runShopifyQL(`FROM sales SHOW returns TIMESERIES ${tsTz} SINCE ${from} UNTIL ${to}`),
      runShopifyQL(`FROM sales SHOW gross_sales, returns, net_sales GROUP BY product_title, product_type SINCE ${from} UNTIL ${to} ORDER BY returns ASC LIMIT 50`),
      runShopifyQL(`FROM sales SHOW gross_sales, returns GROUP BY product_type SINCE ${from} UNTIL ${to} ORDER BY returns ASC`),
    ]);

    // Summary
    const sRow = summary.rows[0];
    const grossSales = parseFloat(summary.cell(sRow, 'gross_sales') || '0');
    const totalReturns = Math.abs(parseFloat(summary.cell(sRow, 'returns') || '0'));
    const netSales = parseFloat(summary.cell(sRow, 'net_sales') || '0');
    const returnRate = grossSales > 0 ? Math.round((totalReturns / grossSales) * 1000) / 10 : 0;

    // Trend
    const trendData: ReturnTrendPoint[] = trend.rows.map(r => ({
      date: (trend.cell(r, tsField) || '').split('T')[0],
      returns: Math.round(Math.abs(parseFloat(trend.cell(r, 'returns') || '0'))),
    }));

    // By product — only products with actual returns, with return rate
    const topReturnedProducts: ReturnedProduct[] = byProduct.rows
      .filter(r => {
        const name = byProduct.cell(r, 'product_title');
        const ret = parseFloat(byProduct.cell(r, 'returns') || '0');
        return name && ret < 0; // returns are negative in ShopifyQL
      })
      .map(r => {
        const gs = Math.abs(parseFloat(byProduct.cell(r, 'gross_sales') || '0'));
        const ret = Math.abs(parseFloat(byProduct.cell(r, 'returns') || '0'));
        const ns = parseFloat(byProduct.cell(r, 'net_sales') || '0');
        return {
          name: byProduct.cell(r, 'product_title'),
          category: byProduct.cell(r, 'product_type') || 'Other',
          grossSales: Math.round(gs),
          returns: Math.round(ret),
          netSales: Math.round(ns),
          returnRate: gs > 0 ? Math.round((ret / gs) * 1000) / 10 : 100,
        };
      })
      .sort((a, b) => b.returns - a.returns)
      .slice(0, 20);

    // By category
    const categoryBreakdown: CategoryReturn[] = byCategory.rows
      .filter(r => {
        const cat = byCategory.cell(r, 'product_type');
        const ret = parseFloat(byCategory.cell(r, 'returns') || '0');
        return cat && ret < 0;
      })
      .map(r => {
        const gs = Math.abs(parseFloat(byCategory.cell(r, 'gross_sales') || '0'));
        const ret = Math.abs(parseFloat(byCategory.cell(r, 'returns') || '0'));
        return {
          category: byCategory.cell(r, 'product_type') || 'Other',
          grossSales: Math.round(gs),
          returns: Math.round(ret),
          returnRate: gs > 0 ? Math.round((ret / gs) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.returns - a.returns);

    return NextResponse.json({
      source: 'shopify_live',
      totalReturns: Math.round(totalReturns),
      grossSales: Math.round(grossSales),
      netSales: Math.round(netSales),
      returnRate,
      trend: trendData,
      tsField,
      topReturnedProducts,
      categoryBreakdown,
    }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err) });
  }
}
