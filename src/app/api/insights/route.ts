import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getDateRange(tf: string, dateFrom?: string, dateTo?: string): { from: string; to: string; label: string } {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [y, m] = todayStr.split('-').map(Number);

  if (tf === 'custom' && dateFrom && dateTo) {
    return { from: dateFrom, to: dateTo, label: `${dateFrom} to ${dateTo}` };
  }
  if (tf === '30d') return { from: addDays(todayStr, -30), to: todayStr, label: 'Last 30 days' };
  if (tf === '90d') return { from: addDays(todayStr, -90), to: todayStr, label: 'Last 90 days' };
  if (tf === '6m')  return { from: addDays(todayStr, -180), to: todayStr, label: 'Last 6 months' };
  if (tf === 'ytd') return { from: `${y}-01-01`, to: todayStr, label: `Year to date (${y})` };

  // Q4 last year: Oct 1 – Dec 31
  if (tf === 'q4_last') {
    const ly = y - 1;
    return { from: `${ly}-10-01`, to: `${ly}-12-31`, label: `Q4 ${ly} (Oct–Dec)` };
  }
  // Q3 last year: Jul 1 – Sep 30
  if (tf === 'q3_last') {
    const ly = y - 1;
    return { from: `${ly}-07-01`, to: `${ly}-09-30`, label: `Q3 ${ly} (Jul–Sep)` };
  }
  // Q1/Q2/Q3/Q4 this year
  if (tf === 'q1') return { from: `${y}-01-01`, to: `${y}-03-31`, label: `Q1 ${y}` };
  if (tf === 'q2') return { from: `${y}-04-01`, to: `${y}-06-30`, label: `Q2 ${y}` };
  if (tf === 'q3') return { from: `${y}-07-01`, to: `${y}-09-30`, label: `Q3 ${y}` };
  if (tf === 'q4') return { from: `${y}-10-01`, to: `${y}-12-31`, label: `Q4 ${y}` };
  // Holiday season (Nov 1 – Dec 31 last year)
  if (tf === 'holiday_last') {
    const ly = y - 1;
    return { from: `${ly}-11-01`, to: `${ly}-12-31`, label: `Holiday ${ly} (Nov–Dec)` };
  }
  // Compare mode: Q4 last year vs current period — handled in the route
  // Default fallback
  return { from: addDays(todayStr, -30), to: todayStr, label: 'Last 30 days' };
}

async function fetchDataForRange(
  from: string,
  to: string,
  baseUrl: string
): Promise<{ metrics: Record<string, number>; products: Record<string, unknown>[]; platforms: Record<string, unknown>[]; returns: Record<string, unknown> }> {
  const params = `tf=custom&date_from=${from}&date_to=${to}`;
  const [overviewRes, productsRes, adsRes, returnsRes] = await Promise.all([
    fetch(`${baseUrl}/api/windsor?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${baseUrl}/api/windsor/products?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${baseUrl}/api/windsor/ads?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${baseUrl}/api/windsor/returns?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
  ]);
  return {
    metrics: overviewRes?.metrics ?? {},
    products: productsRes?.products?.slice(0, 10) ?? [],
    platforms: adsRes?.platforms ?? [],
    returns: returnsRes ?? {},
  };
}

function buildSnapshot(
  label: string,
  data: { metrics: Record<string, number>; products: Record<string, unknown>[]; platforms: Record<string, unknown>[]; returns: Record<string, unknown> }
): string {
  const { metrics, products, platforms, returns } = data;
  const topReturned = (returns.topReturnedProducts as { name: string; returnRate: number }[] | undefined)
    ?.slice(0, 3).map(p => `${p.name} (${(p.returnRate * 100).toFixed(1)}%)`).join(', ') || 'N/A';

  return `
### ${label}
- Revenue: $${(metrics.totalRevenue ?? 0).toLocaleString()}
- Orders: ${(metrics.totalOrders ?? 0).toLocaleString()}
- AOV: $${(metrics.aov ?? 0).toFixed(2)}
- Ad Spend: $${(metrics.totalAdSpend ?? 0).toLocaleString()}
- MER: ${metrics.mer ? metrics.mer.toFixed(2) + 'x' : 'N/A'}
- New Customers: ${metrics.pctNew ? Math.round(metrics.pctNew) + '%' : 'N/A'}
- Return Rate: ${(returns as { returnRate?: number }).returnRate ? ((returns as { returnRate: number }).returnRate * 100).toFixed(1) + '%' : 'N/A'}
Ad Platforms: ${(platforms as { platform: string; spend: number; roas: number; ctr: number; clicks: number }[]).length > 0
    ? (platforms as { platform: string; spend: number; roas: number; ctr: number; clicks: number }[]).map(p => `${p.platform} $${p.spend.toLocaleString()} spend ${p.roas}x ROAS ${p.ctr}% CTR`).join(' | ')
    : 'N/A'}
Top Products: ${(products as { name: string; revenue: number; unitsSold: number; grossMargin: number }[]).length > 0
    ? (products as { name: string; revenue: number; unitsSold: number; grossMargin: number }[]).map((p, i) => `${i + 1}. ${p.name} $${p.revenue.toLocaleString()} ${p.unitsSold}u ${p.grossMargin.toFixed(0)}%mgn`).join(' | ')
    : 'N/A'}
Top Returned: ${topReturned}`.trim();
}

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const tf = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareMode = searchParams.get('compare') === 'true';

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const primary = getDateRange(tf, dateFrom, dateTo);

  // Comparison: always compares against Q4 of last year
  const todayYear = new Date().getFullYear();
  const compare = getDateRange('q4_last');

  let dataSnapshotText: string;
  let primaryData: Awaited<ReturnType<typeof fetchDataForRange>>;
  let compareData: Awaited<ReturnType<typeof fetchDataForRange>> | null = null;

  if (compareMode) {
    [primaryData, compareData] = await Promise.all([
      fetchDataForRange(primary.from, primary.to, baseUrl),
      fetchDataForRange(compare.from, compare.to, baseUrl),
    ]);
    dataSnapshotText = `
## Rocknot Performance Comparison

${buildSnapshot(primary.label, primaryData)}

${buildSnapshot(`Q4 ${todayYear - 1} (Comparison)`, compareData)}
`.trim();
  } else {
    primaryData = await fetchDataForRange(primary.from, primary.to, baseUrl);
    dataSnapshotText = `
## Rocknot Performance — ${primary.label}

${buildSnapshot(primary.label, primaryData)}
`.trim();
  }

  const compareInstruction = compareMode
    ? `You are comparing two periods. Reference both periods specifically — call out what improved, what declined, and what it means for strategy. Be direct about year-over-year differences.`
    : `Reference the specific period (${primary.label}) in your recommendations.`;

  const prompt = `You are a sharp e-commerce marketing strategist advising Rocknot, a music-inspired lifestyle/apparel brand. ${compareInstruction} Generate specific, actionable insights across 4 categories based on the real performance data below. Reference actual product names, numbers, and platform names. No generic advice.

${dataSnapshotText}

Respond ONLY with valid JSON in this exact shape — no markdown fences, no commentary outside the JSON:
{
  "creatives": [
    { "title": "short headline", "insight": "1-2 sentence specific recommendation referencing real data" }
  ],
  "products": [
    { "title": "short headline", "insight": "1-2 sentence specific recommendation" }
  ],
  "promos": [
    { "title": "short headline", "insight": "1-2 sentence specific recommendation" }
  ],
  "retention": [
    { "title": "short headline", "insight": "1-2 sentence specific recommendation" }
  ]
}

Each array must have exactly 4 items. Keep titles under 6 words.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (message.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(text);
    return NextResponse.json({
      ok: true,
      insights: parsed,
      snapshot: {
        dateFrom: primary.from,
        dateTo: primary.to,
        label: primary.label,
        compareLabel: compareMode ? compare.label : null,
        metrics: primaryData.metrics,
        productsCount: primaryData.products.length,
        platforms: (primaryData.platforms as { platform: string }[]).map(p => p.platform),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
