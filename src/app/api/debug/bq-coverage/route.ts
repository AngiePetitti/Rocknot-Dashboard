import { NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured } from '@/src/lib/bigquery';
import { clientPlatforms } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

// Date coverage of every synced table for this client's dataset: first and
// last day, distinct days, row count, and (for ad tables) total spend. The
// quickest way to tell whether a Windsor backfill actually landed, and how
// far back each platform's history goes, without opening BigQuery.
//   /api/debug/bq-coverage
export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ error: 'BigQuery not configured in this environment' });
  }
  const ds = getDataset();
  const tables: Array<{ table: string; spend: boolean }> = [
    { table: 'shopify_orders', spend: false },
    ...clientPlatforms().map(p => ({ table: p.bqTable, spend: true })),
  ];
  const results = await Promise.all(tables.map(async ({ table, spend }) => {
    try {
      const rows = await runQuery<{
        first_day: { value?: string } | string | null;
        last_day: { value?: string } | string | null;
        days: number | null;
        row_count: number | null;
        spend: number | null;
      }>(
        `SELECT MIN(DATE(date)) AS first_day, MAX(DATE(date)) AS last_day,
                COUNT(DISTINCT DATE(date)) AS days, COUNT(*) AS row_count
                ${spend ? ', SUM(CAST(spend AS FLOAT64)) AS spend' : ', NULL AS spend'}
         FROM \`${ds}.${table}\``,
        {}
      );
      const r = rows[0];
      const day = (v: { value?: string } | string | null | undefined) =>
        v && typeof v === 'object' ? String(v.value ?? '') : (v ?? null);
      // Which ad accounts the table actually holds — the separation check.
      // A row from another client's account shows up here by name.
      let accounts: Array<{ accountId: string; accountName: string; rows: number; spend: number }> | undefined;
      if (spend) {
        try {
          const acc = await runQuery<{ account_id: string | null; account_name: string | null; row_count: number; spend: number | null }>(
            `SELECT CAST(account_id AS STRING) AS account_id, account_name,
                    COUNT(*) AS row_count, SUM(CAST(spend AS FLOAT64)) AS spend
             FROM \`${ds}.${table}\`
             GROUP BY account_id, account_name ORDER BY spend DESC LIMIT 20`,
            {}
          );
          accounts = acc.map(a => ({
            accountId: String(a.account_id ?? ''),
            accountName: String(a.account_name ?? ''),
            rows: Number(a.row_count || 0),
            spend: Math.round(Number(a.spend || 0)),
          }));
        } catch { /* table lacks account columns — skip the breakdown */ }
      }
      return [table, {
        firstDay: day(r?.first_day),
        lastDay: day(r?.last_day),
        days: Number(r?.days || 0),
        rows: Number(r?.row_count || 0),
        ...(spend ? { spend: Math.round(Number(r?.spend || 0)) } : {}),
        ...(accounts ? { accounts } : {}),
      }] as const;
    } catch (e: unknown) {
      return [table, { error: String(e instanceof Error ? e.message : e) }] as const;
    }
  }));
  return NextResponse.json({ dataset: ds, tables: Object.fromEntries(results) });
}
