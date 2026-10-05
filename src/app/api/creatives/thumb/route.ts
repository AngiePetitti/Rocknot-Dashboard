import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';

// Stable thumbnail URL for an ad: /api/creatives/thumb?p=Meta&id=<ad id>.
// Platform CDN thumbnail links expire within days, which would blank the
// images in saved Cleo reports — this resolves the ad's CURRENT thumbnail
// from the creatives feed (6-month window, cached) and redirects to it.
const PLACEHOLDER = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" rx="24" fill="#f3f4f6"/><text x="160" y="150" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#9ca3af">No preview</text><text x="160" y="178" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#9ca3af">${label}</text></svg>`;

export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return new NextResponse('Not signed in', { status: 401 });
  }
  const platform = (req.nextUrl.searchParams.get('p') || '').trim();
  const id = (req.nextUrl.searchParams.get('id') || '').trim();
  const kind = (req.nextUrl.searchParams.get('kind') || 'ad').trim();
  const placeholder = () => new NextResponse(PLACEHOLDER(platform || 'ad'), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=600' } });
  if (!platform || !id) return placeholder();
  // Organic Instagram / Pinterest posts: resolve from the organic feed (posts
  // published in the last 6 months).
  if (kind === 'organic') {
    try {
      const res = await fetch(`${req.nextUrl.origin}/api/organic?tf=6m`, { headers: { cookie: req.headers.get('cookie') || '' }, next: { revalidate: 1800 } });
      const json = await res.json();
      const block = (platform === 'Pinterest' ? json?.pinterest : json?.instagram) as { items?: Array<{ id: string; imageUrl: string }> } | undefined;
      const hit = (block?.items || []).find(p => String(p.id) === id);
      if (hit?.imageUrl) return NextResponse.redirect(hit.imageUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=3600' } });
    } catch { /* placeholder */ }
    return placeholder();
  }
  try {
    const res = await fetch(`${req.nextUrl.origin}/api/windsor/creatives?tf=6m`, {
      headers: { cookie: req.headers.get('cookie') || '' },
      next: { revalidate: 3600 },
    });
    const json = await res.json();
    const rows = (json?.creatives || []) as Array<{ id: string; platform: string; thumbnailUrl: string | null }>;
    const hit = rows.find(c => String(c.id) === id && c.platform === platform) || rows.find(c => String(c.id) === id);
    if (hit?.thumbnailUrl) {
      return NextResponse.redirect(hit.thumbnailUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=3600' } });
    }
  } catch { /* fall through to placeholder */ }
  return placeholder();
}
