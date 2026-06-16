import { NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured' });
  }
  const ds = getDataset();

  const [columns, totals, sample] = await Promise.all([
    runQuery(`
      SELECT column_name, data_type
      FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'facebook_ads'
      ORDER BY ordinal_position
    `).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT
        COUNT(*) AS total_rows,
        MIN(DATE(date)) AS earliest,
        MAX(DATE(date)) AS latest,
        ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS total_spend,
        COUNTIF(impressions IS NOT NULL) AS rows_with_impressions,
        COUNTIF(actions_omni_purchase IS NOT NULL) AS rows_with_actions_omni_purchase,
        COUNTIF(action_values_omni_purchase IS NOT NULL) AS rows_with_action_values_omni_purchase
      FROM \`${ds}.facebook_ads\`
    `).catch(e => [{ error: String(e) }]),
    runQuery(`SELECT * FROM \`${ds}.facebook_ads\` ORDER BY date DESC LIMIT 3`
    ).catch(e => [{ error: String(e) }]),
  ]);

  return NextResponse.json({ columns, totals, sample });
}
