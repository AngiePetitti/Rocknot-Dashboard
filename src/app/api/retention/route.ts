import { NextRequest, NextResponse } from 'next/server';
import { klaviyoConfigured, fetchRetentionData } from '@/src/lib/klaviyo';
import { cacheHeaders } from '@/src/lib/cacheHeaders';
import { timeframeRange, addDays } from '@/src/lib/timeframes';
import { Timeframe } from '@/src/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Klaviyo campaign + flow performance for a dashboard timeframe.
//   /api/retention?tf=30d            (default)
//   /api/retention?tf=custom&date_from=…&date_to=…
//   …&compare=true  → also the immediately preceding period of equal length
//                      (or the month before, for last_month / mtd)
export async function GET(request: NextRequest) {
  if (!klaviyoConfigured()) {
    return NextResponse.json({
      source: 'error',
      error: 'Klaviyo not connected — create a Private API Key in Klaviyo (Settings → API Keys, read access to Campaigns, Flows + Metrics) and add it to Vercel as KLAVIYO_API_KEY.',
    });
  }
  const sp = request.nextUrl.searchParams;
  const tf = (sp.get('tf') || '30d') as Timeframe | 'custom';
  const { from, to } = timeframeRange(tf, sp.get('date_from'), sp.get('date_to'));
  const compare = sp.get('compare') === 'true';

  // Prior period: same length ending the day before `from`; calendar months
  // compare to the previous calendar month.
  let prior: { from: string; to: string } | null = null;
  if (compare) {
    if (tf === 'last_month' || tf === 'mtd') {
      const [y, m] = from.split('-').map(Number);
      const pFrom = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
      const pTo = tf === 'mtd'
        ? new Date(y, m - 2, Number(to.slice(8, 10))).toLocaleDateString('en-CA')
        : new Date(y, m - 1, 0).toLocaleDateString('en-CA');
      prior = { from: pFrom, to: pTo < pFrom ? pFrom : pTo };
    } else {
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      prior = { from: addDays(from, -days), to: addDays(from, -1) };
    }
  }

  try {
    // Sequential on purpose: Klaviyo's reporting quota is a few calls a
    // minute, and the values reports are cached for 10 minutes once fetched.
    const data = await fetchRetentionData(from, to);
    const priorData = prior ? await fetchRetentionData(prior.from, prior.to).catch(() => null) : null;
    return NextResponse.json({
      source: 'klaviyo_live',
      range: { from, to },
      ...data,
      ...(prior ? {
        prior: {
          range: prior,
          overview: priorData?.overview ?? null,
          flowRevenue: priorData?.flows?.revenue ?? null,
          flowRecipients: priorData?.flows?.recipients ?? null,
          error: priorData ? undefined : 'prior period unavailable',
        },
      } : {}),
    }, { headers: cacheHeaders(false) });
  } catch (e) {
    return NextResponse.json({ source: 'error', error: String(e instanceof Error ? e.message : e) });
  }
}
