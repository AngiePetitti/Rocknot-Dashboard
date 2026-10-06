import { NextRequest, NextResponse } from 'next/server';
import { runShopifyQLRaw } from '@/src/lib/shopifyql';
import { storeOnlyWhere } from '@/src/lib/client';
import { timeframeRange } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';
import { fetchNcac } from '@/src/lib/ncac';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only: raw ShopifyQL output behind the new-customer CAC card, so the
// column names / row shape Shopify actually returns can be seen.
//   /api/debug/ncac?tf=last_month
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || 'last_month') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  const where = storeOnlyWhere();
  const range = `SINCE ${from} UNTIL ${to}`;
  const queries: Record<string, string> = {
    utmAndReferrer: `FROM sales SHOW orders, customers, returning_customers GROUP BY utm_campaign_source, utm_campaign_medium, order_referrer_source, order_referrer_name ${where} ${range} ORDER BY orders DESC LIMIT 25`,
    referrerOnly: `FROM sales SHOW orders, customers, returning_customers GROUP BY order_referrer_source, order_referrer_name ${where} ${range} ORDER BY orders DESC LIMIT 25`,
    referrerOrdersOnly: `FROM sales SHOW orders, net_sales GROUP BY order_referrer_source, order_referrer_name ${where} ${range} ORDER BY orders DESC LIMIT 10`,
    totals: `FROM sales SHOW orders, customers, returning_customers ${where} ${range}`,
  };
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), range: { from, to }, where };
  for (const [k, ql] of Object.entries(queries)) {
    try {
      const r = await runShopifyQLRaw(ql, { timeoutMs: 20000, ttlSeconds: 30 });
      out[k] = { ql, columns: r.columns, rowCount: r.rows.length, rows: r.rows.slice(0, 12) };
    } catch (e) {
      out[k] = { ql, error: e instanceof Error ? e.message : String(e) };
    }
  }
  try { out.computed = await fetchNcac(from, to); } catch (e) { out.computed = { error: e instanceof Error ? e.message : String(e) }; }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
