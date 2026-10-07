import { NextRequest, NextResponse } from 'next/server';
import { runScan } from '@/src/lib/scan';
import { getCachedBrief, yesterdayPst } from '@/src/lib/brief';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Admin-only: the raw sweep for a day — every outlier ranked by impact, the
// number of series checked, and any series group that failed to load — plus
// the cached brief's findings and scan stats for the same day.
//   /api/debug/scan            → yesterday
//   /api/debug/scan?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.nextUrl.searchParams.get('date') || '') ? (req.nextUrl.searchParams.get('date') as string) : yesterdayPst();
  const cached = await getCachedBrief(date);
  const rps = cached && cached.facts.sessions.baseline > 0 ? cached.facts.revenue.baseline / cached.facts.sessions.baseline : 1.5;
  const aov = cached?.facts.aov.current || 100;
  const scan = await runScan(date, rps, aov);
  return NextResponse.json({
    generatedAt: new Date().toISOString(), date, assumptions: { revenuePerSession: rps, aov },
    seriesCount: scan.seriesCount, errors: scan.errors, anomalies: scan.anomalies,
    cachedBrief: cached ? { generatedAt: cached.generatedAt, headline: cached.headline, findings: cached.findings, scan: cached.scan, anomalyCount: cached.anomalies?.length ?? 0 } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
