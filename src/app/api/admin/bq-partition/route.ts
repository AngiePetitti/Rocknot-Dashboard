import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// One-time BigQuery cost fix: convert Windsor's synced tables to
// date-partitioned tables so range queries scan days, not full history.
// GET = dry run (shows plan + table sizes). GET ?execute=1 = run it.
// Originals are kept as <table>__old for a safety window.
const CANDIDATES = ['shopify_orders', 'facebook_ads', 'google_ads', 'tiktok_ads', 'snapchat_ads', 'pinterest_ads', 'shopify_products'];

export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (!isBigQueryConfigured()) return NextResponse.json({ error: 'BigQuery not configured' }, { status: 500 });
  const execute = req.nextUrl.searchParams.get('execute') === '1';
  const ds = getDataset();

  const tables = await runQuery<{ table_name: string; ddl: string }>(`
    SELECT table_name, ddl
    FROM \`${ds}\`.INFORMATION_SCHEMA.TABLES
    WHERE table_type = 'BASE TABLE'
  `);
  const sizes = await runQuery<{ table_name: string; size_gb: number }>(`
    SELECT table_name, ROUND(SUM(total_logical_bytes) / POW(1024, 3), 2) AS size_gb
    FROM \`${ds}\`.INFORMATION_SCHEMA.TABLE_STORAGE
    GROUP BY table_name
  `).catch(() => [] as Array<{ table_name: string; size_gb: number }>);
  const sizeOf = new Map(sizes.map(s => [s.table_name, s.size_gb]));

  const cols = await runQuery<{ table_name: string; data_type: string }>(`
    SELECT table_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
    WHERE column_name = 'date'
  `);
  const typeOf = new Map(cols.map(c => [c.table_name, c.data_type]));

  const plan: Array<Record<string, unknown>> = [];
  for (const t of tables) {
    if (!CANDIDATES.includes(t.table_name)) continue;
    const already = /PARTITION BY/i.test(t.ddl || '');
    const dt = typeOf.get(t.table_name) || 'none';
    let action = 'skip';
    let partitionExpr = '';
    if (already) action = 'already partitioned';
    else if (dt === 'DATE') { action = 'partition'; partitionExpr = '`date`'; }
    else if (dt === 'TIMESTAMP' || dt === 'DATETIME') { action = 'partition'; partitionExpr = 'DATE(`date`)'; }
    else action = `skip - date column is ${dt}; needs manual handling`;
    const entry: Record<string, unknown> = { table: t.table_name, sizeGb: sizeOf.get(t.table_name) ?? null, dateType: dt, action };
    plan.push(entry);

    if (execute && action === 'partition') {
      const tmp = `${t.table_name}__p`;
      const old = `${t.table_name}__old`;
      await runQuery(`CREATE OR REPLACE TABLE \`${ds}.${tmp}\` PARTITION BY ${partitionExpr} AS SELECT * FROM \`${ds}.${t.table_name}\``);
      await runQuery(`DROP TABLE IF EXISTS \`${ds}.${old}\``);
      await runQuery(`ALTER TABLE \`${ds}.${t.table_name}\` RENAME TO ${old}`);
      await runQuery(`ALTER TABLE \`${ds}.${tmp}\` RENAME TO ${t.table_name}`);
      entry.executed = true;
    }
  }
  return NextResponse.json({
    dataset: ds,
    executed: execute,
    plan,
    note: execute
      ? 'Partitioned. Originals kept as <table>__old - delete them after a week of normal operation to reclaim storage. Windsor keeps syncing into the (new) tables.'
      : 'Dry run. Re-open with ?execute=1 to apply. One-time cost: each table is scanned once to build its partitioned copy.',
  });
}
