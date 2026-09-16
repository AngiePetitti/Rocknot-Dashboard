import { ImageResponse } from 'next/og';
import { getClient } from '@/src/lib/client';

// Per-client favicon: the brand's first letter on the profile's accent
// gradient, so the Rocknot and Kailee P tabs are distinguishable at a glance.
// Rendered at request time because CLIENT is a runtime env var.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

export default function Icon() {
  const c = getClient();
  const { accentFrom, accentTo } = c.theme;
  // Keep the letter legible on light gradients (Kailee P's pastel pink/lavender).
  const light = (luminance(accentFrom) + luminance(accentTo)) / 2 > 0.5;
  const letter = (c.initial || c.name.charAt(0) || 'A').toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 14,
          background: `linear-gradient(135deg, ${accentFrom}, ${accentTo})`,
          color: light ? '#3b0764' : '#ffffff',
          fontSize: 40,
          fontWeight: 700,
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      >
        {letter}
      </div>
    ),
    size,
  );
}
