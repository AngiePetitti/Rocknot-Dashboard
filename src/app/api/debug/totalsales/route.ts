import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Reconciles BigQuery's net_sales+shipping+tax against Shopify's reported
// Total Sales for a single day, to isolate where any gap comes from.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured' });
  }
  const { searchParams } = request.nextUrl;
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const date = searchParams.get('date') || addDays(todayStr, -1);
  const ds = getDataset();

  const [rows] = await runQuery<Record<string, unknown>>(`
    SELECT
      COUNT(*) AS row_count,
      COUNT(DISTINCT order_id) AS distinct_orders,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)), 2) AS sum_net_sales,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0)), 2) AS sum_shipping,
      ROUND(SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)), 2) AS sum_tax,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)) + SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64), 0)) + SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64), 0)), 2) AS computed_total_sales,
      COUNTIF(order_total_shipping_price IS NULL) AS null_shipping_rows,
      COUNTIF(order_total_tax_amount IS NULL) AS null_tax_rows
    FROM \`${ds}.shopify_orders\`
    WHERE DATE(date) = @date
      AND order_id IS NOT NULL
  `, { date }).catch(e => [{ error: String(e) }]);

  const sample = await runQuery<Record<string, unknown>>(`
    SELECT order_id, order_net_sales, order_total_shipping_price, order_total_tax_amount, order_total_price
    FROM \`${ds}.shopify_orders\`
    WHERE DATE(date) = @date
    ORDER BY order_id
    LIMIT 10
  `, { date }).catch(e => [{ error: String(e) }]);

  return NextResponse.json({ date, summary: rows, sample });
}
