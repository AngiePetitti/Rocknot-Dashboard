import { NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured' });
  }
  const ds = getDataset();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const [fbCols, googleCols, tiktokCols, fbYesterday, googleYesterday, tiktokYesterday] = await Promise.all([
    runQuery(`SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'facebook_ads' ORDER BY ordinal_position`).catch(e => [{ error: String(e) }]),
    runQuery(`SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'google_ads' ORDER BY ordinal_position`).catch(e => [{ error: String(e) }]),
    runQuery(`SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'tiktok_ads' ORDER BY ordinal_position`).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT
        SUM(CAST(spend AS FLOAT64)) AS spend,
        SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
        SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS action_values_omni_purchase,
        SUM(IFNULL(CAST(actions_omni_purchase AS FLOAT64), 0)) AS actions_omni_purchase
      FROM \`${ds}.facebook_ads\`
      WHERE DATE(date) = '${yStr}'
    `).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT
        SUM(CAST(spend AS FLOAT64)) AS spend,
        SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
        SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)) AS conversion_value,
        SUM(IFNULL(CAST(conversions AS FLOAT64), 0)) AS conversions
      FROM \`${ds}.google_ads\`
      WHERE DATE(date) = '${yStr}'
    `).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT
        SUM(CAST(spend AS FLOAT64)) AS spend,
        SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
        SUM(IFNULL(CAST(onsite_total_purchase_value AS FLOAT64), 0)) AS onsite_total_purchase_value,
        SUM(IFNULL(CAST(complete_payment_value AS FLOAT64), 0)) AS complete_payment_value
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) = '${yStr}'
    `).catch(e => [{ error: String(e) }]),
  ]);

  return NextResponse.json({
    date: yStr,
    facebook_ads: { columns: fbCols, yesterday: fbYesterday },
    google_ads: { columns: googleCols, yesterday: googleYesterday },
    tiktok_ads: { columns: tiktokCols, yesterday: tiktokYesterday },
  });
}
