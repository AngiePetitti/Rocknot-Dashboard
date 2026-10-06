import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset, tableExists, columnExists, googleSource, metaSource } from '@/src/lib/bigquery';
import { getClient, metaAccountSql } from '@/src/lib/client';

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
  // What the dashboard now reads for Google after de-duplication — compare
  // these months against the Google Ads UI.
  if (await tableExists('google_ads')) {
    try {
      const gsrc = await googleSource();
      out.googleAsRead = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m', DATE(date)) AS month, COUNT(*) AS rows_after_dedupe, ROUND(SUM(spend), 2) AS spend,
                ROUND(SUM(COALESCE(conversions_value, conversion_value, 0)), 2) AS revenue, ROUND(SUM(IFNULL(conversions, 0)), 1) AS conversions
         FROM ${gsrc} WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)
         GROUP BY month ORDER BY month DESC`);
    } catch (e) { out.googleAsRead = { error: e instanceof Error ? e.message : String(e) }; }
  }
  out.tables = result;

  // Meta grain check. Sep 2025 reads exactly 2× Ads Manager while the exact-
  // duplicate check finds nothing, so the extra rows differ in SOME column —
  // the signature of two uploads at different grains (ad set rows + ad rows)
  // or an extra breakdown. Shows which columns exist, per-month row shape, and
  // raw rows for one day so the right de-duplication key can be chosen.
  if (await tableExists('facebook_ads')) {
    try {
      const acct = metaAccountSql();
      const probeMonth = request.nextUrl.searchParams.get('probe_month') || '2025-09';
      const probeDay = request.nextUrl.searchParams.get('probe_day') || `${probeMonth}-15`;
      const columns = await runQuery<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM \`${ds}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'facebook_ads' ORDER BY ordinal_position`);
      const names = columns.map(c => c.column_name);
      const has = (c: string) => names.includes(c);
      const idCols = ['account_id', 'campaign_id', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'campaign'].filter(has);
      const breakdownCols = ['publisher_platform', 'platform_position', 'device_platform', 'impression_device', 'country', 'region', 'age', 'gender', 'placement', 'objective', 'date_start', 'date_stop', 'attribution_setting', 'action_attribution_windows'].filter(has);
      const distinctSel = [...idCols, ...breakdownCols].map(c => `COUNT(DISTINCT CAST(${c} AS STRING)) AS distinct_${c}, COUNTIF(${c} IS NULL) AS null_${c}`).join(', ');
      const byMonth = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m', DATE(date)) AS month, COUNT(*) AS row_count, ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS spend${distinctSel ? ', ' + distinctSel : ''}
         FROM \`${ds}.facebook_ads\` WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)${acct}
         GROUP BY month ORDER BY month DESC`);
      // Duplicates at progressively looser keys, with the spend the extra rows carry.
      const dupAt = async (key: string[]) => {
        if (!key.every(has)) return { key, skipped: 'column missing' };
        const r = await runQuery(
          `SELECT COUNT(*) AS duplicate_groups, SUM(n - 1) AS extra_rows, ROUND(SUM(sp - sp / n), 2) AS extra_spend_if_rows_identical, ROUND(SUM(sp) / 2, 2) AS half_of_group_spend FROM (
             SELECT ${key.map(c => `CAST(${c} AS STRING)`).join(', ')}, COUNT(*) AS n, SUM(CAST(spend AS FLOAT64)) AS sp
             FROM \`${ds}.facebook_ads\` WHERE FORMAT_DATE('%Y-%m', DATE(date)) = '${probeMonth.replace(/[^0-9-]/g, '')}'${acct}
             GROUP BY ${key.map((_, i) => i + 1).join(', ')} HAVING n > 1)`);
        return { key, ...(r[0] || {}) };
      };
      const dupes = await Promise.all([
        dupAt(['date', 'ad_id']), dupAt(['date', 'adset_id']), dupAt(['date', 'campaign', 'ad_name']), dupAt(['date', 'campaign']),
        dupAt(['date', 'ad_id', 'spend']),
      ]);
      // Every row for one day, as JSON, so the differing column is visible.
      const dayRows = await runQuery<{ row: string }>(
        `SELECT TO_JSON_STRING(t) AS row FROM \`${ds}.facebook_ads\` t WHERE DATE(date) = '${probeDay.replace(/[^0-9-]/g, '')}'${acct} ORDER BY ${has('campaign') ? 'CAST(campaign AS STRING), ' : ''}CAST(spend AS FLOAT64) LIMIT 40`);
      const dayTotal = await runQuery(
        `SELECT COUNT(*) AS row_count, ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS spend FROM \`${ds}.facebook_ads\` WHERE DATE(date) = '${probeDay.replace(/[^0-9-]/g, '')}'${acct}`);
      // Byte-identical rows per month (the Google pattern), with the spend they add.
      const exactByMonth = await runQuery(
        `SELECT month, COUNT(*) AS duplicate_groups, SUM(n - 1) AS extra_rows, ROUND(SUM(sp * (n - 1) / n), 2) AS extra_spend FROM (
           SELECT FORMAT_DATE('%Y-%m', DATE(date)) AS month, TO_JSON_STRING(t) AS j, COUNT(*) AS n, SUM(CAST(spend AS FLOAT64)) AS sp
           FROM \`${ds}.facebook_ads\` t WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)${acct}
           GROUP BY month, j HAVING n > 1) GROUP BY month ORDER BY month DESC`);
      // What the dashboard now reads for Meta after metaSource() — compare
      // these months against Ads Manager (Sep 2025 $12,315.41 · Aug 2025 $12,133.49 · Aug 2026 $8,279.48).
      const msrc = await metaSource();
      const metaAsRead = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m', DATE(date)) AS month, COUNT(*) AS rows_after_dedupe, ROUND(SUM(CAST(spend AS FLOAT64)), 2) AS spend,
                ROUND(SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)), 2) AS revenue, ROUND(SUM(IFNULL(CAST(actions_omni_purchase AS FLOAT64), 0)), 0) AS purchases
         FROM ${msrc} WHERE DATE(date) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${months} MONTH)${acct}
         GROUP BY month ORDER BY month DESC`);
      out.metaGrain = { columns, probeMonth, probeDay, byMonth, exactDuplicatesByMonth: exactByMonth, duplicatesInProbeMonth: dupes, probeDayTotal: dayTotal[0] || null, probeDayRows: dayRows.map(r => { try { return JSON.parse(r.row); } catch { return r.row; } }) };
      out.metaAsRead = metaAsRead;
    } catch (e) { out.metaGrain = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
