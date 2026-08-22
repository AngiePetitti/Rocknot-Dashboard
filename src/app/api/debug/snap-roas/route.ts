import { NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only (via /api/debug middleware rule) Snapchat ROAS audit: the last
// 7 days from every source side by side — BigQuery (what the dashboard
// sums), Windsor's live connector, and the Snap Marketing API when its creds
// exist — plus row counts to expose duplicate-row inflation in the BQ table.
export async function GET() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = new Date(new Date(today).getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const out: Record<string, unknown> = { range: { from, to: today } };

  if (isBigQueryConfigured()) {
    try {
      const ds = getDataset();
      out.bigquery = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS d,
                COUNT(*) AS row_count,
                COUNT(DISTINCT ad_id) AS distinct_ads,
                SUM(CAST(spend AS FLOAT64)) AS spend,
                SUM(IFNULL(CAST(conversion_purchases AS FLOAT64), 0)) AS purchases,
                SUM(IFNULL(CAST(conversion_purchases_value AS FLOAT64), 0)) AS revenue
         FROM \`${ds}.snapchat_ads\`
         WHERE DATE(date) BETWEEN @f AND @t
         GROUP BY d ORDER BY d`,
        { f: from, t: today }
      );
      // Duplicate detector: same ad, same day, appearing on multiple rows
      // with identical spend — the signature of stacked sync snapshots.
      out.duplicateSample = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS d, ad_id, COUNT(*) AS copies,
                SUM(CAST(spend AS FLOAT64)) AS summed_spend,
                SUM(IFNULL(CAST(conversion_purchases_value AS FLOAT64), 0)) AS summed_revenue
         FROM \`${ds}.snapchat_ads\`
         WHERE DATE(date) BETWEEN @f AND @t
         GROUP BY d, ad_id HAVING COUNT(*) > 1
         ORDER BY copies DESC LIMIT 10`,
        { f: from, t: today }
      );
    } catch (e) {
      out.bigqueryError = String(e);
    }
  } else {
    out.bigquery = 'not configured';
  }

  try {
    const { fetchSnapDailyFromWindsor } = await import('@/src/lib/tiktokLive');
    out.windsorLive = await fetchSnapDailyFromWindsor(from, today);
  } catch (e) {
    out.windsorLiveError = String(e);
  }

  try {
    const { fetchSnapDaily } = await import('@/src/lib/snapLive');
    out.snapApi = (await fetchSnapDaily(from, today)) ?? 'not configured (SNAP_* env vars missing)';
  } catch (e) {
    out.snapApiError = String(e);
  }

  return NextResponse.json(out);
}
