import { NextResponse } from 'next/server';
import { runQuery, getDataset } from '@/src/lib/bigquery';
import { clientPlatforms } from '@/src/lib/client';

export const dynamic = 'force-dynamic';

// Column inventory for every ad table this client's profile expects — the
// quickest way to confirm Windsor's column names (Pinterest's revenue column
// in particular varies by connector version) after the first sync.
export async function GET() {
  const ds = getDataset();
  try {
    const tables = clientPlatforms().map(p => p.bqTable);
    const results = await Promise.all(tables.map(t =>
      runQuery<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = @t ORDER BY column_name`,
        { t }
      ).catch((e: unknown) => ({ error: String(e) }))
    ));
    return NextResponse.json(Object.fromEntries(tables.map((t, i) => [t, results[i]])));
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
