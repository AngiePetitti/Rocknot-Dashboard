import { NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getCustomerMetrics, getCohortData } from '@/src/lib/bqCustomers';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'mock', customerMetrics: null, cohortData: null });
  }

  try {
    const [customerMetrics, cohortData] = await Promise.all([
      getCustomerMetrics(),
      getCohortData(),
    ]);
    return NextResponse.json({ source: 'bigquery_live', customerMetrics, cohortData });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), customerMetrics: null, cohortData: null });
  }
}
