import { NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getCustomerMetrics, getCohortData } from '@/src/lib/bqCustomers';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'error', error: 'BigQuery not configured', customerMetrics: null, cohortData: null });
  }

  try {
    const [customerMetrics, cohortData] = await Promise.all([
      getCustomerMetrics(),
      getCohortData(),
    ]);
    return NextResponse.json({ source: 'bigquery_live', customerMetrics, cohortData }, { headers: cacheHeaders() });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), customerMetrics: null, cohortData: null });
  }
}
