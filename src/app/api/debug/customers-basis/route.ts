import { NextRequest, NextResponse } from 'next/server';
import { fetchShopifyCustomerSplit } from '@/src/lib/bqOverview';
import { getOverview } from '@/src/lib/bqOverview';
import { isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// Diagnostic for the new/returning customer split: Shopify's own counts for
// the range next to what the Overview reports (and which source it used).
//   /api/debug/customers-basis                      → year to date
//   /api/debug/customers-basis?from=2026-09-01&to=2026-09-16
export async function GET(request: NextRequest) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = request.nextUrl.searchParams.get('from') || `${todayStr.slice(0, 4)}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || todayStr;
  const out: Record<string, unknown> = { from, to };
  try {
    const split = await fetchShopifyCustomerSplit(from, to);
    out.shopify = split
      ? { ...split, total: split.newCustomers + split.returningCustomers,
          returningRate: Math.round((split.returningCustomers / (split.newCustomers + split.returningCustomers)) * 1000) / 10 }
      : null;
  } catch (e: unknown) { out.shopify = { error: String(e instanceof Error ? e.message : e) }; }
  if (isBigQueryConfigured()) {
    try {
      const o = await getOverview(from, to);
      const m = o.metrics;
      out.overview = {
        source: m.customerSource, newCustomers: m.newCustomers, returningCustomers: m.returningCustomers,
        pctReturning: m.pctReturning, newCustomerRevenue: m.newCustomerRevenue, returningCustomerRevenue: m.returningCustomerRevenue,
      };
    } catch (e: unknown) { out.overview = { error: String(e instanceof Error ? e.message : e) }; }
  }
  return NextResponse.json(out);
}
