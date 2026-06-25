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
    const dashboard = await runQuery<{ spend: number; rows: number }>(
      `SELECT SUM(CAST(spend AS FLOAT64)) AS spend, COUNT(*) AS rows
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'`,
      params
    );

    // Breakdown by account_name — catches "other accounts inflating the total".
    const byAccount = await runQuery(
      `SELECT account_name, COUNT(*) AS rows, SUM(CAST(spend AS FLOAT64)) AS spend
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @date
       GROUP BY account_name ORDER BY spend DESC`,
      params
    );

    // Pick a granular key column to test for duplicate rows.
    const keyCol = ['ad_id', 'adset_id', 'campaign_id', 'campaign_name'].find(has) || null;
    // A sync/version timestamp, if Windsor stamps one, to pick the latest row.
    const tsCol = ['_airbyte_emitted_at', 'updated_at', 'synced_at', '_synced_at', 'last_updated', 'date_start'].find(has) || null;

    let perKey: unknown = 'no key column (ad_id/adset_id/campaign_id) present';
    let dedupCandidate: unknown = null;
    if (keyCol) {
      // How many rows per key on this date? >1 means duplication.
      perKey = await runQuery(
        `SELECT ${keyCol} AS k, COUNT(*) AS rows, COUNT(DISTINCT CAST(spend AS STRING)) AS distinct_spend,
                SUM(CAST(spend AS FLOAT64)) AS summed_spend, MAX(CAST(spend AS FLOAT64)) AS max_spend
         FROM \`${ds}.facebook_ads\`
         WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
         GROUP BY k HAVING COUNT(*) > 1 ORDER BY rows DESC LIMIT 20`,
        params
      );

      // Candidate deduped total: one row per key. If a sync timestamp exists,
      // take the latest row's spend; otherwise take the max (a re-synced full
      // duplicate carries the same value, so max == the true per-ad spend).
      const dedupSql = tsCol
        ? `WITH ranked AS (
             SELECT ${keyCol} AS k, CAST(spend AS FLOAT64) AS spend,
                    ROW_NUMBER() OVER (PARTITION BY ${keyCol} ORDER BY ${tsCol} DESC) AS rn
             FROM \`${ds}.facebook_ads\`
             WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
           )
           SELECT SUM(spend) AS spend, COUNT(*) AS keys FROM ranked WHERE rn = 1`
        : `SELECT SUM(max_spend) AS spend, COUNT(*) AS keys FROM (
             SELECT ${keyCol} AS k, MAX(CAST(spend AS FLOAT64)) AS max_spend
             FROM \`${ds}.facebook_ads\`
             WHERE DATE(date) = @date AND LOWER(account_name) = 'rocknot'
             GROUP BY k
           )`;
      dedupCandidate = await runQuery(dedupSql, params);
    }

    return NextResponse.json({
      date,
      dashboardShows: dashboard[0],
      keyColumnUsed: keyCol,
      timestampColumnUsed: tsCol,
      dedupedSpendCandidate: dedupCandidate,
      duplicateKeysOnThisDate: perKey,
      spendByAccountName: byAccount,
      allColumns: cols.map(c => c.column_name),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), date });
  }
}
