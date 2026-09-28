import { NextResponse } from 'next/server';
import { loadTrendBrief, generateTrendBrief, isStale } from '@/src/lib/trends';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// GET  → the stored brief (with `stale` when older than a day), generating one only if none exists.
// POST → regenerate now (any signed-in team member; partners never reach this route).
export async function GET() {
  try {
    const cached = await loadTrendBrief();
    if (cached) return NextResponse.json({ brief: cached, stale: isStale(cached) });
    const brief = await generateTrendBrief();
    return NextResponse.json({ brief, stale: false });
  } catch (e) {
    return NextResponse.json({ brief: null, error: String(e instanceof Error ? e.message : e) });
  }
}

export async function POST() {
  try {
    const brief = await generateTrendBrief();
    return NextResponse.json({ brief, stale: false });
  } catch (e) {
    return NextResponse.json({ brief: null, error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
