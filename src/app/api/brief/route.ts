import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getBrief, getCachedBrief, yesterdayPst } from '@/src/lib/brief';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The daily brief. GET /api/brief            → yesterday's (cached per day; built on first request)
//                  GET /api/brief?date=…     → that day's
//                  GET /api/brief?refresh=1  → rebuild (admin)
//                  GET /api/brief?cached=1   → cached only, never builds (fast poll)
export async function GET(req: NextRequest) {
  let role = 'team';
  if (authConfigured()) {
    const s = await getServerSession(authOptions);
    if (!s?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    role = s.user.role || 'team';
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  const sp = req.nextUrl.searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? (sp.get('date') as string) : yesterdayPst();
  const refresh = sp.get('refresh') === '1' && role === 'admin';
  try {
    if (sp.get('cached') === '1') return NextResponse.json({ brief: await getCachedBrief(date) }, { headers: { 'Cache-Control': 'no-store' } });
    const brief = await getBrief(date, refresh, { origin: req.nextUrl.origin, cookie: req.headers.get('cookie') || '' });
    return NextResponse.json({ brief }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), date }, { status: 500 });
  }
}
