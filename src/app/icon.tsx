import { getClient } from '@/src/lib/client';

// Per-client favicon: the brand's first letter, bold white, on the profile's
// icon gradient — the same look as the original static R. Served as SVG so
// the browser renders true bold Arial (the PNG renderer has no bold font).
// Rendered at request time because CLIENT is a runtime env var.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const size = { width: 64, height: 64 };
export const contentType = 'image/svg+xml';

export default function Icon() {
  const c = getClient();
  const letter = (c.initial || c.name.charAt(0) || 'A').toUpperCase();
  const { from, to } = c.theme.icon;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="bold" fill="#ffffff">${letter}</text>
</svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' } });
}
