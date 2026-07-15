import type Anthropic from '@anthropic-ai/sdk';

// ── Internal data access ─────────────────────────────────────────────────
// The analyst queries the dashboard's own APIs. Fetches forward the caller's
// session cookie (auth middleware) and use this deployment's origin.
export function makeFetcher(origin: string, cookie: string) {
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

export type Getter = (p: string) => Promise<Record<string, unknown> | null>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// ── Tools the analyst can call ───────────────────────────────────────────
// Claude picks the date ranges the question implies; these execute against
// the dashboard APIs and return compact text.
export const ANALYST_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_metrics',
    description:
      'Sales & marketing metrics for any date range: revenue, orders, AOV, MER, ad spend (total and per platform), new/returning customers, conversion rate — plus a daily or monthly series of revenue/orders/adSpend/newCustomers/totalBuyers. Call this once per period you want to compare (e.g. once for last year, once for this year). Data availability varies by source; missing periods come back as zeros/N-A — report gaps honestly.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date, YYYY-MM-DD' },
        date_to: { type: 'string', description: 'End date, YYYY-MM-DD (use yesterday for "now" — today is partial)' },
        granularity: { type: 'string', enum: ['daily', 'monthly', 'total'], description: 'Series detail. Use monthly for ranges over ~90 days, daily for short ranges, total for just the headline numbers.' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_top_products',
    description: 'Top products by revenue for a date range, with units sold, gross margin %, and share of total revenue.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_ad_performance',
    description: 'Per-platform ad performance (Meta, Google, TikTok) for a date range: spend, attributed revenue, ROAS, clicks, conversions.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_returns',
    description: 'Return rate, total returned dollars, and most-returned products for a date range.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'get_inventory',
    description: 'CURRENT inventory state (not historical): stock value at cost/retail, slow/dead stock, out-of-stock fast sellers with weekly velocity, true bag stock counts with listing prices.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_marketing_calendar',
    description: 'The marketing calendar: campaigns/launches that are live now and everything scheduled ahead, with type, channel, and status.',
    input_schema: { type: 'object', properties: {} },
  },
];

export async function execTool(get: Getter, name: string, input: Record<string, unknown>): Promise<string> {
  const from = String(input.date_from ?? '');
  const to = String(input.date_to ?? '');
  const needsRange = ['get_metrics', 'get_top_products', 'get_ad_performance', 'get_returns'].includes(name);
  if (needsRange && (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to)) {
    return 'Error: date_from and date_to must be YYYY-MM-DD with date_from <= date_to.';
  }
  const params = `tf=custom&date_from=${from}&date_to=${to}`;

  if (name === 'get_metrics') {
    const d = await get(`/api/windsor?${params}`);
    if (!d?.metrics) return `No data returned for ${from} → ${to}.`;
    const m = d.metrics as Record<string, number>;
    const daily = (d.revenueData as { date: string; revenue: number; orders: number; adSpend: number; newCustomers?: number; totalCustomers?: number }[]) ?? [];

    let granularity = String(input.granularity ?? (daysBetween(from, to) > 92 ? 'monthly' : 'daily'));
    if (granularity === 'daily' && daily.length > 200) granularity = 'monthly'; // token guard

    let series = '';
    if (granularity === 'daily') {
      series = `\nDaily (date,revenue,orders,adSpend,newCustomers,totalBuyers):\n${daily.map(r => `${r.date},${r.revenue},${r.orders},${r.adSpend},${r.newCustomers ?? ''},${r.totalCustomers ?? ''}`).join('\n')}`;
    } else if (granularity === 'monthly') {
      const byMonth = new Map<string, { rev: number; ord: number; spend: number; nc: number; tc: number }>();
      for (const r of daily) {
        const k = r.date.slice(0, 7);
        const b = byMonth.get(k) || { rev: 0, ord: 0, spend: 0, nc: 0, tc: 0 };
        b.rev += r.revenue; b.ord += r.orders; b.spend += r.adSpend; b.nc += r.newCustomers ?? 0; b.tc += r.totalCustomers ?? 0;
        byMonth.set(k, b);
      }
      series = `\nMonthly (month,revenue,orders,adSpend,newCustomers,totalBuyers):\n${Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, b]) => `${k},${Math.round(b.rev)},${b.ord},${Math.round(b.spend)},${b.nc},${b.tc}`).join('\n')}`;
    }

    return `Metrics ${from} → ${to}:
Revenue $${(m.totalRevenue ?? 0).toLocaleString()} · Orders ${(m.totalOrders ?? 0).toLocaleString()} · AOV $${(m.aov ?? 0).toFixed(2)} · Ad spend $${(m.totalAdSpend ?? 0).toLocaleString()} · MER ${m.mer?.toFixed?.(2) ?? 'N/A'}x
Meta $${(m.metaSpend ?? 0).toLocaleString()} · Google $${(m.googleSpend ?? 0).toLocaleString()} · TikTok $${(m.tiktokSpend ?? 0).toLocaleString()}
New customers ${m.newCustomers ?? 'N/A'} (${m.pctNew ?? '?'}%) · Returning ${m.returningCustomers ?? 'N/A'} · Conversion rate ${m.conversionRate ?? 'N/A'}%${series}`;
  }

  if (name === 'get_top_products') {
    const d = await get(`/api/windsor/products?${params}`);
    const prods = (d?.products as { name: string; category: string; revenue: number; unitsSold: number; grossMargin: number; percentOfTotal: number }[]) ?? [];
    if (!prods.length) return `No product sales data for ${from} → ${to}.`;
    return `Top products ${from} → ${to} (by revenue):\n${prods.slice(0, 25).map((p, i) => `${i + 1}. ${p.name} [${p.category}] $${p.revenue.toLocaleString()} · ${p.unitsSold}u · ${p.grossMargin?.toFixed?.(0) ?? '?'}% margin · ${p.percentOfTotal}% of total`).join('\n')}`;
  }

  if (name === 'get_ad_performance') {
    const d = await get(`/api/windsor/ads?${params}`);
    const plats = (d?.platforms as { platform: string; spend: number; revenue: number; roas: number; clicks: number; conversions: number }[]) ?? [];
    if (!plats.length) return `No ad platform data for ${from} → ${to} (platforms may not have been running or synced in this window).`;
    return `Ad performance ${from} → ${to}:\n${plats.map(p => `${p.platform}: $${p.spend.toLocaleString()} spend · $${p.revenue.toLocaleString()} attributed revenue · ${p.roas}x ROAS · ${p.clicks} clicks · ${p.conversions} conversions`).join('\n')}`;
  }

  if (name === 'get_returns') {
    const d = await get(`/api/windsor/returns?${params}`);
    const rr = d as { returnRate?: number; totalReturns?: number; topReturnedProducts?: { name: string; returnRate: number }[] } | null;
    if (rr?.returnRate == null) return `No returns data for ${from} → ${to}.`;
    return `Returns ${from} → ${to}: rate ${rr.returnRate}% · $${(rr.totalReturns ?? 0).toLocaleString()} returned\nTop returned: ${(rr.topReturnedProducts ?? []).slice(0, 6).map(p => `${p.name} (${p.returnRate}%)`).join(', ') || 'N/A'}`;
  }

  if (name === 'get_inventory') {
    const d = await get('/api/windsor/inventory');
    if (d?.source !== 'shopify_live') return 'Inventory data unavailable right now.';
    const items = (d.items as { product: string; variant: string; status: string; dailyVelocity: number; unitPrice: number }[]) ?? [];
    const bags = (d.bags as { product: string; currentStock: number; unitsSold90d: number; unitPrice: number }[]) ?? [];
    const fin = d.finance as { totalCostValue?: number; totalRetailValue?: number; slowStockCostValue?: number; slowStockCount?: number } | undefined;
    const oos = items.filter(i => i.status === 'out_of_stock' && i.dailyVelocity >= 0.25)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity).slice(0, 10)
      .map(i => `${i.product}${i.variant ? ' – ' + i.variant : ''} (~${Math.round(i.dailyVelocity * 7)}/wk, $${i.unitPrice})`);
    return `Current inventory:
Stock at cost $${(fin?.totalCostValue ?? 0).toLocaleString()} · at retail $${(fin?.totalRetailValue ?? 0).toLocaleString()} · slow/dead $${(fin?.slowStockCostValue ?? 0).toLocaleString()} across ${fin?.slowStockCount ?? 0} items
Out-of-stock fast sellers: ${oos.join(' | ') || 'none'}
True bag stock: ${bags.slice(0, 40).map(b => `${b.product} ${b.currentStock}u ($${b.unitPrice}, sold90 ${b.unitsSold90d})`).join(' | ')}`;
  }

  if (name === 'get_marketing_calendar') {
    const d = await get('/api/calendar');
    const events = (d?.events as { title: string; date: string; endDate?: string; type: string; status?: string; channel?: string }[]) ?? [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const live = events.filter(e => e.date && e.date <= today && (e.endDate || e.date) >= today);
    const upcoming = events.filter(e => e.date && e.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
    if (!live.length && !upcoming.length) return 'No live or upcoming events on the marketing calendar.';
    return `Marketing calendar:
Live now: ${live.map(e => `${e.title} (${e.type}, thru ${e.endDate || e.date})`).join(' | ') || 'nothing'}
Upcoming: ${upcoming.map(e => `${e.date}: ${e.title} (${e.type}${e.channel ? ', ' + e.channel : ''}${e.status ? ', ' + e.status : ''})`).join(' | ') || 'nothing scheduled'}`;
  }

  return `Unknown tool: ${name}`;
}
