import { NextRequest, NextResponse } from 'next/server';
import { getRevenueForTimeframe, getMetricsForTimeframe, shopifyLast30Days } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com';

const SINCE_MAP: Record<Timeframe, string> = {
  today:      'today',
  yesterday:  '-1d',
  '7d':       '-7d',
  '14d':      '-14d',
  '30d':      '-30d',
  mtd:        '-30d',
  last_month: '-60d',
  '6m':       '-180d',
  ytd:        '-365d',
};

const UNTIL_MAP: Record<Timeframe, string> = {
  today:      'today',
  yesterday:  'yesterday',
  '7d':       'today',
  '14d':      'today',
  '30d':      'today',
  mtd:        'yesterday',
  last_month: '-30d',
  '6m':       'today',
  ytd:        'today',
};

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
    next: { revalidate: 0 }, // always fresh
  });
  const json = await res.json();
  return json?.data?.shopifyqlQuery;
}

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;

  if (!TOKEN) {
    const metrics = getMetricsForTimeframe(tf);
    const revenueData = getRevenueForTimeframe(tf);
    return NextResponse.json({ source: 'mock', timeframe: tf, metrics, revenueData });
  }

  try {
    const since = SINCE_MAP[tf];
    const until = UNTIL_MAP[tf];

    // Summary metrics
    const summary = await runShopifyQL(
      `FROM sales SHOW gross_sales, discounts, returns, net_sales, orders, average_order_value SINCE ${since} UNTIL ${until}`
    );

    // Daily trend (cap at 30 days for chart)
    const trendDays = ['today', 'yesterday'].includes(tf) ? 1 : 30;
    const trend = await runShopifyQL(
      `FROM sales SHOW net_sales, orders TIMESERIES day SINCE -${trendDays}d UNTIL today`
    );

    if (typeof summary?.parseErrors === 'string' && summary.parseErrors) {
      throw new Error(summary.parseErrors);
    }

    const row = summary?.tableData?.rows?.[0] || [];
    const cols = summary?.tableData?.columns || [];
    const get = (name: string) => {
      if (Array.isArray(row)) {
        const idx = cols.findIndex((c: {name: string}) => c.name === name);
        return idx >= 0 ? parseFloat(row[idx] || '0') : 0;
      }
      return parseFloat((row as Record<string, string>)[name] || '0');
    };

    const netSales = get('net_sales');
    const orders = get('orders');
    const aov = get('average_order_value');
    const returns = Math.abs(get('returns'));

    // Build daily revenue array from trend data
    const trendRows: Array<Record<string, string> | string[]> = trend?.tableData?.rows || [];
    const trendCols = trend?.tableData?.columns || [];
    const tCell = (r: Record<string, string> | string[], name: string): string => {
      if (Array.isArray(r)) {
        const i = trendCols.findIndex((c: {name: string}) => c.name === name);
        return i >= 0 ? (r[i] ?? '') : '';
      }
      return r[name] ?? '';
    };

    const revenueData = trendRows.map((r) => ({
      date: tCell(r, 'day')?.split('T')[0] || '',
      revenue: Math.round(parseFloat(tCell(r, 'net_sales') || '0')),
      orders: parseInt(tCell(r, 'orders') || '0'),
      adSpend: Math.round(parseFloat(tCell(r, 'net_sales') || '0') / 3.5), // estimated until ad APIs connected
    }));

    // Merge with historical data for chart continuity
    const historicalDates = new Set(revenueData.map((d: {date: string}) => d.date));
    const historical = shopifyLast30Days.filter(d => !historicalDates.has(d.date));
    const mergedRevenue = [...historical, ...revenueData].slice(-30);

    const totalAdSpend = mergedRevenue.reduce((s: number, d: {adSpend: number}) => s + d.adSpend, 0);
    const mer = totalAdSpend > 0 ? netSales / totalAdSpend : 0;

    return NextResponse.json({
      source: 'shopify_live',
      timeframe: tf,
      metrics: {
        totalRevenue: Math.round(netSales),
        totalOrders: Math.round(orders),
        totalAdSpend: Math.round(totalAdSpend),
        aov: Math.round(aov * 100) / 100,
        mer: Math.round(mer * 100) / 100,
        returns: Math.round(returns),
      },
      revenueData: mergedRevenue,
    });

  } catch (err) {
    // Fall back to static data on error
    const metrics = getMetricsForTimeframe(tf);
    const revenueData = getRevenueForTimeframe(tf);
    return NextResponse.json({
      source: 'mock_fallback',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      metrics,
      revenueData,
    });
  }
}
