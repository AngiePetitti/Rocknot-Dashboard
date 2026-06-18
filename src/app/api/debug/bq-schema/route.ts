import { NextResponse } from 'next/server';
import { runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ds = getDataset();
  try {
    const [metaCols, googleCols, tiktokCols] = await Promise.all([
      runQuery<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'facebook_ads' ORDER BY column_name`,
        {}
      ),
      runQuery<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'google_ads' ORDER BY column_name`,
        {}
      ),
      runQuery<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'tiktok_ads' ORDER BY column_name`,
        {}
      ),
    ]);
    return NextResponse.json({ facebook_ads: metaCols, google_ads: googleCols, tiktok_ads: tiktokCols });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
