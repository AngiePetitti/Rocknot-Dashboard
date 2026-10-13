import { NextRequest, NextResponse } from 'next/server';
import { marketplaces } from '@/src/lib/client';
import { shopifyql, trafficConfigured } from '@/src/lib/traffic';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const lit = (s: string) => `'${s.replace(/'/g, "\\'")}'`;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Marketplace (e.g. Nordstrom) net and total sales by month for a year, so the
// Goals tab can count them toward the annual target when asked to.
//   /api/goals/marketplaces?year=2026
export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear();
  const list = marketplaces();
  if (!list.length) return NextResponse.json({ months: {}, labels: [] }, { headers: cacheHeaders(false) });
  if (!trafficConfigured()) return NextResponse.json({ error: 'Shopify not connected', months: {}, labels: list.map(m => m.label) }, { status: 200 });
  const months: Record<string, { netSales: number; totalSales: number }> = {};
  const errors: string[] = [];
  await Promise.all(list.map(async m => {
    try {
      const rows = await shopifyql(`FROM sales SHOW net_sales, total_sales WHERE sales_channel = ${lit(m.shopifyChannel)} TIMESERIES month SINCE ${year}-01-01 UNTIL ${year}-12-31`, 20000);
      for (const r of rows) {
        const k = String(r.month || r.day || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(k)) continue;
        const cur = months[k] || { netSales: 0, totalSales: 0 };
        cur.netSales += num(r.net_sales); cur.totalSales += num(r.total_sales);
        months[k] = cur;
      }
    } catch (e) { errors.push(`${m.label}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  return NextResponse.json({ year, months, labels: list.map(m => m.label), ...(errors.length ? { errors } : {}) }, { headers: cacheHeaders(false) });
}
