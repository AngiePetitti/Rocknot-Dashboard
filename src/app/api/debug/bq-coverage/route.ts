import { NextResponse } from 'next/server';
import { runQuery, getDataset, isBigQueryConfigured, getBigQuery } from '@/src/lib/bigquery';
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
          // Windsor's facebook/google tables carry account_name only; the
          // pinterest table has both. Use whichever columns exist.
          const cols = await runQuery<{ column_name: string }>(
            `SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = @t AND column_name IN ('account_id', 'account_name')`,
            { t: table }
          );
          const have = new Set(cols.map(c => c.column_name));
          const idExpr = have.has('account_id') ? 'CAST(account_id AS STRING)' : "''";
          const nameExpr = have.has('account_name') ? 'CAST(account_name AS STRING)' : "''";
          const acc = await runQuery<{ account_id: string | null; account_name: string | null; row_count: number; spend: number | null }>(
            `SELECT ${idExpr} AS account_id, ${nameExpr} AS account_name,
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
  // Every table in the dataset with its row count — catches a backfill that
  // Windsor wrote to a differently named table.
  let allTables: Array<{ table: string; rows: number; lastModified: string | null }> | { error: string };
  try {
    const t = await runQuery<{ table_id: string; row_count: number | null; last_modified_time: number | null }>(
      `SELECT table_id, row_count, last_modified_time FROM \`${ds}.__TABLES__\` ORDER BY table_id`,
      {}
    );
    allTables = t.map(x => ({
      table: x.table_id,
      rows: Number(x.row_count || 0),
      lastModified: x.last_modified_time ? new Date(Number(x.last_modified_time)).toISOString() : null,
    }));
  } catch (e: unknown) {
    allTables = { error: String(e instanceof Error ? e.message : e) };
  }
  // Expiry settings: a partition/table expiration on the dataset or a table
  // silently deletes rows older than N days — the one thing that makes a
  // successful two-year backfill leave only the last 60 days behind.
  // Each lookup is independent so one permission gap doesn't hide the rest.
  const expiry: Record<string, unknown> = {};
  try {
    // Dataset metadata via the client library (needs bigquery.datasets.get,
    // which INFORMATION_SCHEMA.SCHEMATA_OPTIONS does not cover).
    const [meta] = await getBigQuery().dataset(ds).getMetadata();
    expiry.dataset = {
      defaultTableExpirationMs: meta.defaultTableExpirationMs ?? null,
      defaultPartitionExpirationMs: meta.defaultPartitionExpirationMs ?? null,
      location: meta.location ?? null,
      created: meta.creationTime ? new Date(Number(meta.creationTime)).toISOString() : null,
    };
  } catch (e: unknown) {
    expiry.dataset = { error: String(e instanceof Error ? e.message : e) };
  }
  try {
    const tableMeta = await Promise.all(tables.map(async ({ table }) => {
      try {
        const [m] = await getBigQuery().dataset(ds).table(table).getMetadata();
        return [table, {
          expirationTime: m.expirationTime ? new Date(Number(m.expirationTime)).toISOString() : null,
          timePartitioning: m.timePartitioning ?? null,
          rangePartitioning: m.rangePartitioning ?? null,
          numRows: m.numRows ?? null,
          created: m.creationTime ? new Date(Number(m.creationTime)).toISOString() : null,
        }] as const;
      } catch (e: unknown) {
        return [table, { error: String(e instanceof Error ? e.message : e) }] as const;
      }
    }));
    expiry.tables = Object.fromEntries(tableMeta);
  } catch (e: unknown) {
    expiry.tables = { error: String(e instanceof Error ? e.message : e) };
  }
  try {
    const tblOpts = await runQuery<{ table_name: string; option_name: string; option_value: string }>(
      `SELECT table_name, option_name, option_value FROM \`${ds}\`.INFORMATION_SCHEMA.TABLE_OPTIONS
       WHERE option_name IN ('partition_expiration_days', 'expiration_timestamp', 'require_partition_filter')`,
      {}
    );
    expiry.tableOptions = tblOpts.reduce<Record<string, Record<string, string>>>((acc, o) => {
      (acc[o.table_name] = acc[o.table_name] || {})[o.option_name] = o.option_value;
      return acc;
    }, {});
  } catch (e: unknown) {
    expiry.tableOptions = { error: String(e instanceof Error ? e.message : e) };
  }
  return NextResponse.json({ dataset: ds, tables: Object.fromEntries(results), allTables, expiry });
}
