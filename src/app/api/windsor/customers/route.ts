import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getCustomerMetrics, getCohortData } from '@/src/lib/bqCustomers';
import { CustomerMetrics } from '@/src/lib/mockData';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { mtdRange } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';

const SHOPIFY_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

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
  return { from: addDays(todayStr, -30), to: todayStr };
}

interface ShopifyCustomerTotals {
  customers: number;
  returningCustomers: number;
  returningRate: number; // percent
}

// Returning-customer rate straight from Shopify so the headline matches
// Shopify's own Customers report for the selected timeframe exactly.
async function fetchShopifyCustomers(from: string, to: string): Promise<ShopifyCustomerTotals | null> {
  if (!SHOPIFY_TOKEN) return null;
  const ql = `FROM sales SHOW customers, returning_customers, returning_customer_rate SINCE ${from} UNTIL ${to}`;
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
        tableData { rows columns { name } }
        parseErrors
      }}`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const r = (q?.tableData?.rows || [])[0] as Record<string, string> | string[] | undefined;
  if (!r) return null;
  const cell = (name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return {
    customers: Math.round(parseFloat(cell('customers') || '0')),
    returningCustomers: Math.round(parseFloat(cell('returning_customers') || '0')),
    // Shopify returns a fraction (0.409…); convert to a percentage.
    returningRate: Math.round(parseFloat(cell('returning_customer_rate') || '0') * 1000) / 10,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const { from, to } = rangeForTf(tfRaw, dateFrom, dateTo);

  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'error', error: 'BigQuery not configured', customerMetrics: null, cohortData: null });
  }

  const [bq, shopify, cohortData] = await Promise.all([
    getCustomerMetrics(from, to).catch(() => null),
    fetchShopifyCustomers(from, to).catch(() => null),
    getCohortData(from, to).catch(() => []),
  ]);

  if (!bq) {
    return NextResponse.json({ source: 'error', error: 'Customer query failed', customerMetrics: null, cohortData: null });
  }

  // Prefer Shopify's customer counts/returning rate; fall back to BigQuery's
  // active-customer count if Shopify is unavailable (rate then unknown).
  const totalCustomers = shopify?.customers ?? bq.activeCustomers;
  const repeatCustomers = shopify?.returningCustomers ?? 0;
  const repeatPurchaserRate = shopify?.returningRate
    ?? (totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0);

  const customerMetrics: CustomerMetrics = {
    repeatPurchaserRate,
    avgLTV: bq.avgLTV,
    firstOrderAvg: bq.firstOrderAvg,
    secondOrderAvg: bq.secondOrderAvg,
    thirdPlusOrderAvg: bq.thirdPlusOrderAvg,
    totalCustomers,
    repeatCustomers,
    activeCustomers: bq.activeCustomers,
    oneOrderCount: bq.oneOrderCount,
    twoOrderCount: bq.twoOrderCount,
    threePlusCount: bq.threePlusCount,
    ltvOneOrder: bq.ltvOneOrder,
    ltvTwoOrders: bq.ltvTwoOrders,
    ltvThreePlus: bq.ltvThreePlus,
  };

  return NextResponse.json(
    { source: 'bigquery_live', customerMetrics, cohortData },
    { headers: cacheHeaders() },
  );
}
