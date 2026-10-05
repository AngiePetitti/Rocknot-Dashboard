import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getKV, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// Where a background report build is: /api/insights/report/status?since=<job>
// Statuses are written by the build itself, so they survive the browser
// sleeping or the tab closing.
export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const since = Number(req.nextUrl.searchParams.get('since') || 0);
  if (!since) return NextResponse.json({ error: 'since required' }, { status: 400 });
  if (!isChatStoreConfigured()) return NextResponse.json({ job: null, configured: false });
  try {
    const raw = await getKV(`report_job_${since}`);
    return NextResponse.json({ job: raw ? JSON.parse(raw) : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ job: null, error: e instanceof Error ? e.message : String(e) });
  }
}
