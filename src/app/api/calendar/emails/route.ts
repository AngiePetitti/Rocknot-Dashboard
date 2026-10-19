import { NextResponse } from 'next/server';
import { listCampaignsForCalendar, klaviyoConfigured } from '@/src/lib/klaviyo';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Klaviyo campaigns (email + SMS) with send times, for the Marketing
// Calendar's ✉️ overlay. Read-only — content edits happen in Klaviyo via
// the deep link the calendar modal shows.
export async function GET() {
  if (!klaviyoConfigured()) {
    return NextResponse.json({ configured: false, campaigns: [] });
  }
  try {
    const campaigns = await listCampaignsForCalendar();
    return NextResponse.json({ configured: true, campaigns }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ configured: true, campaigns: [], error: String(e).slice(0, 200) }, { status: 502 });
  }
}
