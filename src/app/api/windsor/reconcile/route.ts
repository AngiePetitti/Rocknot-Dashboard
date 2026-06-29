import { NextRequest, NextResponse } from 'next/server';
import { reconcileAdSpend } from '@/src/lib/adsReconcile';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

// Ad-spend self-check. Compares the dashboard's BigQuery spend against
// independent sources (Meta Graph API + Windsor REST) over a window of
// complete past days, so silent aggregation/date/filter regressions surface
// automatically instead of waiting for someone to spot them against Ads Manager.
//   /api/windsor/reconcile               → trailing 7 complete days
//   /api/windsor/reconcile?days=30
//   /api/windsor/reconcile?from=2026-06-01&to=2026-06-28
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const daysParam = searchParams.get('days');
  const days = daysParam ? Math.max(1, Math.min(180, parseInt(daysParam, 10) || 7)) : undefined;

  try {
    const result = await reconcileAdSpend({ from, to, days });
    return NextResponse.json(result, { headers: cacheHeaders(false) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}
