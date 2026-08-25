import { NextResponse } from 'next/server';
import { klaviyoConfigured, fetchRetentionData } from '@/src/lib/klaviyo';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  if (!klaviyoConfigured()) {
    return NextResponse.json({
      source: 'error',
      error: 'Klaviyo not connected — create a Private API Key in Klaviyo (Settings → API Keys, read access to Campaigns + Metrics) and add it to Vercel as KLAVIYO_API_KEY.',
    });
  }
  try {
    const data = await fetchRetentionData();
    return NextResponse.json({ source: 'klaviyo_live', ...data }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e instanceof Error ? e.message : e) });
  }
}
