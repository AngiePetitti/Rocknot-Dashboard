import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Stable image URL for an ad or organic post:
//   /api/creatives/thumb?p=Meta&id=<ad id>
//   /api/creatives/thumb?kind=organic&p=Instagram&id=<media id>
// Platform CDN links expire within days (and some refuse cross-site <img>
// requests), which would blank the images in saved Cleo reports. This
// resolves the item's CURRENT image from the dashboard's own feeds and
// streams the bytes itself. Add &debug=1 to see what it resolved.
const PLACEHOLDER = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" rx="24" fill="#f3f4f6"/><text x="160" y="150" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#9ca3af">No preview</text><text x="160" y="178" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#9ca3af">${label}</text></svg>`;

async function resolveUrl(req: NextRequest, kind: string, platform: string, id: string, diag: Record<string, unknown>): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const origin = req.nextUrl.origin;
  if (kind === 'organic') {
    const only = platform === 'Pinterest' ? 'pinterest' : 'instagram';
    const res = await fetch(`${origin}/api/organic?tf=6m&only=${only}`, { headers: { cookie }, next: { revalidate: 1800 }, signal: AbortSignal.timeout(40000) });
    diag.feedStatus = res.status;
    const json = await res.json();
    const block = (json?.[only]) as { status?: string; error?: string; items?: Array<{ id: string; imageUrl: string }> } | undefined;
    diag.blockStatus = block?.status; diag.blockError = block?.error; diag.items = block?.items?.length ?? 0;
    const hit = (block?.items || []).find(p => String(p.id) === id);
    diag.hit = Boolean(hit);
    return hit?.imageUrl || null;
  }
  const res = await fetch(`${origin}/api/windsor/creatives?tf=6m`, { headers: { cookie }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(40000) });
  diag.feedStatus = res.status;
  const json = await res.json();
  const rows = (json?.creatives || []) as Array<{ id: string; platform: string; thumbnailUrl: string | null }>;
  diag.items = rows.length;
  const hit = rows.find(c => String(c.id) === id && c.platform === platform) || rows.find(c => String(c.id) === id);
  diag.hit = Boolean(hit);
  return hit?.thumbnailUrl || null;
}

export async function GET(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return new NextResponse('Not signed in', { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const platform = (sp.get('p') || '').trim();
  const id = (sp.get('id') || '').trim();
  const kind = (sp.get('kind') || 'ad').trim();
  const debug = sp.get('debug') === '1';
  const diag: Record<string, unknown> = { kind, platform, id };
  const placeholder = () => debug
    ? NextResponse.json({ resolved: null, ...diag })
    : new NextResponse(PLACEHOLDER(platform || 'ad'), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=300' } });
  if (!platform || !id) return placeholder();

  let url: string | null = null;
  try { url = await resolveUrl(req, kind, platform, id, diag); } catch (e) { diag.resolveError = e instanceof Error ? e.message : String(e); }
  if (!url) return placeholder();
  diag.resolved = url;

  // Stream the image bytes (no cross-site redirect to the platform CDN).
  try {
    const img = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (A6 Dashboard)' }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(15000) });
    diag.imageStatus = img.status; diag.imageType = img.headers.get('content-type');
    if (debug) return NextResponse.json(diag);
    if (!img.ok) return placeholder();
    const buf = await img.arrayBuffer();
    return new NextResponse(buf, { headers: { 'Content-Type': img.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    diag.imageError = e instanceof Error ? e.message : String(e);
    return placeholder();
  }
}
