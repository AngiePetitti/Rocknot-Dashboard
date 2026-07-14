import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

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

  const token = await getToken({ req, secret });
  if (token) {
    // Debug endpoints expose raw data — admins only.
    if (pathname.startsWith('/api/debug') && token.role !== 'admin') {
      return new NextResponse(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return NextResponse.next();
  }

  // Unauthenticated: 401 for APIs, redirect to /login for pages.
  if (pathname.startsWith('/api/')) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?callbackUrl=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
