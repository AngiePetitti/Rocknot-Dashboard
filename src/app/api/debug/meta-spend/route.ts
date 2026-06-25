import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// Diagnostic for the "Meta spend looks inflated" problem. Hit:
//   /api/debug/meta-spend?date=2026-06-24
// (defaults to yesterday, America/Los_Angeles). Reveals whether the
// facebook_ads table has duplicate / multi-level rows that the dashboard's
// SUM(spend) is double-counting — the same class of bug already fixed for
// Shopify orders via dedupedOrdersCte.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured in this environment' });
  }
  const ds = getDataset();

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const d = new Date(todayStr);
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().split('T')[0];
  const date = request.nextUrl.searchParams.get('date') || yesterday;
  const params = { date, ds_unused: 0 } as Record<string, string | number>;

  try {
    // What columns exist? Used to pick a per-ad key + a sync timestamp.
    const cols = await runQuery<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'facebook_ads' ORDER BY column_name`,
      {}
    );
    const colNames = new Set(cols.map(c => c.column_name));
    const has = (c: string) => colNames.has(c);

    // The number the dashboard currently shows.
    const dashboard = await runQuery<{ spend: number; row_count: number }>(
      `SELECT SUM(CAST(spend AS FLOAT64)) AS spend, COUNT(*) AS row_count
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'`,
      params
    );

    // Breakdown by account_name — catches "other accounts inflating the total".
    const byAccount = await runQuery(
      `SELECT account_name, COUNT(*) AS row_count, SUM(CAST(spend AS FLOAT64)) AS spend
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date
       GROUP BY account_name ORDER BY spend DESC`,
      params
    );

    // Pick a granular key column to test for duplicate rows.
    const keyCol = ['ad_id', 'adset_id', 'campaign_id', 'campaign_name'].find(has) || null;
    // A sync/version timestamp, if Windsor stamps one, to pick the latest row.
    const tsCol = ['_airbyte_emitted_at', 'updated_at', 'synced_at', '_synced_at', 'last_updated', 'date_start'].find(has) || null;

    // Per-campaign + per-datasource breakdown — reveals whether datasource
    // is the dimension that splits rows (same campaign spend repeated per datasource).
    const byCampaign = await runQuery(
      `SELECT campaign, datasource, COUNT(*) AS row_count,
              SUM(CAST(spend AS FLOAT64)) AS summed_spend,
              MAX(CAST(spend AS FLOAT64)) AS max_spend,
              MIN(CAST(spend AS FLOAT64)) AS min_spend
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
       GROUP BY campaign, datasource
       ORDER BY summed_spend DESC`,
      params
    );

    // Dedup candidate: one row per campaign (MAX spend), then sum.
    const dedupByCampaign = await runQuery<{ deduped_spend: number; campaign_count: number }>(
      `SELECT SUM(max_spend) AS deduped_spend, COUNT(*) AS campaign_count FROM (
         SELECT campaign, MAX(CAST(spend AS FLOAT64)) AS max_spend
         FROM \`${ds}.facebook_ads\`
         WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
         GROUP BY campaign
       )`,
      params
    );

    // Dump all columns for any campaign with >1 row — lets us see what differs
    // between rows (adset_daily_budget, source, spend etc.) to understand the
    // duplication structure and pick the right dedup key / aggregation method.
    const rawMultiRows = await runQuery(
      `SELECT *
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
         AND campaign IN (
           SELECT campaign FROM \`${ds}.facebook_ads\`
           WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
           GROUP BY campaign HAVING COUNT(*) > 1
         )
       ORDER BY campaign, CAST(spend AS FLOAT64)`,
      params
    );

    return NextResponse.json({
      date,
      dashboardShows: dashboard[0],
      dedupByCampaign: dedupByCampaign[0],
      perCampaignDatasource: byCampaign,
      rawRowsForMultiRowCampaigns: rawMultiRows,
      spendByAccountName: byAccount,
      allColumns: cols.map(c => c.column_name),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), date });
  }
}
