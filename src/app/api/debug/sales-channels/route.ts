import { NextRequest, NextResponse } from 'next/server';
import { shopifyql } from '@/src/lib/shopifyql';
import { marketplaces } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

// Shopify sales split by sales channel — to spot channels (Amazon via
// Marketplace Connect, TikTok Shop, wholesale…) that inflate the store's
// orders and new customers and so deflate CAC. Channels listed here can be
// excluded from store figures by adding them to the profile's marketplaces.
//   /api/debug/sales-channels                      → last 30 days
//   /api/debug/sales-channels?from=2026-09-01&to=2026-09-30
export async function GET(request: NextRequest) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const d = new Date(`${todayStr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 30);
  const from = request.nextUrl.searchParams.get('from') || d.toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get('to') || todayStr;
  try {
    const rows = await shopifyql(`FROM sales SHOW orders, total_sales, net_sales, customers, new_customers, returning_customers GROUP BY sales_channel SINCE ${from} UNTIL ${to} ORDER BY orders DESC`);
    return NextResponse.json({
      from, to,
      alreadyExcluded: marketplaces().map(m => m.shopifyChannel),
      channels: rows.map(r => ({
        salesChannel: r.sales_channel,
        orders: Math.round(Number(r.orders || 0)),
        totalSales: Math.round(Number(r.total_sales || 0)),
        netSales: Math.round(Number(r.net_sales || 0)),
        customers: Math.round(Number(r.customers || 0)),
        newCustomers: Math.round(Number(r.new_customers || 0)),
        returningCustomers: Math.round(Number(r.returning_customers || 0)),
      })),
    });
  } catch (e) {
    return NextResponse.json({ from, to, error: e instanceof Error ? e.message : String(e) });
  }
}
