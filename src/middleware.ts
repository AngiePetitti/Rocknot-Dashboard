import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { partnerCanOpen } from '@/src/lib/access';

// Gate every page and API route behind sign-in. Fails OPEN when auth isn't
// configured yet (no secret / Google creds) so deploying this never locks out
// or breaks the live site — protection switches on the moment env vars exist.
export async function middleware(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const configured = Boolean(secret && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!configured) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // Always-allowed: the auth handshake and the login page itself.
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/login')) return NextResponse.next();
  // Shareable creative briefs: public by unguessable id so designers can
  // open them without a dashboard login. They contain no business metrics
  // beyond what the brief itself states.
  if (pathname.startsWith('/brief/')) return NextResponse.next();

  // Slack Events API posts here with its own HMAC signature, verified inside
  // the route — no dashboard session exists on Slack's servers.

  // Vercel Cron / internal service calls authenticate with the CRON_SECRET
  // bearer token instead of a user session (used by the Monday restock alert).
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  // External AI agents (e.g. Viktor) get a scoped key: read-only API access
  // plus asking Cleo — never debug endpoints, never writes. Set AGENT_API_KEY
  // in Vercel to enable; each deployment can use its own value.
  const agentKey = (process.env.AGENT_API_KEY || '').trim();
  if (agentKey && req.headers.get('authorization') === `Bearer ${agentKey}`) {
    const readable = req.method === 'GET' && pathname.startsWith('/api/') && !pathname.startsWith('/api/debug');
    const askable = req.method === 'POST' && pathname === '/api/insights/ask';
    if (readable || askable) return NextResponse.next();
    return new NextResponse(JSON.stringify({ error: 'This key is read-only (GET /api/* and POST /api/insights/ask).' }), { status: 403, headers: { 'content-type': 'application/json' } });
  }

  const token = await getToken({ req, secret });
  // token.role === null means the periodic re-check found the user removed
  // from the allowlist — stop honoring the session even though the JWT is
  // otherwise still valid.
  // 30 days after signing in, the session no longer counts: sign in again.
  const expired = Boolean(token) && typeof token!.signedInAt === 'number' && Math.floor(Date.now() / 1000) - (token!.signedInAt as number) > 60 * 60 * 24 * 30;
  if (token && token.role !== null && !expired) {
    // Debug endpoints expose raw data — admins only.
    if (pathname.startsWith('/api/debug') && token.role !== 'admin') {
      return new NextResponse(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    // Partners (outside agencies) get a fixed slice of pages and the API
    // routes behind them; anything else is refused before it runs.
    if (token.role === 'partner' && !partnerCanOpen(pathname)) {
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      const home = req.nextUrl.clone();
      home.pathname = '/dashboard';
      home.search = '';
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // Unauthenticated: 401 for APIs, redirect to /login for pages.
  if (pathname.startsWith('/api/')) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Carry the full page (incl. ?tf= and dates) back after sign-in, and let
  // the login page start Google immediately instead of waiting for a tap.
  url.search = `?auto=1&callbackUrl=${encodeURIComponent(pathname + (req.nextUrl.search || ''))}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|brand-icon|brands/|robots.txt).*)'],
};
