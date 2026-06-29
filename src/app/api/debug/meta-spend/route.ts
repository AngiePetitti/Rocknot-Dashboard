import { NextRequest, NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

// Diagnostic for the "Meta spend looks inflated" problem.
//   /api/debug/meta-spend                       → June-to-yesterday range
//   /api/debug/meta-spend?from=2026-06-01&to=2026-06-28
//   /api/debug/meta-spend?date=2026-06-24       → single day (also sets from=to)
// Reveals whether facebook_ads has duplicate / multi-level rows the dashboard's
// SUM(spend) is double-counting — the same class of bug already fixed for
// Shopify orders via dedupedOrdersCte.
export async function GET(request: NextRequest) {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured in this environment' });
  }
  const ds = getDataset();

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yd = new Date(todayStr);
  yd.setDate(yd.getDate() - 1);
  const yesterday = yd.toISOString().split('T')[0];
  const monthStart = `${todayStr.slice(0, 7)}-01`;

  const single = request.nextUrl.searchParams.get('date');
  const from = single || request.nextUrl.searchParams.get('from') || monthStart;
  const to = single || request.nextUrl.searchParams.get('to') || yesterday;
  const params = { from, to } as Record<string, string | number>;
  const WHERE = `WHERE DATE(date) BETWEEN @from AND @to AND LOWER(account_name) = 'rocknot'`;

  try {
    const cols = await runQuery<{ column_name: string }>(
      `SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'facebook_ads' ORDER BY column_name`,
      {}
    );

    // (1) The number the dashboard currently shows over the range (plain SUM).
    const dashboard = await runQuery<{ spend: number; row_count: number }>(
      `SELECT SUM(CAST(spend AS FLOAT64)) AS spend, COUNT(*) AS row_count
       FROM \`${ds}.facebook_ads\` ${WHERE}`,
      params
    );

    // (2) Deduped candidate over the range: one row per (date, campaign) via
    //     MAX(spend), then summed.
    const dedup = await runQuery<{ deduped_spend: number; group_count: number }>(
      `SELECT SUM(mx) AS deduped_spend, COUNT(*) AS group_count FROM (
         SELECT DATE(date) AS d, campaign, MAX(CAST(spend AS FLOAT64)) AS mx
         FROM \`${ds}.facebook_ads\` ${WHERE}
         GROUP BY d, campaign
       )`,
      params
    );

    // (3) Per-day: summed vs deduped, and how many (date,campaign) groups have
    //     more than one row (the duplication signal).
    const perDay = await runQuery(
      `SELECT d AS date,
              SUM(summed) AS summed_spend,
              SUM(mx) AS deduped_spend,
              SUM(row_count) AS total_rows,
              COUNTIF(row_count > 1) AS multi_row_campaigns
       FROM (
         SELECT DATE(date) AS d, campaign,
                SUM(CAST(spend AS FLOAT64)) AS summed,
                MAX(CAST(spend AS FLOAT64)) AS mx,
                COUNT(*) AS row_count
         FROM \`${ds}.facebook_ads\` ${WHERE}
         GROUP BY d, campaign
       )
       GROUP BY date ORDER BY date`,
      params
    );

    // (4) Raw rows for one day's multi-row campaigns, so we can see EXACTLY what
    //     differs between duplicate rows (date timestamp, datasource, source,
    //     budgets, spend). Uses the single date if given, else the worst day.
    const inspectDate = single
      || (perDay as Array<{ date: { value?: string } | string; multi_row_campaigns: number }>)
        .filter(r => Number(r.multi_row_campaigns) > 0)
        .map(r => (typeof r.date === 'string' ? r.date : r.date.value || ''))
        .pop()
      || to;
    const rawMultiRows = await runQuery(
      `SELECT *
       FROM \`${ds}.facebook_ads\`
       WHERE DATE(date) = @inspect AND LOWER(account_name) = 'rocknot'
         AND campaign IN (
           SELECT campaign FROM \`${ds}.facebook_ads\`
           WHERE DATE(date) = @inspect AND LOWER(account_name) = 'rocknot'
           GROUP BY campaign HAVING COUNT(*) > 1
         )
       ORDER BY campaign, date, CAST(spend AS FLOAT64)`,
      { inspect: inspectDate }
    );

    return NextResponse.json({
      range: { from, to },
      dashboardShowsForRange: dashboard[0],
      dedupedCandidateForRange: dedup[0],
      perDay,
      rawRowsInspectDate: inspectDate,
      rawRowsForMultiRowCampaigns: rawMultiRows,
      allColumns: cols.map(c => c.column_name),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), from, to });
  }
}
