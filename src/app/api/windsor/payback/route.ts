import { NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getPaybackLtv } from '@/src/lib/bqCustomers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Payback & LTV cohorts for the Customer Intel tab — full customer base,
// last 12 first-purchase months. Heavyish BigQuery work, so let the CDN
// cache it for an hour; the underlying data only moves daily anyway.

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'error', error: 'BigQuery not configured', cohorts: [] });
  }
  try {
    const cohorts = await getPaybackLtv();
    return NextResponse.json(
      { source: 'bigquery_live', cohorts },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err instanceof Error ? err.message : err), cohorts: [] });
  }
}
