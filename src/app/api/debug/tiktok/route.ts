import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// One-off probe: which tiktok_ads columns carry purchase value? complete_payment
// gives a count but complete_payment_value sums to 0, so revenue/ROAS are blank.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) return NextResponse.json({ error: 'bq not configured' });
  const ds = getDataset();
  const from = request.nextUrl.searchParams.get('from') || '2026-06-10';
  const to = request.nextUrl.searchParams.get('to') || '2026-06-17';

  const cols = await runQuery(`
    SELECT column_name, data_type
    FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
    WHERE table_name = 'tiktok_ads'
    ORDER BY ordinal_position
  `).catch(e => [{ error: String(e) }]);

  // Sum every numeric-looking column that could hold purchase value, so we can
  // see which one is actually populated for the period.
  const candidates = [
    'complete_payment_value', 'complete_payment',
    'onsite_total_purchase_value', 'onsite_total_purchase',
    'total_complete_payment_rate', 'total_onsite_shopping_value',
    'total_purchase_value', 'purchase_value', 'conversion_value', 'revenue',
    'total_complete_payment', 'value_per_complete_payment',
  ];
  const sums: Record<string, unknown> = {};
  for (const c of candidates) {
    sums[c] = await runQuery(`
      SELECT ROUND(SUM(CAST(${c} AS FLOAT64)), 2) AS total
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) BETWEEN @from AND @to
    `, { from, to }).then(r => (r[0] as { total: unknown })?.total).catch(() => 'no_column');
  }

  return NextResponse.json({ from, to, columns: cols, sums });
}
