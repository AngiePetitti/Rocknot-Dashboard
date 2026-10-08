import { getClient, marketplaces } from '@/src/lib/client';
import type Anthropic from '@anthropic-ai/sdk';

// ── Internal data access ─────────────────────────────────────────────────
// The analyst queries the dashboard's own APIs. Fetches forward the caller's
// session cookie (auth middleware) and use this deployment's origin.
export function makeFetcher(origin: string, cookie: string) {
  return async (path: string, init?: { method?: string; body?: Record<string, unknown> }): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`${origin}${path}`, {
        cache: 'no-store',
        method: init?.method || 'GET',
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
}

export type Getter = (p: string, init?: { method?: string; body?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;

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
      'ONLINE STORE sales & marketing metrics for any date range (marketplace channels such as Nordstrom are excluded — use get_marketplace_channel for those): revenue, orders, AOV, MER, ad spend (total and per platform), new/returning customers, conversion rate — plus a daily or monthly series of revenue/orders/adSpend/newCustomers/totalBuyers. Call this once per period you want to compare (e.g. once for last year, once for this year). Data availability varies by source; missing periods come back as zeros/N-A — report gaps honestly.',
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
    description: 'Top products by revenue for a date range, with units sold, gross margin %, share of total revenue — AND a variant-level (size/color) breakdown, so per-size / per-color questions are answerable directly from this tool.',
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
    name: 'get_product_catalog',
    description:
      'The REAL product catalog from Shopify: every active product\'s exact title, type, price, variant names (colors/sizes), and description. MANDATORY before writing any copy, campaign, or brief that mentions a product — copy may only reference products, variants, colors, and features that appear here or that the operator stated. Never invent product names, finishes, straps, or "2-in-1" features, and never feature or mention a product or variant the catalog marks SOLD OUT / OUT OF STOCK.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_ad_performance',
    description: 'Per-platform ad performance (every paid platform the store runs) for a date range: spend, attributed revenue, ROAS, clicks, conversions — plus new-customer CAC by platform (platform spend ÷ Shopify first-time buyers whose order came from that platform) and the blended new-customer CAC. Use it for any CAC / nCAC / cost-per-new-customer question.',
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
    description: 'CURRENT inventory state (not historical): stock value at cost/retail, the full slow/dead stock list ACROSS ALL CATEGORIES with per-SKU on-hand units, 90-day sales, days of supply and cash tied up (use this for discount/sale candidates), out-of-stock fast sellers with weekly velocity, true bag stock counts with listing prices.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_marketing_calendar',
    description: 'The marketing calendar: campaigns/launches that are live now and everything scheduled ahead, with type, channel, and status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_financials',
    description: "The company's P&L from QuickBooks for a date range: income, COGS, gross profit, operating expenses, net income and margins; monthly breakdown with a QuickBooks-vs-Shopify reconciliation gap (big gaps = bookkeeping not caught up for that month — treat those months' figures as incomplete); and, when the direct QuickBooks connection is active, every account-level line item. ADMIN-ONLY data: it returns a restriction notice for non-admin users — never speculate about financials for them.",
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD (default: Jan 1 this year)' },
        date_to: { type: 'string', description: 'YYYY-MM-DD (default: today)' },
      },
    },
  },
  {
    name: 'get_retention',
    description: 'Email & SMS (Klaviyo) performance: last-30-day revenue, open/click rates and per-campaign results for email and SMS, plus what campaigns are scheduled or drafted. Use for retention/owned-marketing questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_ad_creatives',
    description: 'Per-AD creative performance (individual ads, not platform totals) across the social ad platforms: spend, attributed revenue, ROAS, CTR, conversions, cost per conversion, campaign and ad set — PLUS each ad\'s thumbnail image URL (`image`) and its ads-manager link, so the ad can be SHOWN, not just named. Use to find winning/losing creatives and whenever the operator wants to see the ads.',
    input_schema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', enum: ['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'last_month', '6m', 'ytd'], description: 'Period preset (default 30d). Ignored when date_from/date_to are given.' },
        date_from: { type: 'string', description: 'Optional exact start, YYYY-MM-DD (e.g. a specific month)' },
        date_to: { type: 'string', description: 'Optional exact end, YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_customer_intel',
    description: 'Customer analytics for a date range: repeat-purchaser rate, average LTV, first/second/third+ order values, customer counts by order count (1, 2, 3+) with their LTVs, and monthly cohort repeat behavior.',
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
    name: 'get_attribution',
    description: "Revenue attribution for a date range, on TWO bases: (1) each ad platform's own claimed revenue/orders/spend/ROAS — these OVERLAP (Meta, Google and Pinterest each count the same order), so they can add up to more than store revenue and the 'Direct / Other' remainder can be 0 without meaning direct sales are 0; (2) Shopify's order referrer — one bucket per order, adds up to store revenue — which is the right basis for 'how much came direct / from Google / from email'.",
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
    name: 'get_marketplace_channel',
    description: `Marketplace / retail-partner channel performance for a date range${marketplaces().length ? ` — this dashboard tracks: ${marketplaces().map(m => `${m.label} (key "${m.key}", Shopify sales channel "${m.shopifyChannel}", ${m.returnWindowDays}-day return window)`).join('; ')}` : ' (none configured on this dashboard)'}. Returns orders, gross, discounts, returns and return rate, net sales, AOV, customers; the online store's same figures for comparison; gross still inside the return window; daily series; breakdowns by product line, product, size and ship-to region; and economics (commission, COGS basis, contribution). IMPORTANT: every other tool's revenue figures are ONLINE STORE ONLY — marketplace sales are excluded from them and live only here. Use this whenever the question mentions ${marketplaces().map(m => m.label).join(' / ') || 'a marketplace'} or wholesale/dropship.`,
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: `Channel key${marketplaces().length ? `: ${marketplaces().map(m => `"${m.key}"`).join(' or ')}` : ''}` },
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
        compare: { type: 'boolean', description: 'Also return the preceding period of equal length' },
      },
      required: ['key', 'date_from', 'date_to'],
    },
  },
  {
    name: 'get_organic_content',
    description: "Organic content performance for a date range (Organic Content tab): top organic Pinterest pins (impressions, saves, pin clicks, outbound clicks), top Instagram posts/reels (reach, likes, comments, saves, shares, views), blog articles by sessions started on them (with add-to-cart, orders, CVR), and unpaid site sessions referred by Pinterest / Instagram. Sources not connected say so.",
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
    name: 'get_daily_brief',
    description: "The morning brief: yesterday vs the same weekday over the prior 4 weeks (revenue, orders, AOV, sessions, conversion, with the revenue change decomposed into traffic / conversion / order value), conversion by device, sessions by channel, spend by platform, last-7-days vs prior-7 ad results and new-customer CAC by platform, Google brand vs non-brand, and product momentum — plus the written headline, summary, drivers and recommendation. Use for 'what happened yesterday', 'why did revenue drop', 'morning update', 'anything I should know'. Optional date = YYYY-MM-DD (defaults to yesterday).",
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (optional; the day to brief on)' } } },
  },
  {
    name: 'get_site_analytics',
    description: "Google Analytics 4 for a date range (Traffic tab → Google Analytics view): sessions, users, engagement rate, page views, add-to-carts, purchases; channel groups; top sources (source / medium); landing pages with sessions, engagement, purchases and conversion rate — including the BEST and WORST converting landing pages (≥100 sessions); most-viewed pages. Use for 'which pages convert', 'where is traffic coming from', 'what are people looking at'. GA4 counts differ from Shopify — never mix them: Shopify (get_metrics / get_attribution) is the order and revenue truth.",
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
    name: 'get_goals',
    description: "The company's monthly revenue goals and ad-spend budgets (the Goals tab plan, including which months are pinned/manually set). Compare against get_metrics actuals to judge pace toward the annual target.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tasks',
    description: "The team's internal Kanban task board (Tasks tab): every task with status (todo/in_progress/done), assignee, due date and priority. Check before creating a task to avoid duplicates.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_task',
    description: "Create one task — or MANY AT ONCE via the `tasks` array — on the team's Tasks board. For multiple tasks (a campaign calendar, a checklist) ALWAYS use ONE call with the `tasks` array, never repeated single calls. Never create duplicates — call get_tasks first if unsure.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title (single-task mode)' },
        description: { type: 'string', description: 'Details/context. For a design/campaign task, this MUST contain the COMPLETE brief the assignee needs to execute without asking questions: subject line, preview text, full body copy, CTA, products featured, and any format notes — never just a campaign name.' },
        assignee: { type: 'string', description: 'Team member name (optional)' },
        due_date: { type: 'string', description: 'YYYY-MM-DD (optional)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Default medium' },
        tasks: {
          type: 'array',
          description: 'Batch mode: create all of these in one atomic write. Preferred whenever creating more than one task.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string', description: 'For design/campaign tasks: the COMPLETE brief (subject, preview, full body copy, CTA, products, format notes), not just the campaign name.' },
              assignee: { type: 'string' },
              due_date: { type: 'string', description: 'YYYY-MM-DD' },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['title'],
          },
        },
      },
    },
  },
  {
    name: 'update_task',
    description: "Update an existing task on the Tasks board: change its due date, title, assignee, priority, or status (todo/in_progress/done). Get the task's id from get_tasks first. Use this to fix wrong dates or reassign work when the operator asks.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id from get_tasks' },
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: "Delete a task from the Tasks board permanently (duplicates, stale versions from an old plan). Get the id from get_tasks. Only delete when the operator asked for a cleanup or removal — when in doubt, list what you would delete and ask.",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task id from get_tasks' } },
      required: ['id'],
    },
  },
  {
    name: 'get_month_notes',
    description: "The team's monthly performance log (Goals tab): free-form notes on what happened each month — launches, stockouts, promos, ad account issues. ALWAYS check this when explaining why performance rose or fell in a given month.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_purchase_orders',
    description: 'Inventory purchase orders logged on the dashboard: open orders with quantity, order date, who ordered, and expected arrival (ETA), plus recently received ones. Use with get_inventory to judge what restock is already inbound.',
    input_schema: { type: 'object', properties: {} },
  },
];

async function execToolInner(get: Getter, name: string, input: Record<string, unknown>, onGuard: (g: string) => void): Promise<string> {
  const from = String(input.date_from ?? '');
  const to = String(input.date_to ?? '');
  const needsRange = ['get_metrics', 'get_top_products', 'get_ad_performance', 'get_returns', 'get_customer_intel', 'get_attribution', 'get_organic_content', 'get_marketplace_channel', 'get_site_analytics'].includes(name);
  if (needsRange && (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to)) {
    return 'Error: date_from and date_to must be YYYY-MM-DD with date_from <= date_to.';
  }
  const params = `tf=custom&date_from=${from}&date_to=${to}`;

  // Year guard. The model has mistaken "September" for last year's September
  // and reported it as the current month. Every ranged result is prefixed
  // with where the range sits relative to today, and a range entirely in a
  // past year gets an explicit warning plus the current-year equivalent.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yearGuard = (() => {
    if (!needsRange) return '';
    const curYear = Number(today.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    if (to > today) return `NOTE: range ${from} → ${to} runs past today (${today}); later dates have no data.\n`;
    if (toYear < curYear) {
      const shift = (d: string) => `${Number(d.slice(0, 4)) + (curYear - toYear)}${d.slice(4)}`;
      return `⚠ DATE CHECK: ${from} → ${to} is ${curYear - toYear} year(s) BEFORE today (${today}). Today's year is ${curYear}. Use this range ONLY as the prior-year side of a year-over-year comparison and label it with its year (e.g. "${to.slice(0, 4)}"). If the operator meant the current period, fetch ${shift(from)} → ${shift(to)} instead.\n`;
    }
    return `Range ${from} → ${to} (current year ${curYear}; today ${today}).\n`;
  })();
  onGuard(yearGuard);

  if (name === 'get_product_catalog') {
    const { fetchCatalog, catalogText } = await import('@/src/lib/catalog');
    const items = await fetchCatalog().catch(() => []);
    return `ACTIVE PRODUCT CATALOG (${items.length} products — these are the ONLY real products/variants; do not invent others):\n${catalogText(items)}`;
  }

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
Total sales $${(m.totalRevenue ?? 0).toLocaleString()} · Net sales $${(m.netSales ?? m.totalRevenue ?? 0).toLocaleString()} · Orders ${(m.totalOrders ?? 0).toLocaleString()} · AOV $${(m.aov ?? 0).toFixed(2)} · Ad spend $${(m.totalAdSpend ?? 0).toLocaleString()} · MER ${m.mer?.toFixed?.(2) ?? 'N/A'}x (net sales ÷ net ad spend; goal ${getClient().goals.targetMer}x)
Meta $${(m.metaSpend ?? 0).toLocaleString()} · Google $${(m.googleSpend ?? 0).toLocaleString()}${m.tiktokSpend ? ` · TikTok $${m.tiktokSpend.toLocaleString()}` : ''}${m.snapchatSpend ? ` · Snapchat $${m.snapchatSpend.toLocaleString()}` : ''}${m.pinterestSpend ? ` · Pinterest $${m.pinterestSpend.toLocaleString()}` : ''}
New customers ${m.newCustomers ?? 'N/A'} (${m.pctNew ?? '?'}%) · Returning ${m.returningCustomers ?? 'N/A'} · Conversion rate ${m.conversionRate ?? 'N/A'}%${series}`;
  }

  if (name === 'get_top_products') {
    const d = await get(`/api/windsor/products?${params}`);
    const prods = (d?.products as { name: string; category: string; revenue: number; unitsSold: number; grossMargin: number; percentOfTotal: number }[]) ?? [];
    if (!prods.length) return `No product sales data for ${from} → ${to}.`;
    const variants = (d?.variants as { product: string; variant: string; revenue: number; unitsSold: number }[]) ?? [];
    const variantLines = variants.filter(v => v.variant).slice(0, 60)
      .map((v, i) => `${i + 1}. ${v.product} · ${v.variant}: $${v.revenue.toLocaleString()} · ${v.unitsSold}u`);
    return `Top products ${from} → ${to} (by revenue):\n${prods.slice(0, 25).map((p, i) => `${i + 1}. ${p.name} [${p.category}] $${p.revenue.toLocaleString()} · ${p.unitsSold}u · ${p.grossMargin?.toFixed?.(0) ?? '?'}% margin · ${p.percentOfTotal}% of total`).join('\n')}${
      variantLines.length ? `\n\nTop variants (size/color level, by revenue):\n${variantLines.join('\n')}` : ''
    }`;
  }

  if (name === 'get_ad_performance') {
    const d = await get(`/api/windsor/ads?${params}`);
    const plats = (d?.platforms as { platform: string; spend: number; revenue: number; roas: number; clicks: number; conversions: number }[]) ?? [];
    if (!plats.length) return `No ad platform data for ${from} → ${to} (platforms may not have been running or synced in this window).`;
    let ncac = '';
    try {
      const n = await get(`/api/windsor/ncac?${params}`);
      if (n && !n.error) { const { ncacText } = await import('@/src/lib/ncac'); ncac = `\n\n${ncacText(n as unknown as import('@/src/lib/ncac').NcacSummary)}`; }
    } catch { /* optional */ }
    return `Ad performance ${from} → ${to}:\n${plats.map(p => `${p.platform}: $${p.spend.toLocaleString()} spend · $${p.revenue.toLocaleString()} attributed revenue · ${p.roas}x ROAS · ${p.clicks} clicks · ${p.conversions} conversions`).join('\n')}${ncac}`;
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
    type Item = { product: string; variant: string; category: string; status: string; currentStock: number; unitsSold90d: number; dailyVelocity: number; daysRemaining: number | null; stockValue: number; unitPrice: number };
    const items = (d.items as Item[]) ?? [];
    const bags = (d.bags as { product: string; currentStock: number; unitsSold90d: number; unitPrice: number }[]) ?? [];
    const slow = (d.moveOrDiscount as Item[]) ?? [];
    const fin = d.finance as { totalCostValue?: number; totalRetailValue?: number; slowStockCostValue?: number; slowStockCount?: number } | undefined;
    const oos = items.filter(i => i.status === 'out_of_stock' && i.dailyVelocity >= 0.25)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity).slice(0, 10)
      .map(i => `${i.product}${i.variant ? ' – ' + i.variant : ''} (~${Math.round(i.dailyVelocity * 7)}/wk, $${i.unitPrice})`);
    const fmtSlow = (i: Item) =>
      `${i.product}${i.variant ? ' – ' + i.variant : ''} [${i.category}]: ${i.currentStock}u on hand, sold ${i.unitsSold90d} in 90d${i.daysRemaining !== null ? `, ${i.daysRemaining}d supply` : ' (no sales)'}, $${i.stockValue.toLocaleString()} at cost, sells $${i.unitPrice}`;
    return `Current inventory (all categories):
Stock at cost $${(fin?.totalCostValue ?? 0).toLocaleString()} · at retail $${(fin?.totalRetailValue ?? 0).toLocaleString()} · slow/dead $${(fin?.slowStockCostValue ?? 0).toLocaleString()} across ${fin?.slowStockCount ?? 0} SKUs
Slow/dead stock (in stock the whole period but not selling — dead = zero 90d sales, slow = over a year of supply; the top ${slow.length} by cash tied up, discount/bundle candidates):
${slow.map(fmtSlow).join('\n') || 'none'}
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

  if (name === 'get_financials') {
    const qp = new URLSearchParams();
    if (DATE_RE.test(from)) qp.set('date_from', from);
    if (DATE_RE.test(to)) qp.set('date_to', to);
    const d = await get(`/api/financials?${qp}`);
    if (!d) return 'Financials unavailable — this data is admin-only; the current user may not have access.';
    if (d.error && !d.totals) return `Financials error: ${d.error}`;
    const t = d.totals as Record<string, number>;
    const monthly = (d.monthly as Array<{ month: string; income: number; shopifySales?: number; cogs: number; expenses: number; net: number }>) ?? [];
    const items = (d.lineItems as Array<{ account: string; amount: number; section: string; isSummary?: boolean }> | null) ?? null;
    const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const monthLines = monthly.map(m => {
      const gap = m.shopifySales ? m.income - m.shopifySales : null;
      const gapNote = gap !== null && m.shopifySales
        ? Math.abs(gap) / m.shopifySales > 0.15 ? ` · GAP ${$(gap)} vs Shopify ${$(m.shopifySales)} (books likely incomplete)` : ` · matches Shopify (${$(m.shopifySales)})`
        : '';
      return `${m.month}: income ${$(m.income)} · COGS ${$(m.cogs)} · opex ${$(m.expenses)} · net ${$(m.net)}${gapNote}`;
    });
    return `QuickBooks P&L (${(d.range as { from: string; to: string })?.from} → ${(d.range as { from: string; to: string })?.to}, account: ${d.accountUsed ?? 'unknown'}):
Income ${$(t.income)} · COGS ${$(t.cogs)} · Gross profit ${$(t.grossProfit)} (${t.income ? ((t.grossProfit / t.income) * 100).toFixed(1) : '?'}%)
Operating expenses ${$(t.expenses)} · Net income ${$(t.netIncome)} (${t.income ? ((t.netIncome / t.income) * 100).toFixed(1) : '?'}% net margin)
Monthly (watch the GAP notes — months where QuickBooks trails Shopify aren't fully booked yet):
${monthLines.join('\n') || 'no monthly rows'}
${items?.length
  ? `Line items (QuickBooks statement order):\n${items.slice(0, 80).map(li => `${li.isSummary ? '== ' : ''}${li.account}: ${$(li.amount)}`).join('\n')}`
  : 'Account-level line items unavailable (direct QuickBooks connection not set up yet — summary totals only).'}`;
  }

  if (name === 'get_retention') {
    const d = await get('/api/retention');
    if (d?.source !== 'klaviyo_live') return `Klaviyo data unavailable: ${d?.error ?? 'not connected'}`;
    const ov = d.overview as { email: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number }; sms: { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number } };
    const recent = (d.recent as Array<{ name: string; channel: string; sendTime: string | null; recipients?: number; openRate?: number; clickRate?: number; revenue?: number }>) ?? [];
    const scheduled = (d.scheduled as Array<{ name: string; channel: string; sendTime: string | null; status: string }>) ?? [];
    return `Klaviyo — last 30 days:
Email: $${ov.email.revenue.toLocaleString()} from ${ov.email.campaigns} campaigns, ${ov.email.recipients.toLocaleString()} sends, ${ov.email.avgOpenRate}% open / ${ov.email.avgClickRate}% click
SMS: $${ov.sms.revenue.toLocaleString()} from ${ov.sms.campaigns} campaigns, ${ov.sms.recipients.toLocaleString()} sends
Recent campaigns (name · channel · date · sends · open% · click% · revenue):
${recent.slice(0, 25).map(c => `${c.name} · ${c.channel} · ${c.sendTime?.slice(0, 10) ?? '?'} · ${c.recipients ?? '?'} · ${c.openRate ?? '?'}% · ${c.clickRate ?? '?'}% · $${(c.revenue ?? 0).toLocaleString()}`).join('\n') || 'none'}
Scheduled/drafts: ${scheduled.map(c => `${c.name} (${c.channel}, ${c.sendTime?.slice(0, 10) ?? c.status})`).join(' · ') || 'none'}`;
  }

  if (name === 'get_ad_creatives') {
    const cf = String(input.date_from ?? ''); const ct = String(input.date_to ?? '');
    const custom = DATE_RE.test(cf) && DATE_RE.test(ct) && cf <= ct;
    const tf = custom ? 'custom' : String(input.timeframe || '30d');
    const d = await get(`/api/windsor/creatives?tf=${encodeURIComponent(tf)}${custom ? `&date_from=${cf}&date_to=${ct}` : ''}`);
    const rows = (d?.creatives as { id: string; name: string; platform: string; campaign: string; adset: string; spend: number; revenue: number; roas: number; ctr: number; conversions: number; costPerConversion: number; thumbnailUrl: string | null; adUrl: string | null; catalog?: boolean }[]) ?? [];
    const label = custom ? `${cf} → ${ct}` : tf;
    if (!rows.length) return `No per-ad creative data for ${label}.`;
    // Stable, same-origin thumbnail URL: platform CDN links expire within days,
    // so saved reports point at the proxy, which re-resolves the live image.
    const base = getClient().dashboardUrl.replace(/\/$/, '');
    const img = (c: typeof rows[number]) => c.thumbnailUrl ? `${base}/api/creatives/thumb?p=${encodeURIComponent(c.platform)}&id=${encodeURIComponent(c.id)}` : (c.catalog ? 'none (catalog ad — image comes from the product feed)' : 'none');
    return `Per-ad creative performance (${label}), by spend. Each ad has an \`image\` URL (the ad's actual thumbnail — embed it with <img> when a visual is wanted) and an ads-manager \`link\`.\n${rows.slice(0, 40).map((c, i) =>
      `${i + 1}. [${c.platform}] ${c.name} — $${c.spend.toLocaleString()} spend · $${c.revenue.toLocaleString()} rev · ${c.roas}x ROAS · ${c.ctr}% CTR · ${c.conversions} conv${c.costPerConversion ? ` @ $${c.costPerConversion}` : ''} · campaign ${c.campaign || '?'} · ad set ${c.adset || '?'}\n   image: ${img(c)}\n   link: ${c.adUrl || 'n/a'}`
    ).join('\n')}`;
  }

  if (name === 'get_customer_intel') {
    const d = await get(`/api/windsor/customers?${params}`);
    const m = d?.customerMetrics as Record<string, number> | null;
    if (!m) return `No customer data for ${from} → ${to}.`;
    const cohorts = (d?.cohortData as { month: string; newCustomers: number; repeatRate: number }[]) ?? [];
    return `Customer intel ${from} → ${to}:
Customers ${m.totalCustomers?.toLocaleString?.() ?? 'N/A'} · repeat purchasers ${m.repeatCustomers?.toLocaleString?.() ?? 'N/A'} (${m.repeatPurchaserRate ?? '?'}%)
Avg LTV $${m.avgLTV ?? '?'} · order values: 1st $${m.firstOrderAvg ?? '?'} · 2nd $${m.secondOrderAvg ?? '?'} · 3rd+ $${m.thirdPlusOrderAvg ?? '?'}
By order count: 1 order ${m.oneOrderCount?.toLocaleString?.() ?? '?'} (LTV $${m.ltvOneOrder ?? '?'}) · 2 orders ${m.twoOrderCount?.toLocaleString?.() ?? '?'} (LTV $${m.ltvTwoOrders ?? '?'}) · 3+ ${m.threePlusCount?.toLocaleString?.() ?? '?'} (LTV $${m.ltvThreePlus ?? '?'})${cohorts.length ? `\nCohorts (month, new customers, repeat rate %): ${cohorts.map(c => `${c.month}: ${c.newCustomers}, ${c.repeatRate}%`).join(' | ')}` : ''}`;
  }

  if (name === 'get_attribution') {
    const d = await get(`/api/windsor/attribution?${params}`);
    const rows = (d?.attribution as { platform: string; revenue: number; orders: number; spend: number; roas: number; costPerOrder: number; percentage: number }[]) ?? [];
    const referrers = (d?.referrers as { label: string; orders: number; netSales: number; percentage: number }[]) ?? [];
    if (!rows.length && !referrers.length) return `No attribution data for ${from} → ${to}.`;
    const total = (d?.totalRevenue as number) ?? 0;
    const claimed = (d?.claimedPct as number) ?? 0;
    const platformLines = rows.filter(a => a.platform !== 'Direct / Other').map(a =>
      `${a.platform}: $${a.revenue.toLocaleString()} (${a.percentage}% of combined claims) · ${a.orders} orders${a.spend ? ` · $${a.spend.toLocaleString()} spend · ${a.roas}x ROAS · $${a.costPerOrder}/order` : ''}`
    );
    const overlapNote = claimed > 100
      ? `Together the platforms claim ${claimed}% of store revenue — they overlap (each counts the same order on its own attribution window), so the "Direct / Other" remainder collapses to $0. That does NOT mean direct sales are zero; use the Shopify referrer split below for that.`
      : `Together the platforms claim ${claimed}% of store revenue (self-attributed, overlapping); the unclaimed remainder is $${Math.max(0, total - rows.filter(a => a.platform !== 'Direct / Other').reduce((s, a) => s + a.revenue, 0)).toLocaleString()}.`;
    const refLines = referrers.slice(0, 15).map(r => `${r.label}: $${r.netSales.toLocaleString()} (${r.percentage}%) · ${r.orders} orders`);
    return `Revenue attribution ${from} → ${to} — store revenue $${total.toLocaleString()}.

PLATFORM-CLAIMED (each platform's own attribution, overlapping):
${platformLines.join('\n') || 'none'}
${overlapNote}

SHOPIFY ORDER REFERRER (one referrer per order; adds up to store net sales — the true "where did orders come from" split; "Direct (no referrer)" = typed the URL, bookmark, or untracked app/email click):
${refLines.join('\n') || 'not available (Shopify not connected)'}`;
  }

  if (name === 'get_marketplace_channel') {
    const key = String(input.key || marketplaces()[0]?.key || '').trim();
    if (!marketplaces().length) return 'This dashboard has no marketplace channels configured.';
    const d = await get(`/api/channel/${encodeURIComponent(key)}?${params}${input.compare ? '&compare=true' : ''}`);
    if (!d || d.error) return `Marketplace data unavailable for "${key}": ${d?.error || 'no response'}`;
    type T = { orders: number; gross: number; discounts: number; returns: number; net: number; totalSales: number; aov: number; customers: number; returningCustomers: number };
    const ch = d.channel as { label: string; shopifyChannel: string; returnWindowDays: number; commissionPct: number | null; description?: string };
    const t = d.totals as T; const st = d.store as T;
    const fmtT = (x: T) => `${x.orders} orders · gross $${Math.round(x.gross).toLocaleString()} · discounts $${Math.round(x.discounts).toLocaleString()} · returns $${Math.round(x.returns).toLocaleString()} (${x.gross > 0 ? Math.round((x.returns / x.gross) * 100) : 0}% of gross) · net $${Math.round(x.net).toLocaleString()} · total sales $${Math.round(x.totalSales).toLocaleString()} · AOV $${Math.round(x.aov)} · customers ${x.customers} (${x.returningCustomers} returning)`;
    const rows = (k: string, n = 10) => ((d[k] as Array<{ label: string; orders: number; gross: number; returns: number; net: number }>) || []).slice(0, n).map(r => `- ${r.label}: ${r.orders} orders · gross $${Math.round(r.gross).toLocaleString()} · returns $${Math.round(r.returns).toLocaleString()} · net $${Math.round(r.net).toLocaleString()}`).join('\n') || 'none';
    const ow = d.openWindow as { from: string; gross: number; orders: number } | null;
    const eco = d.economics as { commissionPct: number | null; commission: number | null; returnFee: number | null; returnCount: number | null; returnCharges: number | null; returnCountBasis: string | null; cogsPct: number | null; cogs: number | null; contribution: number | null; contributionPct: number | null };
    const prior = d.prior as { range: { from: string; to: string }; totals: T; store: T } | null | undefined;
    const daily = (d.daily as Array<{ date: string; orders: number; gross: number; returns: number; net: number }>) || [];
    const byMonth = new Map<string, { o: number; g: number; r: number; n: number }>();
    for (const r of daily) { const k = r.date.slice(0, 7); const b = byMonth.get(k) || { o: 0, g: 0, r: 0, n: 0 }; b.o += r.orders; b.g += r.gross; b.r += r.returns; b.n += r.net; byMonth.set(k, b); }
    const series = daily.length > 62
      ? `Monthly (month,orders,gross,returns,net):\n${Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, b]) => `${k},${b.o},${Math.round(b.g)},${Math.round(b.r)},${Math.round(b.n)}`).join('\n')}`
      : `Daily (date,orders,gross,returns,net):\n${daily.map(r => `${r.date},${r.orders},${Math.round(r.gross)},${Math.round(r.returns)},${Math.round(r.net)}`).join('\n')}`;
    return `${ch.label.toUpperCase()} (Shopify sales channel "${ch.shopifyChannel}", ${ch.returnWindowDays}-day return window) ${from} → ${to}
${ch.description ? ch.description + '\n' : ''}Recorded at full retail in Shopify; ${ch.commissionPct == null ? 'the partner commission is NOT in Shopify and is not yet configured, so net sales here are before commission.' : `commission ${ch.commissionPct}% is applied in economics below (contribution = net − commission − per-return charges − COGS).`}

${ch.label}: ${fmtT(t)}
Online store, same period (for comparison): ${fmtT(st)}
All channels net: $${Math.round(Number(d.allNet || 0)).toLocaleString()} · ${ch.label} share of net ${Number(d.allNet) > 0 ? Math.round((t.net / Number(d.allNet)) * 100) : 0}%
${ow ? `Still inside the return window (sold since ${ow.from}): ${ow.orders} orders · $${Math.round(ow.gross).toLocaleString()} gross that can still come back.` : ''}
Economics: commission ${eco.commission == null ? 'n/a' : `$${Math.round(eco.commission).toLocaleString()}`}${eco.returnFee != null ? ` · return charges $${Math.round(eco.returnCharges || 0).toLocaleString()} ($${eco.returnFee} × ${eco.returnCount ?? 0} returns${eco.returnCountBasis === 'estimated' ? ', estimated from return dollars ÷ AOV' : ''})` : ''} · COGS ${eco.cogs == null ? 'n/a' : `$${Math.round(eco.cogs).toLocaleString()} (${eco.cogsPct}%)`} · contribution ${eco.contribution == null ? 'n/a' : `$${Math.round(eco.contribution).toLocaleString()} (${eco.contributionPct}%)`}
${prior ? `Prior period ${prior.range.from} → ${prior.range.to}: ${fmtT(prior.totals)}` : ''}

By product line:\n${rows('byLine', 6)}
By product:\n${rows('byProduct', 10)}
By size:\n${rows('bySize', 10)}
By ship-to region:\n${rows('byRegion', 8)}

${series}`;
  }

  if (name === 'get_daily_brief') {
    const date = String(input.date || '');
    const d = await get(`/api/brief${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`);
    if (!d || d.error || !d.brief) return `Daily brief unavailable: ${d?.error || 'no response'}`;
    const { briefText } = await import('@/src/lib/brief');
    return briefText(d.brief as unknown as import('@/src/lib/brief').Brief);
  }

  if (name === 'get_site_analytics') {
    const d = await get(`/api/traffic/ga4?${params}`);
    if (!d) return 'Google Analytics unavailable: no response';
    const { ga4Text } = await import('@/src/lib/ga4');
    return ga4Text(d as unknown as import('@/src/lib/ga4').GaData, from, to);
  }

  if (name === 'get_organic_content') {
    const d = await get(`/api/organic?${params}`);
    if (!d || d.error) return `Organic data unavailable: ${d?.error || 'no response'}`;
    type Post = { id: string; title: string; group: string; publishedAt: string; url: string; imageUrl: string; metrics: Record<string, number> };
    type Block = { status: string; error?: string; items: Post[]; totals: Record<string, number> };
    const pin = d.pinterest as Block; const ig = d.instagram as Block;
    const blog = d.blog as { status: string; items: Array<{ title: string; path: string; url: string; imageUrl: string; kind?: string; publishedAt: string; sessions: number; cartAdds: number; completed: number }>; totals: Record<string, number> };
    const st = d.socialTraffic as Record<string, { sessions: number; completed: number }>;
    const m = (o: Record<string, number>, keys: string[]) => keys.filter(k => o[k]).map(k => `${k} ${Math.round(o[k]).toLocaleString()}`).join(' · ');
    // Same-origin image proxy (platform CDN links expire) — see /api/creatives/thumb.
    const base = getClient().dashboardUrl.replace(/\/$/, '');
    const postImg = (platform: string, p: Post) => p.imageUrl ? `${base}/api/creatives/thumb?kind=organic&p=${encodeURIComponent(platform)}&id=${encodeURIComponent(p.id)}` : 'none';
    const postLines = (platform: string, b: Block, keys: string[]) => b.status !== 'ok'
      ? (b.status === 'not_connected' ? 'not connected in Windsor yet' : `error: ${b.error}`)
      : (b.items.slice(0, 12).map(p => `- ${p.title}${p.group ? ` [${p.group}]` : ''}${p.publishedAt ? ` (${p.publishedAt})` : ''}: ${m(p.metrics, keys)}\n   image: ${postImg(platform, p)}\n   link: ${p.url || 'n/a'}`).join('\n') || 'no activity') + `\nTotals: ${m(b.totals, keys)}`;
    type Pt = { date: string; followers: number | null; newFollowers: number | null };
    const aud = (d.audience || {}) as Record<string, { status: string; followers: number | null; followersStart: number | null; newFollowers: number | null; profileViews?: number; websiteClicks?: number; following?: number; boards?: number; pins?: number; monthlyViews?: number; series?: Pt[] }>;
    const k = (v: number) => Math.round(v).toLocaleString();
    const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${k(Math.abs(v))}`;
    const audLine = (label: string) => {
      const a = aud[label];
      if (!a) return `${label}: n/a`;
      if (a.status !== 'ok') return `${label}: ${a.status === 'not_connected' ? 'not connected' : 'unavailable'}`;
      const parts = [a.followers != null ? `${k(a.followers)} followers` : '', a.newFollowers != null ? `${sg(a.newFollowers)} net new in range${a.followersStart != null ? ` (from ${k(a.followersStart)}${a.followersStart ? `, ${(Math.round((a.newFollowers / a.followersStart) * 1000) / 10).toFixed(1)}%` : ''})` : ''}` : '',
        a.profileViews != null ? `${k(a.profileViews)} profile views` : '', a.websiteClicks != null ? `${k(a.websiteClicks)} website taps` : '',
        a.monthlyViews != null ? `${k(a.monthlyViews)} monthly views` : '', a.following != null ? `following ${k(a.following)}` : '', a.boards != null ? `${k(a.boards)} boards` : '', a.pins != null ? `${k(a.pins)} pins` : ''].filter(Boolean);
      const s = (a.series || []).filter(p => p.newFollowers != null);
      let growth = '';
      if (s.length > 1) {
        const best = s.reduce((b, p) => (p.newFollowers! > b.newFollowers! ? p : b)); const worst = s.reduce((b, p) => (p.newFollowers! < b.newFollowers! ? p : b));
        const down = s.filter(p => p.newFollowers! < 0).length; const net = s.reduce((t, p) => t + p.newFollowers!, 0);
        growth = `\n   growth day by day: ${net > 0 ? 'growing' : net < 0 ? 'shrinking' : 'flat'} · avg ${(net / s.length).toFixed(1)}/day over ${s.length} days · best day ${best.date} (${sg(best.newFollowers!)}) · worst day ${worst.date} (${sg(worst.newFollowers!)}) · ${down} days lost followers`;
      }
      return `${label}: ${parts.join(' · ') || 'no follower fields in the feed'}${growth}`;
    };
    return `Organic content ${from} → ${to}. Each post has an \`image\` URL (its real thumbnail — embed with <img> when a visual is wanted) and a \`link\`.

AUDIENCE (account level — followers are as of the last day of the range; profile views / website taps / engagement are period totals):
${audLine('Instagram')}
${audLine('Pinterest')}

PINTEREST ORGANIC PINS (Pinterest's own counts):
${postLines('Pinterest', pin, ['impressions', 'saves', 'pinClicks', 'outboundClicks'])}

INSTAGRAM POSTS & REELS (Instagram's own counts):
${postLines('Instagram', ig, ['reach', 'likes', 'comments', 'saves', 'shares', 'views'])}

BLOG ARTICLES (Shopify sessions that started on the article; blog home / tag pages marked):
${blog.status !== 'ok' ? 'unavailable' : (blog.items.slice(0, 12).map(b => `- ${b.title}${b.kind && b.kind !== 'article' ? ` [${b.kind === 'index' ? 'blog home' : 'tag page'}]` : ''} (${b.publishedAt || 'date n/a'}): ${b.sessions} sessions · ${b.cartAdds} add-to-cart · ${b.completed} orders\n   image: ${b.imageUrl || 'none'}\n   link: ${b.url}`).join('\n') || 'no blog sessions') + `\nTotals: ${blog.totals.sessions || 0} sessions · ${blog.totals.completed || 0} orders · ${blog.totals.articles || 0} articles`}

UNPAID SITE SESSIONS REFERRED BY: Pinterest ${st?.Pinterest?.sessions ?? 0} (${st?.Pinterest?.completed ?? 0} orders) · Instagram ${st?.Instagram?.sessions ?? 0} (${st?.Instagram?.completed ?? 0} orders). Many in-app taps hide the referrer, so this is a floor.`;
  }

  if (name === 'get_goals') {
    const d = await get('/api/goals');
    const goals = (d?.goals as { month: string; revenueGoal: number; adBudget: number; pinned?: boolean }[]) ?? [];
    if (!goals.length) return 'No monthly goals are set on the Goals tab yet.';
    const total = goals.reduce((s, g) => s + g.revenueGoal, 0);
    return `Monthly plan (Goals tab) — planned total $${total.toLocaleString()}:\n${goals.sort((a, b) => a.month.localeCompare(b.month)).map(g =>
      `${g.month}: revenue goal $${g.revenueGoal.toLocaleString()} · ad budget $${g.adBudget.toLocaleString()}${g.pinned ? ' (pinned/manual)' : ''}`
    ).join('\n')}`;
  }

  if (name === 'get_tasks') {
    const d = await get('/api/tasks');
    const tasks = (d?.tasks as Array<{ id: string; title: string; status: string; assignee?: string; dueDate?: string; priority: string }>) ?? [];
    if (!tasks.length) return 'The Tasks board is empty.';
    const line = (t: typeof tasks[number]) => `- [id ${t.id}] ${t.title} [${t.status}] ${t.assignee ? `@${t.assignee} ` : ''}${t.dueDate ? `due ${t.dueDate} ` : ''}(${t.priority})`;
    return `Tasks board (${tasks.filter(t => t.status !== 'done').length} open):\n${tasks.map(line).join('\n')}`;
  }

  if (name === 'update_task') {
    const id = String(input.id ?? '').trim();
    if (!id) return 'Error: id is required (from get_tasks).';
    const body: Record<string, unknown> = { id };
    if (input.title != null) body.title = String(input.title);
    if (input.description != null) body.description = String(input.description);
    if (input.assignee != null) body.assignee = String(input.assignee);
    if (input.due_date != null) {
      const due = String(input.due_date);
      if (due && !DATE_RE.test(due)) return 'Error: due_date must be YYYY-MM-DD.';
      body.dueDate = due;
    }
    if (['low', 'medium', 'high'].includes(String(input.priority))) body.priority = String(input.priority);
    if (['todo', 'in_progress', 'done'].includes(String(input.status))) body.status = String(input.status);
    const d = await get('/api/tasks', { method: 'PUT', body });
    return d?.ok ? `Task ${id} updated.` : `Error: could not update task ${id} (does it still exist?).`;
  }

  if (name === 'delete_task') {
    const id = String(input.id ?? '').trim();
    if (!id) return 'Error: id is required (from get_tasks).';
    const d = await get(`/api/tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return d?.ok ? `Task ${id} deleted.` : `Error: could not delete task ${id} (does it still exist?).`;
  }

  if (name === 'create_task') {
    // Batch mode: one atomic POST for the whole list.
    const batch = Array.isArray(input.tasks) ? (input.tasks as Array<Record<string, unknown>>) : null;
    if (batch && batch.length) {
      const tasks = batch.map(t => ({
        title: String(t.title ?? '').trim(),
        description: String(t.description ?? ''),
        assignee: String(t.assignee ?? ''),
        dueDate: DATE_RE.test(String(t.due_date ?? '')) ? String(t.due_date) : '',
        priority: ['low', 'medium', 'high'].includes(String(t.priority)) ? String(t.priority) : 'medium',
      })).filter(t => t.title);
      if (!tasks.length) return 'Error: every task in the batch needs a title.';
      const d = await get('/api/tasks', { method: 'POST', body: { tasks } });
      if (!d?.ok) return 'Error: could not create the tasks (are you signed in with task access?).';
      const created = Number(d.created ?? tasks.length);
      return `Created ${created} tasks in one write — verify with get_tasks if the count matters. Titles: ${tasks.map(t => t.title).join(' · ')}`;
    }
    const title = String(input.title ?? '').trim();
    if (!title) return 'Error: title is required (or pass a tasks array for batch creation).';
    const due = String(input.due_date ?? '');
    if (due && !DATE_RE.test(due)) return 'Error: due_date must be YYYY-MM-DD.';
    const d = await get('/api/tasks', {
      method: 'POST',
      body: {
        title,
        description: String(input.description ?? ''),
        assignee: String(input.assignee ?? ''),
        dueDate: due,
        priority: ['low', 'medium', 'high'].includes(String(input.priority)) ? String(input.priority) : 'medium',
      },
    });
    if (!d?.ok) return 'Error: could not create the task (are you signed in with task access?).';
    return `Created task "${title}"${input.assignee ? ` assigned to ${input.assignee}` : ''}${due ? `, due ${due}` : ''} — it's on the Tasks tab in To Do.`;
  }

  if (name === 'get_month_notes') {
    const d = await get('/api/notes/months');
    const notes = (d?.notes as Record<string, { text: string; updatedAt: string; author?: string }>) ?? {};
    const entries = Object.entries(notes).sort(([a], [b]) => b.localeCompare(a));
    if (!entries.length) return 'No monthly performance notes recorded yet (Goals tab → Monthly performance log).';
    return `Monthly performance log:\n${entries.map(([m, n]) => `${m}: ${n.text}${n.author ? ` — ${n.author}` : ''}`).join('\n')}`;
  }

  if (name === 'get_purchase_orders') {
    const d = await get('/api/reorders');
    const rs = (d?.reorders as { product: string; variant: string; qty: number; orderedDate: string; orderedBy: string; status: string; receivedDate?: string; eta?: string }[]) ?? [];
    const open = rs.filter(r => r.status === 'open');
    const received = rs.filter(r => r.status === 'received').slice(-10);
    if (!rs.length) return 'No purchase orders have been logged on the Inventory tab.';
    return `Purchase orders:
Open (${open.length}): ${open.map(r => `${r.product}${r.variant ? ' – ' + r.variant : ''} ×${r.qty} ordered ${r.orderedDate}${r.orderedBy ? ` by ${r.orderedBy}` : ''}${r.eta ? `, expected ${r.eta}` : ''}`).join(' | ') || 'none'}
Recently received: ${received.map(r => `${r.product}${r.variant ? ' – ' + r.variant : ''} ×${r.qty} (received ${r.receivedDate})`).join(' | ') || 'none'}`;
  }

  return `Unknown tool: ${name}`;
}

export async function execTool(get: Getter, name: string, input: Record<string, unknown>): Promise<string> {
  let guard = '';
  const out = await execToolInner(get, name, input, g => { guard = g; });
  return guard && !out.startsWith('Error') ? guard + out : out;
}
