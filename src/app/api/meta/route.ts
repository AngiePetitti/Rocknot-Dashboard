import { NextRequest, NextResponse } from 'next/server';
import { getPlatformSpendForTimeframe } from '@/src/lib/mockData';
import { Timeframe } from '@/src/lib/mockData';

const TOKEN = process.env.META_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

const DATE_PRESETS: Record<Timeframe, string> = {
  today:      'today',
  yesterday:  'yesterday',
  '7d':       'last_7d',
  '14d':      'last_14d',
  '30d':      'last_30d',
  mtd:        'this_month',
  last_month: 'last_month',
  '6m':       'last_6_months',
  ytd:        'this_year',
};

export async function GET(request: NextRequest) {
  const tf = (request.nextUrl.searchParams.get('tf') || '30d') as Timeframe;

  if (!TOKEN || !ACCOUNT_ID) {
    // Fall back to mock data if credentials not set
    const allPlatforms = getPlatformSpendForTimeframe(tf);
    const meta = allPlatforms.find(p => p.platform === 'Meta');
    return NextResponse.json({ source: 'mock', timeframe: tf, data: meta });
  }

  try {
    const preset = DATE_PRESETS[tf] || 'last_30d';
    const fields = 'spend,impressions,clicks,reach,actions,action_values,ctr,cpc,cpp,frequency';

    const url = `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/insights?fields=${fields}&date_preset=${preset}&access_token=${TOKEN}`;
    const res = await fetch(url, { next: { revalidate: 900 } }); // cache 15 min
    const json = await res.json();

    if (json.error) {
      throw new Error(json.error.message);
    }

    const d = json.data?.[0];
    if (!d) {
      return NextResponse.json({ source: 'meta', timeframe: tf, data: null, message: 'No data for period' });
    }

    // Pull purchase value from action_values
    const purchaseValue = d.action_values?.find((a: {action_type: string; value: string}) => a.action_type === 'purchase')?.value;
    const purchases = d.actions?.find((a: {action_type: string; value: string}) => a.action_type === 'purchase')?.value;

    const spend = parseFloat(d.spend || '0');
    const revenue = parseFloat(purchaseValue || '0');
    const roas = spend > 0 && revenue > 0 ? revenue / spend : null;

    return NextResponse.json({
      source: 'meta',
      timeframe: tf,
      data: {
        platform: 'Meta',
        spend,
        revenue,
        roas,
        impressions: parseInt(d.impressions || '0'),
        clicks: parseInt(d.clicks || '0'),
        ctr: parseFloat(d.ctr || '0'),
        cpc: parseFloat(d.cpc || '0'),
        reach: parseInt(d.reach || '0'),
        purchases: parseInt(purchases || '0'),
        color: '#1877F2',
      },
    });
  } catch (err) {
    const allPlatforms = getPlatformSpendForTimeframe(tf);
    const meta = allPlatforms.find(p => p.platform === 'Meta');
    return NextResponse.json({
      source: 'mock_fallback',
      error: err instanceof Error ? err.message : 'Unknown error',
      timeframe: tf,
      data: meta,
    });
  }
}
