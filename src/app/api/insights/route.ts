import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const dateFrom = addDays(todayStr, -30);
  const dateTo = todayStr;
  const params = `tf=30d&date_from=${dateFrom}&date_to=${dateTo}`;

  // Fetch all data sources in parallel — best-effort, errors become null
  const [overviewRes, productsRes, adsRes, returnsRes] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/windsor?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/windsor/products?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/windsor/ads?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/windsor/returns?${params}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
  ]);

  const metrics = overviewRes?.metrics ?? {};
  const products: { name: string; revenue: number; unitsSold: number; grossMargin: number; percentOfTotal: number; category: string }[] = productsRes?.products?.slice(0, 10) ?? [];
  const platforms: { platform: string; spend: number; revenue: number; roas: number; clicks: number; ctr: number }[] = adsRes?.platforms ?? [];
  const returns = returnsRes ?? {};

  const dataSnapshot = `
## Rocknot — Last 30 Days Performance Snapshot

### Overview Metrics
- Total Revenue: $${(metrics.totalRevenue ?? 0).toLocaleString()}
- Total Orders: ${(metrics.totalOrders ?? 0).toLocaleString()}
- Average Order Value: $${(metrics.aov ?? 0).toFixed(2)}
- Total Ad Spend: $${(metrics.totalAdSpend ?? 0).toLocaleString()}
- Blended MER (Revenue / Ad Spend): ${metrics.mer ? metrics.mer.toFixed(2) + 'x' : 'N/A'}
- New Customers: ${metrics.pctNew ? Math.round(metrics.pctNew) + '%' : 'N/A'} of buyers
- Returning Customers: ${metrics.pctReturning ? Math.round(metrics.pctReturning) + '%' : 'N/A'} of buyers
- Return Rate: ${returns.returnRate ? (returns.returnRate * 100).toFixed(1) + '%' : 'N/A'}

### Ad Platform Performance
${platforms.length > 0 ? platforms.map(p =>
  `- **${p.platform}**: $${p.spend.toLocaleString()} spend · ${p.roas}x ROAS · ${p.ctr}% CTR · ${p.clicks.toLocaleString()} clicks`
).join('\n') : '- No ad data available'}

### Top 10 Products by Revenue
${products.length > 0 ? products.map((p, i) =>
  `${i + 1}. ${p.name} — $${p.revenue.toLocaleString()} revenue · ${p.unitsSold} units · ${p.grossMargin.toFixed(0)}% margin · ${p.percentOfTotal.toFixed(1)}% of total`
).join('\n') : '- No product data available'}

### Returns
- Return Rate: ${returns.returnRate ? (returns.returnRate * 100).toFixed(1) + '%' : 'N/A'}
- Top returned: ${returns.topReturnedProducts?.slice(0, 3).map((p: { name: string; returnRate: number }) => `${p.name} (${(p.returnRate * 100).toFixed(1)}%)`).join(', ') || 'N/A'}
`.trim();

  const prompt = `You are a sharp e-commerce marketing strategist advising Rocknot, a music-inspired lifestyle/apparel brand. Based on the last 30 days of real performance data below, generate specific, actionable insights across 4 categories. Be direct and concrete — reference actual product names, numbers, and platform names from the data. No fluff.

${dataSnapshot}

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

Each array must have exactly 4 items. Keep titles under 6 words. Insights must be specific to Rocknot's actual numbers.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (message.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(text);
    return NextResponse.json({ ok: true, insights: parsed, snapshot: { dateFrom, dateTo, metrics, productsCount: products.length, platforms: platforms.map(p => p.platform) } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
