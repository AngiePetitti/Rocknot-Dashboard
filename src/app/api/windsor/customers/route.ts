import { NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getCustomerMetrics, getCohortData } from '@/src/lib/bqCustomers';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'error', error: 'BigQuery not configured', customerMetrics: null, cohortData: null });
  }

  const [customerMetrics, cohortData] = await Promise.all([
    getCustomerMetrics().catch(() => null),
    getCohortData().catch(() => []),
  ]);

  const hasData = customerMetrics !== null;
  return NextResponse.json(
    { source: hasData ? 'bigquery_live' : 'error', customerMetrics, cohortData },
    { headers: cacheHeaders() },
  );
}
