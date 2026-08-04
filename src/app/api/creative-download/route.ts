import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Streams an ad's video file back with a Content-Disposition attachment so
// phones/browsers save it with a clean filename instead of opening the raw
// CDN URL. Only the ad platforms' own CDNs are allowed.
const ALLOWED_HOST = /(\.fbcdn\.net|\.cdninstagram\.com|\.tiktokcdn(-us)?\.com|\.byteoversea\.com|\.sc-cdn\.net|\.snapchat\.com)$/i;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  const name = (req.nextUrl.searchParams.get('name') || 'creative')
    .replace(/[^\w\- ]+/g, '_').slice(0, 80);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOST.test(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }
  const upstream = await fetch(url, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
  }
  const type = upstream.headers.get('content-type') || 'video/mp4';
  const ext = /mp4|quicktime|webm/.exec(type)?.[0]?.replace('quicktime', 'mov') || 'mp4';
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${name}.${ext}"`,
      'Cache-Control': 'no-store',
    },
  });
}
