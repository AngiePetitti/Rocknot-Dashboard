import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Reconciles BigQuery's net_sales+shipping+tax against Shopify's reported
// Total Sales. Supports a single ?date= or a ?from=&to= range with per-day
// breakdown, so we can spot days where shipping/tax columns are NULL
// (i.e. not yet backfilled by Windsor).
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured' });
  }
  const { searchParams } = request.nextUrl;
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const single = searchParams.get('date');
  const from = single || searchParams.get('from') || addDays(todayStr, -7);
  const to = single || searchParams.get('to') || addDays(todayStr, -1);
  const ds = getDataset();

  const perDay = await runQuery<Record<string, unknown>>(`
    SELECT
      DATE(date) AS d,
      COUNT(DISTINCT order_id) AS orders,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)), 2) AS net_sales,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0)), 2) AS shipping,
      ROUND(SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)), 2) AS tax,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_refunded_price AS FLOAT64), 0)), 2) AS refunded_shipping,
      COUNTIF(order_total_shipping_price IS NULL) AS null_shipping_rows,
      COUNTIF(order_total_tax_amount IS NULL) AS null_tax_rows,
      COUNTIF(order_total_shipping_refunded_price IS NULL) AS null_refunded_rows
    FROM \`${ds}.shopify_orders\`
    WHERE DATE(date) BETWEEN @from AND @to
      AND order_id IS NOT NULL
    GROUP BY d
    ORDER BY d
  `, { from, to }).catch(e => [{ error: String(e) }]);

  const [totals] = await runQuery<Record<string, unknown>>(`
    SELECT
      COUNT(DISTINCT order_id) AS orders,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)), 2) AS net_sales,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0)), 2) AS shipping,
      ROUND(SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)), 2) AS tax,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_refunded_price AS FLOAT64), 0)), 2) AS refunded_shipping,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)) + SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0)) + SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)) - SUM(IFNULL(CAST(order_total_shipping_refunded_price AS FLOAT64), 0)), 2) AS computed_total_sales
    FROM \`${ds}.shopify_orders\`
    WHERE DATE(date) BETWEEN @from AND @to
      AND order_id IS NOT NULL
  `, { from, to }).catch(e => [{ error: String(e) }]);

  return NextResponse.json({ from, to, totals, perDay });
}
