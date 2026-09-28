import { NextRequest, NextResponse } from 'next/server';
import { klaviyoDiagnostics } from '@/src/lib/klaviyo';
import { timeframeRange } from '@/src/lib/timeframes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only (middleware). /api/debug/klaviyo?tf=30d
export async function GET(request: NextRequest) {
  const { from, to } = timeframeRange((request.nextUrl.searchParams.get('tf') || '30d') as '30d');
  try {
    return NextResponse.json(await klaviyoDiagnostics(from, to));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) });
  }
}
