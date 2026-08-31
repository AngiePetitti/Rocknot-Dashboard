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
    description: 'CURRENT inventory state (not historical): stock value at cost/retail, the full slow/dead stock list ACROSS ALL CATEGORIES (straps, jewelry, accessories) with per-SKU on-hand units, 90-day sales, days of supply and cash tied up (use this for discount/sale candidates), out-of-stock fast sellers with weekly velocity, true bag stock counts with listing prices.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_marketing_calendar',
    description: 'The marketing calendar: campaigns/launches that are live now and everything scheduled ahead, with type, channel, and status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_financials',
    description: "The company's P&L from QuickBooks (Rocknot LLC) for a date range: income, COGS, gross profit, operating expenses, net income and margins; monthly breakdown with a QuickBooks-vs-Shopify reconciliation gap (big gaps = bookkeeping not caught up for that month — treat those months' figures as incomplete); and, when the direct QuickBooks connection is active, every account-level line item. ADMIN-ONLY data: it returns a restriction notice for non-admin users — never speculate about financials for them.",
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
    description: 'Per-AD creative performance (individual ads, not platform totals) across Meta/TikTok/Snapchat: spend, attributed revenue, ROAS, CTR, conversions, cost per conversion, campaign and ad set. Use to find winning/losing creatives.',
    input_schema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', enum: ['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'last_month', '6m', 'ytd'], description: 'Period preset (default 30d)' },
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
    description: 'Revenue attribution for a date range: how total Shopify revenue splits across ad platforms (attributed revenue, orders, spend, ROAS, cost per order, % of revenue) plus the Direct/Other remainder.',
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
    description: "Create a task on the team's Tasks board. Use when the user asks you to add/create a task or when they agree to your offer to log one. Never create duplicates — call get_tasks first if unsure.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Details/context (optional)' },
        assignee: { type: 'string', description: 'Team member name (optional)' },
        due_date: { type: 'string', description: 'YYYY-MM-DD (optional)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Default medium' },
      },
      required: ['title'],
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

export async function execTool(get: Getter, name: string, input: Record<string, unknown>): Promise<string> {
  const from = String(input.date_from ?? '');
  const to = String(input.date_to ?? '');
  const needsRange = ['get_metrics', 'get_top_products', 'get_ad_performance', 'get_returns', 'get_customer_intel', 'get_attribution'].includes(name);
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
Total sales $${(m.totalRevenue ?? 0).toLocaleString()} · Net sales $${(m.netSales ?? m.totalRevenue ?? 0).toLocaleString()} · Orders ${(m.totalOrders ?? 0).toLocaleString()} · AOV $${(m.aov ?? 0).toFixed(2)} · Ad spend $${(m.totalAdSpend ?? 0).toLocaleString()} · MER ${m.mer?.toFixed?.(2) ?? 'N/A'}x (net sales ÷ net ad spend; goal 3.3x)
Meta $${(m.metaSpend ?? 0).toLocaleString()} · Google $${(m.googleSpend ?? 0).toLocaleString()} · TikTok $${(m.tiktokSpend ?? 0).toLocaleString()}${m.snapchatSpend ? ` · Snapchat $${m.snapchatSpend.toLocaleString()}` : ''}
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
    return `Current inventory (all categories — straps, jewelry, accessories, bags):
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
    const tf = String(input.timeframe || '30d');
    const d = await get(`/api/windsor/creatives?tf=${encodeURIComponent(tf)}`);
    const rows = (d?.creatives as { name: string; platform: string; campaign: string; adset: string; spend: number; revenue: number; roas: number; ctr: number; conversions: number; costPerConversion: number }[]) ?? [];
    if (!rows.length) return `No per-ad creative data for ${tf}.`;
    return `Per-ad creative performance (${tf}), by spend:\n${rows.slice(0, 40).map((c, i) =>
      `${i + 1}. [${c.platform}] ${c.name} — $${c.spend.toLocaleString()} spend · $${c.revenue.toLocaleString()} rev · ${c.roas}x ROAS · ${c.ctr}% CTR · ${c.conversions} conv${c.costPerConversion ? ` @ $${c.costPerConversion}` : ''} · campaign ${c.campaign || '?'}`
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
    if (!rows.length) return `No attribution data for ${from} → ${to}.`;
    return `Revenue attribution ${from} → ${to} (total $${((d?.totalRevenue as number) ?? 0).toLocaleString()}):\n${rows.map(a =>
      `${a.platform}: $${a.revenue.toLocaleString()} (${a.percentage}%) · ${a.orders} orders${a.spend ? ` · $${a.spend.toLocaleString()} spend · ${a.roas}x ROAS · $${a.costPerOrder}/order` : ''}`
    ).join('\n')}`;
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
    const tasks = (d?.tasks as Array<{ title: string; status: string; assignee?: string; dueDate?: string; priority: string }>) ?? [];
    if (!tasks.length) return 'The Tasks board is empty.';
    const line = (t: typeof tasks[number]) => `- ${t.title} [${t.status}] ${t.assignee ? `@${t.assignee} ` : ''}${t.dueDate ? `due ${t.dueDate} ` : ''}(${t.priority})`;
    return `Tasks board (${tasks.filter(t => t.status !== 'done').length} open):\n${tasks.map(line).join('\n')}`;
  }

  if (name === 'create_task') {
    const title = String(input.title ?? '').trim();
    if (!title) return 'Error: title is required.';
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
