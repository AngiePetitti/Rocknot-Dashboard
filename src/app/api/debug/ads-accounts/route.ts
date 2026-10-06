import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset, tableExists, columnExists } from '@/src/lib/bigquery';
import { getClient } from '@/src/lib/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only ads-table audit (/api/debug/ads-accounts?months=14): for every
// synced ads table, spend by month BY ACCOUNT, plus a duplicate-row check —
// to catch a table that carries another client's account from the shared
// Windsor workspace, or a backfill that wrote the same days twice. Both
// make year-ago spend (and MER) wrong in every report.
export async function GET(request: NextRequest) {
  const months = Math.max(1, Math.min(26, Number(request.nextUrl.searchParams.get('months') || 14)));
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), client: getClient().id, configuredAccounts: getClient().windsor.accounts };
  if (!isBigQueryConfigured()) return NextResponse.json({ ...out, error: 'BigQuery not configured' });
  const ds = getDataset();
  const tables = ['facebook_ads', 'google_ads', 'pinterest_ads', 'tiktok_ads', 'snapchat_ads'];
  const result: Record<string, unknown> = {};
  for (const t of tables) {
    if (!(await tableExists(t))) continue;
    const hasId = await columnExists(t, 'account_id');
    const hasName = await columnExists(t, 'account_name');
    const acct = hasId ? 'CAST(account_id AS STRING)' : hasName ? 'CAST(account_name AS STRING)' : "'(no account column)'";
    const name = hasName ? 'ANY_VALUE(CAST(account_name AS STRING))' : 'NULL';
    try {
      const byMonth = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m', DATE(date)) AS month, ${acct} AS account, ${name} AS account_name,
                COUNT(*) AS row_count, ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS spend
         FROM \`${ds}.${t}\`
         WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)
         GROUP BY month, account ORDER BY month DESC, spend DESC`);
      // Duplicate check: identical (date, account, campaign, ad/adset) rows.
      const keyCols = ['date', hasId ? 'account_id' : null, (await columnExists(t, 'campaign')) ? 'campaign' : null,
        (await columnExists(t, 'ad_id')) ? 'ad_id' : (await columnExists(t, 'adset_id')) ? 'adset_id' : (await columnExists(t, 'ad_group_name')) ? 'ad_group_name' : null].filter(Boolean) as string[];
      const dupes = await runQuery(
        `SELECT COUNT(*) AS duplicate_groups, SUM(n - 1) AS extra_rows FROM (
           SELECT ${keyCols.map(c => `CAST(${c} AS STRING)`).join(', ')}, COUNT(*) AS n
           FROM \`${ds}.${t}\` WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)
           GROUP BY ${keyCols.map((_, i) => i + 1).join(', ')} HAVING n > 1)`);
      const accounts = await runQuery(
        `SELECT ${acct} AS account, ${name} AS account_name, MIN(DATE(date)) AS first_day, MAX(DATE(date)) AS last_day, COUNT(*) AS row_count, ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS spend
         FROM \`${ds}.${t}\` GROUP BY account ORDER BY spend DESC`);
      result[t] = { accounts, duplicateCheck: { keyColumns: keyCols, ...(dupes[0] || {}) }, spendByMonthByAccount: byMonth };
    } catch (e) {
      result[t] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  out.tables = result;
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
