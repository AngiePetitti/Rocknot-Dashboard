import { NextRequest, NextResponse } from 'next/server';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

export interface ReturnedProduct {
  name: string;
  returns: number;
}

export interface ReturnTrendPoint {
  date: string;
  returns: number;
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

function colIndex(cols: { name: string }[], name: string): number {
  return cols.findIndex(c => c.name === name);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  if (!TOKEN) {
    return NextResponse.json({
      source: 'error',
      error: 'Shopify access token not configured',
      totalReturns: 0,
      grossSales: 0,
      returnRate: 0,
      trend: [],
      topReturnedProducts: [],
    });
  }

  try {
    const { from, to } = rangeForTf(tfRaw, dateFrom, dateTo);

    const [summary, trend, byProduct] = await Promise.all([
      runShopifyQL(`FROM sales SHOW gross_sales, returns SINCE ${from} UNTIL ${to}`),
      runShopifyQL(`FROM sales SHOW returns TIMESERIES day SINCE ${from} UNTIL ${to}`),
      runShopifyQL(`FROM sales SHOW returns BY product_title SINCE ${from} UNTIL ${to} LIMIT 50`),
    ]);

    for (const r of [summary, trend, byProduct]) {
      if (r?.parseErrors?.length) {
        throw new Error(r.parseErrors[0].message);
      }
    }

    const sCols = summary?.tableData?.columns || [];
    const sRow = summary?.tableData?.rowData?.[0] || [];
    const grossSales = parseFloat(sRow[colIndex(sCols, 'gross_sales')] || '0');
    const totalReturns = Math.abs(parseFloat(sRow[colIndex(sCols, 'returns')] || '0'));
    const returnRate = grossSales > 0 ? Math.round((totalReturns / grossSales) * 1000) / 10 : 0;

    const tCols = trend?.tableData?.columns || [];
    const tRows: string[][] = trend?.tableData?.rowData || [];
    const dayIdx = colIndex(tCols, 'day');
    const returnsIdx = colIndex(tCols, 'returns');
    const trendData: ReturnTrendPoint[] = tRows.map(r => ({
      date: (r[dayIdx] || '').split('T')[0],
      returns: Math.round(Math.abs(parseFloat(r[returnsIdx] || '0'))),
    }));

    const pCols = byProduct?.tableData?.columns || [];
    const pRows: string[][] = byProduct?.tableData?.rowData || [];
    const titleIdx = colIndex(pCols, 'product_title');
    const pReturnsIdx = colIndex(pCols, 'returns');
    const topReturnedProducts: ReturnedProduct[] = pRows
      .map(r => ({
        name: r[titleIdx] || 'Unknown',
        returns: Math.round(Math.abs(parseFloat(r[pReturnsIdx] || '0'))),
      }))
      .filter(p => p.name !== 'Unknown' && p.returns > 0)
      .sort((a, b) => b.returns - a.returns)
      .slice(0, 10);

    return NextResponse.json({
      source: 'shopify_live',
      totalReturns: Math.round(totalReturns),
      grossSales: Math.round(grossSales),
      returnRate,
      trend: trendData,
      topReturnedProducts,
    }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: String(err),
      totalReturns: 0,
      grossSales: 0,
      returnRate: 0,
      trend: [],
      topReturnedProducts: [],
    });
  }
}
