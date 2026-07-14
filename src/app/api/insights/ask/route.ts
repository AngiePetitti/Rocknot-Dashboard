import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Internal fetches forward the caller's session cookie (auth middleware) and
// use this deployment's own origin.
function makeFetcher(origin: string, cookie: string) {
  return async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`${origin}${path}`, { cache: 'no-store', headers: cookie ? { cookie } : undefined });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
}

// One rich, analyst-grade data bundle: 90 days of daily figures plus current
// inventory and the marketing calendar. Compact CSV-style lines keep tokens low.
async function buildDataContext(get: (p: string) => Promise<Record<string, unknown> | null>): Promise<string> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from90 = addDays(today, -90);
  const params = `tf=custom&date_from=${from90}&date_to=${addDays(today, -1)}`;

  const [overview, products, ads, returns, inv, cal] = await Promise.all([
    get(`/api/windsor?${params}`),
    get(`/api/windsor/products?${params}`),
    get(`/api/windsor/ads?${params}`),
    get(`/api/windsor/returns?${params}`),
    get('/api/windsor/inventory'),
    get('/api/calendar'),
  ]);

  const parts: string[] = [];
  const m = (overview?.metrics as Record<string, number>) ?? {};

  parts.push(`## 90-day summary (${from90} → yesterday)
Revenue $${(m.totalRevenue ?? 0).toLocaleString()} · Orders ${(m.totalOrders ?? 0).toLocaleString()} · AOV $${(m.aov ?? 0).toFixed(2)} · Ad spend $${(m.totalAdSpend ?? 0).toLocaleString()} · MER ${m.mer?.toFixed?.(2) ?? '?'}x
Meta $${(m.metaSpend ?? 0).toLocaleString()} · Google $${(m.googleSpend ?? 0).toLocaleString()} · TikTok $${(m.tiktokSpend ?? 0).toLocaleString()}
New customers ${m.newCustomers ?? '?'} (${m.pctNew ?? '?'}%) · Returning ${m.returningCustomers ?? '?'} · Conversion rate ${m.conversionRate ?? '?'}%`);

  const daily = (overview?.revenueData as { date: string; revenue: number; orders: number; adSpend: number; newCustomers?: number; totalCustomers?: number }[]) ?? [];
  if (daily.length) {
    parts.push(`## Daily series (date,revenue,orders,adSpend,newCustomers,totalBuyers)
${daily.map(d => `${d.date},${d.revenue},${d.orders},${d.adSpend},${d.newCustomers ?? ''},${d.totalCustomers ?? ''}`).join('\n')}`);
  }

  const plats = (ads?.platforms as { platform: string; spend: number; revenue: number; roas: number; clicks: number; conversions: number }[]) ?? [];
  if (plats.length) {
    parts.push(`## Ad platforms (90d)
${plats.map(p => `${p.platform}: $${p.spend.toLocaleString()} spend, $${p.revenue.toLocaleString()} attributed revenue, ${p.roas}x ROAS, ${p.clicks} clicks, ${p.conversions} conversions`).join('\n')}`);
  }

  const prods = (products?.products as { name: string; category: string; revenue: number; unitsSold: number; grossMargin: number; percentOfTotal: number }[]) ?? [];
  if (prods.length) {
    parts.push(`## Top products (90d, by revenue)
${prods.slice(0, 25).map((p, i) => `${i + 1}. ${p.name} [${p.category}] $${p.revenue.toLocaleString()} · ${p.unitsSold}u · ${p.grossMargin?.toFixed?.(0) ?? '?'}% margin · ${p.percentOfTotal}% of total`).join('\n')}`);
  }

  const rr = returns as { returnRate?: number; totalReturns?: number; topReturnedProducts?: { name: string; returnRate: number }[] } | null;
  if (rr?.returnRate != null) {
    parts.push(`## Returns (90d)
Return rate ${rr.returnRate}% · $${(rr.totalReturns ?? 0).toLocaleString()} returned
Top returned: ${(rr.topReturnedProducts ?? []).slice(0, 5).map(p => `${p.name} (${p.returnRate}%)`).join(', ') || 'N/A'}`);
  }

  if (inv?.source === 'shopify_live') {
    const items = (inv.items as { product: string; variant: string; status: string; dailyVelocity: number; currentStock: number; unitPrice: number }[]) ?? [];
    const bags = (inv.bags as { product: string; currentStock: number; unitsSold90d: number; unitPrice: number }[]) ?? [];
    const fin = inv.finance as { totalCostValue?: number; totalRetailValue?: number; slowStockCostValue?: number; slowStockCount?: number } | undefined;
    const oos = items.filter(i => i.status === 'out_of_stock' && i.dailyVelocity >= 0.25)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity).slice(0, 10)
      .map(i => `${i.product}${i.variant ? ' – ' + i.variant : ''} (~${Math.round(i.dailyVelocity * 7)}/wk, $${i.unitPrice})`);
    parts.push(`## Inventory (current)
Stock at cost $${(fin?.totalCostValue ?? 0).toLocaleString()} · at retail $${(fin?.totalRetailValue ?? 0).toLocaleString()} · slow/dead $${(fin?.slowStockCostValue ?? 0).toLocaleString()} across ${fin?.slowStockCount ?? 0} items
Out-of-stock fast sellers: ${oos.join(' | ') || 'none'}
True bag stock: ${bags.slice(0, 30).map(b => `${b.product} ${b.currentStock}u ($${b.unitPrice}, sold90 ${b.unitsSold90d})`).join(' | ')}`);
  }

  const events = (cal?.events as { title: string; date: string; endDate?: string; type: string; status?: string; channel?: string }[]) ?? [];
  const upcoming = events.filter(e => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 25);
  if (upcoming.length) {
    parts.push(`## Marketing calendar (upcoming)
${upcoming.map(e => `${e.date}: ${e.title} (${e.type}${e.channel ? ', ' + e.channel : ''}${e.status ? ', ' + e.status : ''})`).join('\n')}`);
  }

  return parts.join('\n\n');
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter(mm => (mm.role === 'user' || mm.role === 'assistant') && typeof mm.content === 'string' && mm.content.trim())
    .slice(-16); // keep the conversation bounded
  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Send at least one user message' }, { status: 400 });
  }

  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const dataContext = await buildDataContext(get);

  const system = `You are the in-house data analyst for Rocknot, a music-inspired handbag & accessories brand. Answer the operator's questions using ONLY the data below — treat it as the source of truth.

Approach every question like a data scientist:
- Quantify. Cite the actual numbers, and when you derive something (growth rate, CAC, contribution margin, day-of-week pattern), show the calculation briefly.
- Compare against a baseline where useful (earlier weeks in the series, category averages).
- Separate correlation from causation, and say so when the data can only show correlation.
- If the data provided cannot answer the question, say exactly what's missing rather than guessing. Never invent numbers.
- Be concise and skimmable: lead with the answer, then the supporting numbers. Plain text with simple bullets — no headers or tables.

Data available: 90 days of daily revenue/orders/ad-spend/customer figures, per-platform ad performance, top products with margins, returns, current inventory (including true bag stock and out-of-stock fast sellers), and the upcoming marketing calendar.

${dataContext}`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // Cache the (large, per-question-stable) data context so follow-up
      // questions in the same session are fast and cheap.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: history,
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The model declined to answer this question. Try rephrasing.' }, { status: 502 });
    }

    const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return NextResponse.json({ ok: true, answer });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
