import { NextResponse } from 'next/server';
import { runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ds = getDataset();
  const [cols, sample] = await Promise.all([
    runQuery(`
      SELECT column_name, data_type
      FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'shopify_orders'
      ORDER BY ordinal_position
    `).catch(e => [{ error: String(e) }]),
    runQuery(`
      SELECT * FROM \`${ds}.shopify_orders\` LIMIT 2
    `).catch(e => [{ error: String(e) }]),
  ]);
  return NextResponse.json({ columns: cols, sample });
}
