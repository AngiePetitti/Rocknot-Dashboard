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
      'The REAL product catalog from Shopify: every active product\'s exact title, type, price, variant names (colors/sizes), and description. MANDATORY before writing any copy, campaign, or brief that mentions a product — copy may only reference products, variants, colors, and features that appear here or that the operator stated. Never invent product names, finishes, straps, or "2-in-1" features, and never feature or mention a product or variant the catalog marks SOLD OUT / OUT OF STOCK. Each line also carries the product\'s tags and the collections it belongs to; for a full collection\'s contents use get_collection_products.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_collections',
    description: "Every Shopify collection on the store: title, handle, product count, whether it is manual or automated (and the automation rules: tags, product type, price, vendor), storefront link and description. Use for 'what collections do we have', 'which collection should this go in', 'what qualifies for X', sale/collection planning, and to pick a collection before get_collection_products.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_collection_products',
    description: "The products inside ONE Shopify collection (by title, handle, or storefront URL): each product's title, type, price, total units, the other collections it is in, tags, in-stock and out-of-stock variants, and link. Up to 150 products. Use whenever a question is about what sits in a collection (bridal, kids, sale, new arrivals, a BFCM collection).",
    input_schema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection title, handle, or URL' } }, required: ['collection'] },
  },
  {
    name: 'search_shopify_products',
    description: "Search the Shopify catalog with Shopify's product search syntax and get each match with type, vendor, status, price, total units, tags, the collections it belongs to, variants and link. Examples: 'tag:bridal', 'product_type:\"Kids Shoes\"', 'title:*sandal*', 'status:draft', 'created_at:>2026-09-01', 'inventory_total:0', 'vendor:Nike', combined with AND / OR. Use this when get_product_catalog's active-only list is not enough (drafts, archived, tags, collection membership, launch dates).",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Shopify product search query' }, limit: { type: 'number', description: 'Max products (default 60, max 100)' } }, required: ['query'] },
  },
  {
    name: 'get_discounts',
    description: "Shopify discounts: code and automatic discounts with title, codes, what they give (summary), status, start/end dates, usage counts and what they combine with. Active only by default. Use for sale planning, 'what promos are running', BFCM offers, and checking whether a code exists.",
    input_schema: { type: 'object', properties: { all: { type: 'boolean', description: 'true = include expired and scheduled discounts too' } } },
  },
  {
    name: 'shopify_admin_query',
    description: "Run a READ-ONLY GraphQL query against the Shopify Admin API (2026-04) for anything the other tools do not cover: orders and their line items, customers, draft orders, fulfillments, inventory by location, metafields, price lists, markets, shop policies, product media, menus. Mutations are refused. Keep results small (first: 20–50, only the fields needed); long results are truncated. Example: { orders(first: 20, query: \"created_at:>2026-10-01 tag:wholesale\", sortKey: CREATED_AT, reverse: true) { nodes { name createdAt totalPriceSet { shopMoney { amount } } customer { displayName } lineItems(first: 5) { nodes { title quantity } } } } }",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'GraphQL query document' }, variables: { type: 'object', description: 'Optional variables' } }, required: ['query'] },
  },
  {
    name: 'get_funnel_split',
    description: "Ad budget by funnel stage per platform for a date range: how much of Meta / Google / TikTok / Snapchat / Pinterest spend went to top of funnel (prospecting, awareness, broad, lookalike), middle (consideration, engagement, traffic, non-brand search) and bottom (retargeting, brand search, shopping, catalog), read from campaign names and Google campaign types, with the unclassified campaigns named. Use for 'how much are we spending on prospecting vs retargeting', funnel mix, budget allocation questions.",
    input_schema: { type: 'object', properties: { date_from: { type: 'string', description: 'YYYY-MM-DD' }, date_to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date_from', 'date_to'] },
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
        timeframe: { type: 'string', enum: ['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'last_month', '3m', '6m', 'ytd'], description: 'Period preset (default 30d). Ignored when date_from/date_to are given.' },
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
    name: 'get_marketing_expenses',
    description: "Marketing EXPENSES beyond ad spend, from the team's marketing budgeting sheet: agency fees, influencer/PR, paid tools, email/SMS, platforms, content creation, photoshoots, SEO — by month, with the monthly budget, sales goal, actual sales, new customers and the prior year. Use for true profit / fully loaded MER or CAC / budget pacing questions. Ad-platform spend itself should come from get_ad_performance or get_metrics (live); the sheet's ad rows are the team's own entries. Optional date_from/date_to prorate the sheet onto that range.",
    input_schema: { type: 'object', properties: { date_from: { type: 'string', description: 'YYYY-MM-DD (optional)' }, date_to: { type: 'string', description: 'YYYY-MM-DD (optional)' } } },
  },
  {
    name: 'get_return_rate',
    description: "Return rate (refunded sales ÷ gross sales, Shopify) for a date range, with a trailing six-month baseline and a by-month series, and whether it is normal / elevated / high vs baseline. Use when asked about returns, refunds, or why paid MER moved. Shopify books a return when it is processed, so the newest weeks rise as returns land.",
    input_schema: { type: 'object', properties: { date_from: { type: 'string', description: 'YYYY-MM-DD' }, date_to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date_from', 'date_to'] },
  },
  {
    name: 'get_goals',
    description: "The company's monthly revenue goals and ad-spend budgets (the Goals tab plan, including which months are pinned/manually set). Compare against get_metrics actuals to judge pace toward the annual target.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_bfcm',
    description: "The Black Friday / Cyber Monday plan and live performance (BFCM tab): sale window, goals (revenue, ad spend), offers, collection links, the checklist with open items and owners — and, once the sale is on (or last year's same dates before then), the store's revenue / net sales / orders / AOV / ad spend / MER vs last year, platform results, best and worst creatives, top products, and the best email and SMS campaigns. Use for any BFCM / holiday sale question.",
    input_schema: { type: 'object', properties: { year: { type: 'number', description: 'BFCM year (optional; defaults to the upcoming one)' } } },
  },
  {
    name: 'get_tasks',
    description: "The team's internal Kanban task board (Tasks tab): every task with status (todo/in_progress/done), assignee, due date and priority. Check before creating a task to avoid duplicates.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_calendar_events',
    description: "Add one or MANY entries to the dashboard's Marketing Calendar in ONE call (the same calendar the team sees on the Marketing Calendar tab). Use for launches, sales, email/SMS sends, content, photo shoots, influencer dates, deadlines. Call get_marketing_calendar first to avoid duplicates. Each entry needs a title, a start date, and a type; give an end_date for multi-day windows (a sale, early access) and put the full detail (offer, audience, collection link, copy notes) in description.",
    input_schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD start' },
              end_date: { type: 'string', description: 'YYYY-MM-DD end (optional, multi-day)' },
              type: { type: 'string', enum: ['launch', 'sale', 'email', 'sms', 'content', 'photo_shoot', 'influencer', 'deadline', 'other'] },
              channel: { type: 'string', description: 'Email / SMS / Paid / Organic / Other (free text, comma-separated allowed)' },
              status: { type: 'string', enum: ['planned', 'live', 'done'], description: 'Default planned' },
              description: { type: 'string', description: 'Details the team needs: offer, audience, products or collection, links, notes' },
            },
            required: ['title', 'date', 'type'],
          },
        },
      },
      required: ['events'],
    },
  },
  {
    name: 'update_calendar_event',
    description: "Change an existing Marketing Calendar entry (move the date, rename, change type/status/channel/description). Needs the event id from get_marketing_calendar. Only the fields given are changed.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
        type: { type: 'string', enum: ['launch', 'sale', 'email', 'sms', 'content', 'photo_shoot', 'influencer', 'deadline', 'other'] },
        channel: { type: 'string' },
        status: { type: 'string', enum: ['planned', 'live', 'done'] },
        description: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Remove a Marketing Calendar entry by id (from get_marketing_calendar). Only when the operator asked to remove or replace it.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
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
    const m = d.metrics as Record<string, number> & { merBasis?: string };
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
Total sales $${(m.totalRevenue ?? 0).toLocaleString()} · Net sales $${(m.netSales ?? m.totalRevenue ?? 0).toLocaleString()} · Orders ${(m.totalOrders ?? 0).toLocaleString()} · AOV $${(m.aov ?? 0).toFixed(2)} · Ad spend $${(m.totalAdSpend ?? 0).toLocaleString()} · MER ${m.mer?.toFixed?.(2) ?? 'N/A'}x (${m.merBasis === 'gross_less_discounts' ? 'gross sales less discounts, before returns' : 'net sales'} ÷ net ad spend; goal ${getClient().goals.targetMer}x)
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

  if (name === 'get_funnel_split') {
    if (!(DATE_RE.test(from) && DATE_RE.test(to) && from <= to)) return 'date_from and date_to (YYYY-MM-DD) are required.';
    const { fetchFunnel, funnelText } = await import('@/src/lib/funnel');
    try { return funnelText(await fetchFunnel(from, to)); }
    catch (e) { return `Funnel split unavailable: ${e instanceof Error ? e.message : String(e)}`; }
  }

  if (name === 'get_collections' || name === 'get_collection_products' || name === 'search_shopify_products' || name === 'get_discounts' || name === 'shopify_admin_query') {
    const sa = await import('@/src/lib/shopifyAdmin');
    try {
      if (name === 'get_collections') return sa.collectionsText(await sa.listCollections());
      if (name === 'get_collection_products') {
        const ref = String(input.collection || '').trim();
        if (!ref) return 'Give a collection title, handle or URL.';
        const { collection, products } = await sa.collectionProducts(ref);
        if (!collection) return `No collection matches "${ref}". Call get_collections to see the exact titles and handles.`;
        return `COLLECTION "${collection.title}" (/collections/${collection.handle}, ${collection.count} products; showing ${products.length}):\n${products.map(sa.productLine).join('\n') || '(empty)'}`;
      }
      if (name === 'search_shopify_products') {
        const q = String(input.query || '').trim();
        if (!q) return 'Give a Shopify product search query, e.g. tag:bridal or product_type:"Kids Shoes".';
        const items = await sa.searchProducts(q, Number(input.limit) || 60);
        return `PRODUCTS matching ${q} (${items.length}):\n${items.map(sa.productLine).join('\n') || '(no matches)'}`;
      }
      if (name === 'get_discounts') return await sa.listDiscounts(!input.all);
      const q = String(input.query || '').trim();
      if (!q) return 'Give a GraphQL query document.';
      return await sa.guardedQuery(q, (input.variables as Record<string, unknown>) || {});
    } catch (e) { return `Shopify request failed: ${e instanceof Error ? e.message : String(e)}`; }
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
    const events = (d?.events as { id: string; title: string; date: string; endDate?: string; type: string; status?: string; channel?: string; description?: string }[]) ?? [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const cutoff = new Date(Date.now() - 14 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const line = (e: typeof events[number]) => `- ${e.date}${e.endDate && e.endDate !== e.date ? ` → ${e.endDate}` : ''}: ${e.title} (${e.type}${e.channel ? ', ' + e.channel : ''}${e.status ? ', ' + e.status : ''}) [id ${e.id}]${e.description ? ` — ${e.description.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
    const live = events.filter(e => e.date && e.date <= today && (e.endDate || e.date) >= today);
    const upcoming = events.filter(e => e.date && e.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 80);
    const recent = events.filter(e => e.date && (e.endDate || e.date) < today && e.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    if (!live.length && !upcoming.length && !recent.length) return 'The marketing calendar is empty for the last two weeks and everything ahead. You can add entries with add_calendar_events.';
    return `Marketing calendar (ids are for update_calendar_event / delete_calendar_event):
LIVE NOW:\n${live.map(line).join('\n') || '- nothing'}
UPCOMING:\n${upcoming.map(line).join('\n') || '- nothing scheduled'}
LAST 14 DAYS:\n${recent.map(line).join('\n') || '- nothing'}`;
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
    const blog = d.blog as { status: string; items: Array<{ title: string; path: string; url: string; imageUrl: string; kind?: string; publishedAt: string; sessions: number; cartAdds: number; completed: number; bounceRate?: number | null }>; totals: Record<string, number> };
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
      const parts = [a.followers != null ? `${k(a.followers)} followers${(a as { asOf?: string }).asOf ? ` (latest snapshot, as of ${(a as { asOf?: string }).asOf}; no follower history for this period)` : ''}` : '', a.newFollowers != null ? `${sg(a.newFollowers)} net new in range${a.followersStart != null ? ` (from ${k(a.followersStart)}${a.followersStart ? `, ${(Math.round((a.newFollowers / a.followersStart) * 1000) / 10).toFixed(1)}%` : ''})` : ''}` : '',
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

${(() => { const pdd = d.pinterestDaily as { status: string; basis?: string; totals: { impressions: number; engagements: number; saves: number; pinClicks: number; outboundClicks: number; engagementRate: number; pinsCreated: number; pinsCreatedPerDay: number }; days: Array<{ date: string; impressions: number; engagements: number; pinsCreated: number }> } | undefined; if (!pdd || pdd.status !== 'ok') return ''; const t = pdd.totals; return `PINTEREST BY DAY (table${pdd.basis === 'lifetime_diff' ? ', day-over-day change in lifetime counts' : ''}): impressions ${Math.round(t.impressions).toLocaleString()} · engagements ${Math.round(t.engagements).toLocaleString()} (${t.saves} saves, ${t.pinClicks} pin clicks, ${t.outboundClicks} outbound) · engagement rate ${(t.engagementRate * 100).toFixed(2)}% · pins created ${t.pinsCreated} (${t.pinsCreatedPerDay}/day, incl. pins Pinterest auto-generates from the site)\nDaily (date,impressions,engagements,pinsCreated): ${pdd.days.map(x => `${x.date},${Math.round(x.impressions)},${Math.round(x.engagements)},${x.pinsCreated}`).join(' ')}\n\n`; })()}PINTEREST ORGANIC PINS (Pinterest's own counts):
${postLines('Pinterest', pin, ['impressions', 'saves', 'pinClicks', 'outboundClicks'])}

INSTAGRAM POSTS & REELS (Instagram's own counts):
${postLines('Instagram', ig, ['reach', 'likes', 'comments', 'saves', 'shares', 'views'])}

BLOG ARTICLES (Shopify sessions that started on the article; bounce rate = GA4's share of sessions under 10s with no conversion and one page; blog home / tag pages marked):
${blog.status !== 'ok' ? 'unavailable' : (blog.items.slice(0, 12).map(b => `- ${b.title}${b.kind && b.kind !== 'article' ? ` [${b.kind === 'index' ? 'blog home' : 'tag page'}]` : ''} (${b.publishedAt || 'date n/a'}): ${b.sessions} sessions · ${b.cartAdds} add-to-cart · ${b.completed} orders${b.bounceRate != null ? ` · bounce ${Math.round(b.bounceRate * 100)}% (GA4)` : ''}\n   image: ${b.imageUrl || 'none'}\n   link: ${b.url}`).join('\n') || 'no blog sessions') + `\nTotals: ${blog.totals.sessions || 0} sessions · ${blog.totals.completed || 0} orders · ${blog.totals.articles || 0} articles${blog.totals.bounceRatePct != null ? ` · blog-wide bounce ${blog.totals.bounceRatePct}% (GA4, session-weighted)` : ''}`}

UNPAID SITE SESSIONS REFERRED BY: Pinterest ${st?.Pinterest?.sessions ?? 0} (${st?.Pinterest?.completed ?? 0} orders) · Instagram ${st?.Instagram?.sessions ?? 0} (${st?.Instagram?.completed ?? 0} orders). Many in-app taps hide the referrer, so this is a floor.`;
  }

  if (name === 'get_marketing_expenses') {
    const { expensesConfigured, fetchExpenseSheet, expensesForRange, expensesText } = await import('@/src/lib/expenses');
    if (!expensesConfigured()) return 'No marketing expenses sheet is connected for this client.';
    try {
      const sheet = await fetchExpenseSheet();
      const range = DATE_RE.test(from) && DATE_RE.test(to) && from <= to ? expensesForRange(sheet, from, to) : null;
      return expensesText(sheet, range);
    } catch (e) { return `Marketing expenses sheet unavailable: ${e instanceof Error ? e.message : String(e)}`; }
  }

  if (name === 'get_return_rate') {
    const { returnsConfigured, fetchReturnsSummary, returnsText } = await import('@/src/lib/returns');
    if (!returnsConfigured()) return 'Shopify is not connected for this client.';
    if (!(DATE_RE.test(from) && DATE_RE.test(to) && from <= to)) return 'date_from and date_to (YYYY-MM-DD) are required.';
    try { return returnsText(await fetchReturnsSummary(from, to)); }
    catch (e) { return `Return rate unavailable: ${e instanceof Error ? e.message : String(e)}`; }
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

  if (name === 'get_bfcm') {
    const { loadBfcmPlan, bfcmPlanText, bfcmYear } = await import('@/src/lib/bfcm');
    const year = Number(input.year) || bfcmYear();
    const plan = await loadBfcmPlan(year);
    const perf = await get(`/api/bfcm/performance?year=${year}`).catch(() => null);
    const $ = (v: unknown) => `$${Math.round(Number(v) || 0).toLocaleString()}`;
    let perfText = 'Performance: unavailable.';
    if (perf && !perf.error) {
      type S = { revenue: number; netSales: number; orders: number; aov: number; spend: number; mer: number; newCustomers: number } | null;
      const st = perf.store as S; const py = perf.priorYear as S;
      const w = perf.window as { from: string; to: string };
      const line = (s: S) => s ? `revenue ${$(s.revenue)} · net sales ${$(s.netSales)} · orders ${s.orders} · AOV ${$(s.aov)} · ad spend ${$(s.spend)} · MER ${s.mer.toFixed(2)}x · new customers ${s.newCustomers}` : 'n/a';
      const plats = (perf.platforms as Array<{ platform: string; spend: number; revenue: number; roas: number; conversions: number }>) || [];
      const cr = perf.creatives as { best: Array<{ name: string; platform: string; spend: number; roas: number; conversions: number }>; worst: typeof cr.best };
      const prods = (perf.products as Array<{ name: string; revenue: number; unitsSold: number }>) || [];
      type OwnedCamp = { name: string; revenue?: number; recipients?: number; openRate?: number; clickRate?: number };
      const owned = perf.owned as { email: OwnedCamp[]; sms: OwnedCamp[]; overview?: { email: { revenue: number }; sms: { revenue: number } } } | null;
      perfText = `Performance ${perf.previewLastYear ? '(PREVIEW: last year\'s same dates, the sale has not started)' : ''} ${w.from} → ${w.to}:
Store: ${line(st)}
Last year same dates: ${line(py)}
Platforms: ${plats.map(p => `${p.platform} spend ${$(p.spend)} · revenue ${$(p.revenue)} · ROAS ${p.roas.toFixed(2)}x · purchases ${p.conversions}`).join(' | ') || 'n/a'}
Best creatives: ${cr?.best?.map(c => `${c.name} [${c.platform}] ROAS ${c.roas.toFixed(2)}x on ${$(c.spend)}`).join('; ') || 'n/a'}
Worst creatives: ${cr?.worst?.map(c => `${c.name} [${c.platform}] ROAS ${c.roas.toFixed(2)}x on ${$(c.spend)}`).join('; ') || 'n/a'}
Top products: ${prods.slice(0, 8).map(p => `${p.name} ${$(p.revenue)} (${p.unitsSold} units)`).join('; ') || 'n/a'}
Email: ${owned?.overview ? `${$(owned.overview.email.revenue)} total · ` : ''}${owned?.email?.slice(0, 5).map(c => `${c.name} ${$(c.revenue || 0)}${c.openRate != null ? ` · open ${(c.openRate * 100).toFixed(0)}%` : ''}`).join('; ') || 'none in window'}
SMS: ${owned?.overview ? `${$(owned.overview.sms.revenue)} total · ` : ''}${owned?.sms?.slice(0, 5).map(c => `${c.name} ${$(c.revenue || 0)}`).join('; ') || 'none in window'}`;
    }
    return `${bfcmPlanText(plan, today)}\n\n${perfText}`;
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

  if (name === 'add_calendar_events') {
    const TYPES = ['launch', 'sale', 'email', 'sms', 'content', 'photo_shoot', 'influencer', 'deadline', 'other'];
    const list = Array.isArray(input.events) ? (input.events as Array<Record<string, unknown>>) : [];
    const events = list.map(e => ({
      title: String(e.title ?? '').trim(),
      date: String(e.date ?? ''),
      endDate: DATE_RE.test(String(e.end_date ?? '')) ? String(e.end_date) : undefined,
      type: TYPES.includes(String(e.type)) ? String(e.type) : 'other',
      channel: e.channel ? String(e.channel) : undefined,
      status: ['planned', 'live', 'done'].includes(String(e.status)) ? String(e.status) : 'planned',
      description: e.description ? String(e.description) : undefined,
    }));
    const bad = events.find(e => !e.title || !DATE_RE.test(e.date));
    if (!events.length || bad) return 'Error: every event needs a title and a date (YYYY-MM-DD).';
    const d = await get('/api/calendar', { method: 'POST', body: { events } });
    if (!d || d.error) return `Error: could not add to the calendar (${d?.error || 'no response'}).`;
    return `Added ${events.length} calendar entr${events.length === 1 ? 'y' : 'ies'}: ${events.map(e => `${e.date}${e.endDate ? '→' + e.endDate : ''} ${e.title}`).join(' · ')}. They are on the Marketing Calendar tab now.`;
  }

  if (name === 'update_calendar_event') {
    const id = String(input.id ?? '').trim();
    if (!id) return 'Error: id is required (see get_marketing_calendar).';
    const body: Record<string, unknown> = {};
    if (input.title != null) body.title = String(input.title);
    if (input.date != null) { if (!DATE_RE.test(String(input.date))) return 'Error: date must be YYYY-MM-DD.'; body.date = String(input.date); }
    if (input.end_date != null) body.endDate = DATE_RE.test(String(input.end_date)) ? String(input.end_date) : undefined;
    if (input.type != null) body.type = String(input.type);
    if (input.channel != null) body.channel = String(input.channel);
    if (input.status != null) body.status = String(input.status);
    if (input.description != null) body.description = String(input.description);
    const d = await get(`/api/calendar/${encodeURIComponent(id)}`, { method: 'PUT', body });
    if (!d || d.error) return `Error: could not update ${id} (${d?.error || 'no response'}).`;
    const ev = d.event as { date: string; title: string } | undefined;
    return `Updated calendar entry ${id}${ev ? `: ${ev.date} ${ev.title}` : ''}.`;
  }

  if (name === 'delete_calendar_event') {
    const id = String(input.id ?? '').trim();
    if (!id) return 'Error: id is required (see get_marketing_calendar).';
    const d = await get(`/api/calendar/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!d || d.error) return `Error: could not delete ${id} (${d?.error || 'no response'}).`;
    return `Deleted calendar entry ${id}.`;
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
