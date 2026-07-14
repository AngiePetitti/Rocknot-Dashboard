import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Claude analysis can take a while

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getDateRange(tf: string, dateFrom?: string, dateTo?: string): { from: string; to: string; label: string } {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [y] = todayStr.split('-').map(Number);

  if (tf === 'custom' && dateFrom && dateTo) {
    return { from: dateFrom, to: dateTo, label: `${dateFrom} to ${dateTo}` };
  }
  if (tf === '30d') return { from: addDays(todayStr, -30), to: todayStr, label: 'Last 30 days' };
  if (tf === '90d') return { from: addDays(todayStr, -90), to: todayStr, label: 'Last 90 days' };
  if (tf === '6m')  return { from: addDays(todayStr, -180), to: todayStr, label: 'Last 6 months' };
  if (tf === 'ytd') return { from: `${y}-01-01`, to: todayStr, label: `Year to date (${y})` };
  if (tf === 'q4_last') {
    const ly = y - 1;
    return { from: `${ly}-10-01`, to: `${ly}-12-31`, label: `Q4 ${ly} (Oct–Dec)` };
  }
  if (tf === 'q3_last') {
    const ly = y - 1;
    return { from: `${ly}-07-01`, to: `${ly}-09-30`, label: `Q3 ${ly} (Jul–Sep)` };
  }
  if (tf === 'q1') return { from: `${y}-01-01`, to: `${y}-03-31`, label: `Q1 ${y}` };
  if (tf === 'q2') return { from: `${y}-04-01`, to: `${y}-06-30`, label: `Q2 ${y}` };
  if (tf === 'q3') return { from: `${y}-07-01`, to: `${y}-09-30`, label: `Q3 ${y}` };
  if (tf === 'q4') return { from: `${y}-10-01`, to: `${y}-12-31`, label: `Q4 ${y}` };
  if (tf === 'holiday_last') {
    const ly = y - 1;
    return { from: `${ly}-11-01`, to: `${ly}-12-31`, label: `Holiday ${ly} (Nov–Dec)` };
  }
  return { from: addDays(todayStr, -30), to: todayStr, label: 'Last 30 days' };
}

// Internal API fetches must (a) target this deployment's own origin — not a
// hardcoded env fallback — and (b) forward the caller's session cookie, or the
// auth middleware will 401 every one of them and Claude gets empty data.
function makeFetcher(origin: string, cookie: string) {
  return async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`${origin}${path}`, {
        cache: 'no-store',
        headers: cookie ? { cookie } : undefined,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
}

interface RangeData {
  metrics: Record<string, number>;
  products: Record<string, unknown>[];
  platforms: Record<string, unknown>[];
  returns: Record<string, unknown>;
}

async function fetchDataForRange(get: (p: string) => Promise<Record<string, unknown> | null>, from: string, to: string): Promise<RangeData> {
  const params = `tf=custom&date_from=${from}&date_to=${to}`;
  const [overview, products, ads, returns] = await Promise.all([
    get(`/api/windsor?${params}`),
    get(`/api/windsor/products?${params}`),
    get(`/api/windsor/ads?${params}`),
    get(`/api/windsor/returns?${params}`),
  ]);
  return {
    metrics: (overview?.metrics as Record<string, number>) ?? {},
    products: ((products?.products as Record<string, unknown>[]) ?? []).slice(0, 12),
    platforms: (ads?.platforms as Record<string, unknown>[]) ?? [],
    returns: returns ?? {},
  };
}

function buildSnapshot(label: string, data: RangeData): string {
  const { metrics, products, platforms, returns } = data;
  const topReturned = (returns.topReturnedProducts as { name: string; returnRate: number }[] | undefined)
    ?.slice(0, 3).map(p => `${p.name} (${p.returnRate}%)`).join(', ') || 'N/A';
  const newCac = metrics.newCustomers ? `$${Math.round((metrics.totalAdSpend ?? 0) / metrics.newCustomers)}` : 'N/A';

  return `
### ${label}
- Revenue: $${(metrics.totalRevenue ?? 0).toLocaleString()} · Orders: ${(metrics.totalOrders ?? 0).toLocaleString()} · AOV: $${(metrics.aov ?? 0).toFixed(2)}
- Ad Spend: $${(metrics.totalAdSpend ?? 0).toLocaleString()} · MER: ${metrics.mer ? metrics.mer.toFixed(2) + 'x' : 'N/A'}
- New Customer CAC: ${newCac} · New customers: ${metrics.newCustomers ?? 'N/A'} (${metrics.pctNew ?? '?'}%) · Returning: ${metrics.returningCustomers ?? 'N/A'}
- Website conversion rate: ${metrics.conversionRate ? metrics.conversionRate + '%' : 'N/A'}
- Return rate: ${(returns as { returnRate?: number }).returnRate != null ? (returns as { returnRate: number }).returnRate + '%' : 'N/A'} · Top returned: ${topReturned}
Ad platforms: ${(platforms as { platform: string; spend: number; roas: number }[]).length > 0
    ? (platforms as { platform: string; spend: number; roas: number }[]).map(p => `${p.platform} $${p.spend.toLocaleString()} @ ${p.roas}x ROAS`).join(' | ')
    : 'N/A'}
Top products: ${(products as { name: string; revenue: number; unitsSold: number; grossMargin: number }[]).length > 0
    ? (products as { name: string; revenue: number; unitsSold: number; grossMargin: number }[]).map((p, i) => `${i + 1}. ${p.name} $${p.revenue.toLocaleString()} (${p.unitsSold}u, ${p.grossMargin?.toFixed?.(0) ?? '?'}% mgn)`).join(' | ')
    : 'N/A'}`.trim();
}

// Inventory & upcoming-launch context — range-independent, fetched once.
async function buildBusinessContext(get: (p: string) => Promise<Record<string, unknown> | null>): Promise<string> {
  const [inv, cal] = await Promise.all([
    get('/api/windsor/inventory'),
    get('/api/calendar'),
  ]);

  const lines: string[] = [];

  if (inv?.source === 'shopify_live') {
    const items = (inv.items as { product: string; variant: string; status: string; dailyVelocity: number; unitPrice: number }[]) ?? [];
    const fastOOS = items
      .filter(i => i.status === 'out_of_stock' && i.dailyVelocity >= 0.25)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity)
      .slice(0, 8)
      .map(i => `${i.product}${i.variant ? ' – ' + i.variant : ''} (~${Math.round(i.dailyVelocity * 7)}/wk, $${i.unitPrice})`);
    if (fastOOS.length) lines.push(`OUT OF STOCK fast-sellers (do NOT recommend promoting these until restocked): ${fastOOS.join(' | ')}`);

    const fin = inv.finance as { slowStockCostValue?: number; slowStockCount?: number } | undefined;
    if (fin?.slowStockCount) lines.push(`Slow/dead stock: $${(fin.slowStockCostValue ?? 0).toLocaleString()} tied up in ${fin.slowStockCount} items (candidates to move/discount/bundle)`);

    const move = (inv.moveOrDiscount as { product: string; variant: string; currentStock: number; unitPrice: number }[]) ?? [];
    if (move.length) lines.push(`Top move/discount candidates: ${move.slice(0, 6).map(i => `${i.product}${i.variant ? ' – ' + i.variant : ''} (${i.currentStock}u @ $${i.unitPrice})`).join(' | ')}`);
  }

  const events = (cal?.events as { title: string; date: string; endDate?: string; type: string; status?: string; channel?: string }[]) ?? [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const upcoming = events
    .filter(e => e.date && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 20)
    .map(e => `${e.date}: ${e.title} (${e.type}${e.channel ? ', ' + e.channel : ''})`);
  const live = events
    .filter(e => e.date && e.date <= today && (e.endDate || e.date) >= today)
    .map(e => `${e.title} (${e.type}, thru ${e.endDate || e.date})`);
  if (live.length) lines.push(`LIVE NOW (marketing calendar): ${live.join(' | ')}`);
  if (upcoming.length) lines.push(`UPCOMING launches/campaigns (marketing calendar): ${upcoming.join(' | ')}`);

  return lines.length ? `## Business context (current — not tied to the selected period)\n- ${lines.join('\n- ')}` : '';
}

// Structured-output schema — guarantees valid JSON, no brittle parsing.
const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'insight'],
  properties: {
    title: { type: 'string', description: 'Short headline, under 6 words' },
    insight: { type: 'string', description: '1-2 sentence specific recommendation referencing real product names and numbers' },
  },
} as const;

const INSIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'creatives', 'products', 'promos', 'retention'],
  properties: {
    summary: { type: 'string', description: '2-3 sentence executive summary: the single biggest opportunity and the single biggest risk right now, with numbers' },
    creatives: { type: 'array', items: ITEM, description: 'Exactly 4 ad creative ideas' },
    products: { type: 'array', items: ITEM, description: 'Exactly 4 product opportunities' },
    promos: { type: 'array', items: ITEM, description: 'Exactly 4 promo/campaign plays' },
    retention: { type: 'array', items: ITEM, description: 'Exactly 4 retention/growth plays' },
  },
} as const;

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const tf = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareMode = searchParams.get('compare') === 'true';

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get('cookie') || '';
  const get = makeFetcher(origin, cookie);

  const primary = getDateRange(tf, dateFrom, dateTo);
  const todayYear = new Date().getFullYear();
  const compare = getDateRange('q4_last');

  const [primaryData, compareData, businessContext] = await Promise.all([
    fetchDataForRange(get, primary.from, primary.to),
    compareMode ? fetchDataForRange(get, compare.from, compare.to) : Promise.resolve(null),
    buildBusinessContext(get),
  ]);

  const dataSnapshotText = compareMode && compareData
    ? `## Rocknot Performance Comparison\n\n${buildSnapshot(primary.label, primaryData)}\n\n${buildSnapshot(`Q4 ${todayYear - 1} (Comparison)`, compareData)}`
    : `## Rocknot Performance — ${primary.label}\n\n${buildSnapshot(primary.label, primaryData)}`;

  const compareInstruction = compareMode
    ? 'You are comparing two periods. Reference both specifically — what improved, what declined, and what it means for strategy.'
    : `Reference the specific period (${primary.label}) in your recommendations.`;

  const prompt = `You are a sharp e-commerce marketing strategist advising Rocknot, a music-inspired handbag & accessories brand (bags with interchangeable straps, jewelry, phone accessories). ${compareInstruction}

Rules:
- Reference actual product names, dollar figures, and platform names from the data. No generic advice.
- Cross-reference the business context: tie recommendations to UPCOMING launches on the marketing calendar, never recommend promoting items listed as out of stock, and suggest concrete plays for slow/dead stock.
- Exactly 4 items per category. Titles under 6 words.

${dataSnapshotText}

${businessContext}`.trim();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: INSIGHTS_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The model declined to analyze this request. Try again.' }, { status: 502 });
    }

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
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
        hasInventoryContext: businessContext.includes('OUT OF STOCK') || businessContext.includes('Slow/dead'),
        hasCalendarContext: businessContext.includes('UPCOMING') || businessContext.includes('LIVE NOW'),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
