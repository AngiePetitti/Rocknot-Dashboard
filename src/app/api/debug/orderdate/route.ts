import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Compares two attribution methods for a single day's Total Sales:
//   A) by-row-date  : SUM of fields where the ROW date = target (current method)
//   B) by-order-date: group by order_id, attribute the order's summed value to
//      its FIRST (placement) date — captures later refund rows on the order date,
//      matching how Shopify's Total Sales report rolls returns back to order date.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) return NextResponse.json({ error: 'BigQuery not configured' });
  const { searchParams } = request.nextUrl;
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const date = searchParams.get('date') || addDays(todayStr, -1);
  const ds = getDataset();

  // Method A: by row date
  const [byRowDate] = await runQuery<Record<string, unknown>>(`
    SELECT
      COUNT(DISTINCT order_id) AS orders,
      ROUND(SUM(CAST(order_net_sales AS FLOAT64)), 2) AS net_sales,
      ROUND(SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64),0)) - SUM(IFNULL(CAST(order_total_shipping_refunded_price AS FLOAT64),0)), 2) AS net_shipping,
      ROUND(SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64),0)), 2) AS tax
    FROM \`${ds}.shopify_orders\`
    WHERE DATE(date) = @date AND order_id IS NOT NULL
  `, { date }).catch(e => [{ error: String(e) }]);

  // Method B: by order (placement) date — sum all of an order's rows, place on MIN date
  const [byOrderDate] = await runQuery<Record<string, unknown>>(`
    WITH per_order AS (
      SELECT
        order_id,
        MIN(DATE(date)) AS order_date,
        SUM(CAST(order_net_sales AS FLOAT64)) AS net_sales,
        SUM(IFNULL(CAST(order_total_shipping_price AS FLOAT64),0)) - SUM(IFNULL(CAST(order_total_shipping_refunded_price AS FLOAT64),0)) AS net_shipping,
        -- tax: take the order's first-row tax (avoid double counting if repeated on refund rows)
        (ARRAY_AGG(IFNULL(CAST(order_total_tax_amount AS FLOAT64),0) ORDER BY date ASC LIMIT 1))[OFFSET(0)] AS tax_first,
        SUM(IFNULL(CAST(order_total_tax_amount AS FLOAT64),0)) AS tax_sum
      FROM \`${ds}.shopify_orders\`
      WHERE order_id IS NOT NULL
      GROUP BY order_id
    )
    SELECT
      COUNT(*) AS orders,
      ROUND(SUM(net_sales), 2) AS net_sales,
      ROUND(SUM(net_shipping), 2) AS net_shipping,
      ROUND(SUM(tax_first), 2) AS tax_first,
      ROUND(SUM(tax_sum), 2) AS tax_sum
    FROM per_order
    WHERE order_date = @date
  `, { date }).catch(e => [{ error: String(e) }]);

  return NextResponse.json({ date, byRowDate, byOrderDate });
}
