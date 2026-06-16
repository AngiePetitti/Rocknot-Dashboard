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
      WHERE table_name = 'tiktok_ads'
      ORDER BY ordinal_position
    `).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT
        COUNT(*) AS total_rows,
        MIN(DATE(date)) AS earliest,
        MAX(DATE(date)) AS latest,
        ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS total_spend,
        COUNTIF(onsite_total_purchase_value IS NOT NULL) AS rows_with_purchase_value,
        ROUND(SUM(CAST(IFNULL(onsite_total_purchase_value, '0') AS FLOAT64)), 2) AS total_purchase_value
      FROM \`${ds}.tiktok_ads\`
    `).catch(e => [{ error: String(e) }]),
    runQuery(`SELECT * FROM \`${ds}.tiktok_ads\` ORDER BY date DESC LIMIT 3`
    ).catch(e => [{ error: String(e) }]),
  ]);

  return NextResponse.json({ columns, totals, sample });
}
