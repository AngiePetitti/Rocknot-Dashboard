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
      return [table, {
        firstDay: day(r?.first_day),
        lastDay: day(r?.last_day),
        days: Number(r?.days || 0),
        rows: Number(r?.row_count || 0),
        ...(spend ? { spend: Math.round(Number(r?.spend || 0)) } : {}),
      }] as const;
    } catch (e: unknown) {
      return [table, { error: String(e instanceof Error ? e.message : e) }] as const;
    }
  }));
  return NextResponse.json({ dataset: ds, tables: Object.fromEntries(results) });
}
