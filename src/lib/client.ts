// A6 Dashboard client profiles — the ONE place a deployment learns which
// brand it serves. The product is Area 6 Marketing's; each client gets its
// own fully separate deployment of it.
//
// The dashboard started life as Rocknot's; everything brand-specific (name,
// logo, Shopify store, which ad platforms run, how the Meta/QuickBooks feeds
// are filtered, the voice of the AI prompts, Rocknot's bag/strap inventory
// rules) now reads from the active profile so the same codebase deploys per
// client with env vars only.
//
// Selecting the client (checked in this order):
//   1. CLIENT env var            — "rocknot" | "kaileep" | "skimpies"
//   2. BQ_DATASET env var        — a dataset named after a known client
//   3. default                   — "kaileep"
//
// Server code calls getClient(). Client components use useClient() from
// src/components/ClientProvider.tsx (the root layout hands the profile down).
// Keep profiles JSON-serialisable: they cross the server → browser boundary.

export type ClientId = 'rocknot' | 'kaileep' | 'skimpies';

// Every ad platform the dashboard knows how to read. A client lists the ones
// it actually runs; queries and UI for the rest are skipped.
export type PlatformKey = 'meta' | 'google' | 'tiktok' | 'snapchat' | 'pinterest';

export interface GoalSeason {
  name: string;
  /** Calendar months (1–12) the season covers. */
  months: number[];
  targetMer: number;
  merFloor?: number | null;
  targetFullyLoadedMer?: number | null;
  fullyLoadedFloor?: number | null;
  targetCac: number;
  cacCeiling?: number | null;
  /** Display labels when the agreed target is a range, e.g. '6.5–7.5x', '$25–28'. */
  merLabel?: string;
  fullyLoadedLabel?: string;
  cacLabel?: string;
  /** Fully loaded CAC (ALL marketing incl. the retainer ÷ new customers): the business's metric. */
  targetFullyLoadedCac?: number | null;
  fullyLoadedCacCeiling?: number | null;
  /** Budget posture in words, shown in the calculation notes. */
  posture?: string;
}

/**
 * One month of the agreed plan: the goal, the spend it is built on, what
 * gates a lift, and the fully loaded CAC it is judged on. Overrides the
 * season's fully loaded CAC for that month (see effectiveGoals).
 */
export interface MonthPlan {
  /** 'YYYY-MM' */
  month: string;
  /** Revenue on the client's MER basis (revenue.merBasis: net sales, or gross sales less discounts). */
  revenueGoal?: number;
  stretchGoal?: number;
  /** Below this the plan changes (spend, fixed costs or both), not the target. */
  floorGoal?: number;
  /** New customers (all channels the client counts). */
  newCustomerGoal?: number;
  newCustomerFloor?: number;
  /** Planned starting ad spend and the ceiling if every gate passes. */
  adBudget?: number;
  adBudgetMax?: number;
  targetFullyLoadedCac?: number | null;
  fullyLoadedCacCeiling?: number | null;
  aovTarget?: number | null;
  /** The lift / hold rule in words. */
  rule?: string;
}

/** A dated touch point where the plan is re-read and a decision is taken. */
export interface Checkpoint {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  title: string;
  /** What to look at. */
  check: string;
  /** What changes on a pass or a miss. */
  decision?: string;
  owner?: string;
}

export interface EffectiveGoals {
  targetMer: number;
  merFloor: number | null;
  targetFullyLoadedMer: number | null;
  fullyLoadedFloor: number | null;
  targetCac: number;
  cacCeiling: number | null;
  contributionFloorPct: number | null;
  targetRoas: number;
  merLabel: string;
  fullyLoadedLabel: string | null;
  cacLabel: string;
  season: { name: string; months: string; posture?: string } | null;
  /** Fully loaded CAC target / ceiling for the month (plan month > season > none). */
  targetFullyLoadedCac: number | null;
  fullyLoadedCacCeiling: number | null;
  /** The plan entry for the month, when one exists. */
  monthPlan: MonthPlan | null;
}

export interface PlatformDef {
  key: PlatformKey;
  label: string;          // display name used across the UI and API payloads
  color: string;          // chart / chip colour (dashboard pastel)
  chipColor: string;      // stronger tint for badges
  bqTable: string;        // Windsor → BigQuery destination table
  windsorSource: string;  // Windsor REST connector name
}

export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  meta:      { key: 'meta',      label: 'Meta',      color: '#818cf8', chipColor: '#818cf8', bqTable: 'facebook_ads',  windsorSource: 'facebook' },
  google:    { key: 'google',    label: 'Google',    color: '#34d399', chipColor: '#34d399', bqTable: 'google_ads',    windsorSource: 'google_ads' },
  tiktok:    { key: 'tiktok',    label: 'TikTok',    color: '#f472b6', chipColor: '#f472b6', bqTable: 'tiktok_ads',    windsorSource: 'tiktok' },
  snapchat:  { key: 'snapchat',  label: 'Snapchat',  color: '#facc15', chipColor: '#eab308', bqTable: 'snapchat_ads',  windsorSource: 'snapchat' },
  pinterest: { key: 'pinterest', label: 'Pinterest', color: '#fb7185', chipColor: '#e11d48', bqTable: 'pinterest_ads', windsorSource: 'pinterest' },
};

/** Windsor REST connector names the dashboard queries directly. */
export type WindsorSource = 'facebook' | 'google_ads' | 'tiktok' | 'snapchat' | 'pinterest' | 'shopify' | 'quickbooks' | 'pinterest_organic' | 'instagram' | 'google_analytics';

/**
 * A wholesale / marketplace channel that lands in Shopify as its own sales
 * channel (e.g. Nordstrom dropship via the Dscopify app). Gets its own tab.
 */
export interface MarketplaceChannel {
  /** URL slug, e.g. 'nordstrom'. */
  key: string;
  /** Tab + card label, e.g. 'Nordstrom'. */
  label: string;
  /** Exact `sales_channel` value in Shopify Analytics, e.g. 'Dscopify Dropship'. */
  shopifyChannel: string;
  /** Case-insensitive regex matched against Windsor's `order_source_name` (BigQuery rows), e.g. 'dscopify'. */
  sourceMatch: string;
  /** Commission the marketplace keeps, % of retail. null = not set yet (contribution shows without it). */
  commissionPct: number | null;
  /** Flat charge the marketplace bills per customer return, in dollars. null = none / not set. */
  returnFee: number | null;
  /** Customer return window in days — sales younger than this are still "open" for returns. */
  returnWindowDays: number;
  /** One line for the tab subtitle. */
  description: string;
  /**
   * Count this channel's net sales in MER (ads drive or don't distort it),
   * while keeping it out of the store's sales, orders, AOV, customers and
   * CAC. Default false: excluded everywhere (Kailee P's Nordstrom).
   */
  countInMer?: boolean;
  /**
   * Count this channel in the Overview's sales, orders, AOV and daily revenue
   * too (implies MER). Customers, new-customer CAC and the product, returns and
   * traffic pages stay store-only: marketplace buyers aren't store customers
   * (Amazon hides who they are, so every order would read as a new customer).
   */
  countInSales?: boolean;
  /** Sidebar icon: a path under /public (e.g. a brand mark) or an emoji. Default 🏬. */
  icon?: string;
}

export interface ProductLine {
  key: string;
  label: string;
  /** Case-insensitive regex source matched against Shopify product_type ('' on the default line). */
  productMatch: string;
  /** Case-insensitive regex source matched against ad campaign names ('' on the default line). */
  campaignMatch: string;
  /** Cost-per-order target (ad spend ÷ orders), flagged red when exceeded. */
  targetCpa: number;
  /** Expected share of revenue (0–1), used to split a month goal across lines. */
  revenueShare: number;
  /** Catches everything the other lines don't match. */
  isDefault?: boolean;
}

export interface ClientProfile {
  id: ClientId;
  /** Brand name as written in prose: "Kailee P". */
  name: string;
  /** Uppercase wordmark for the sidebar / login card. */
  wordmark: string;
  /** Single-letter fallback when the logo file is missing. */
  initial: string;
  /** Path under /public ('' = no logo yet; the initial is shown instead). */
  logo: string;
  /** Sidebar/login accent gradient (hex, inline-styled so Tailwind purging can't drop it). */
  theme: {
    accentFrom: string; accentTo: string; loginMark: string;
    /** Favicon gradient (saturated enough for a white bold letter). */
    icon: { from: string; to: string };
  };
  /** Public storefront domain the AI may point designers to. */
  siteDomain: string;
  /** Where this deployment lives — used in alert emails' deep links. */
  dashboardUrl: string;
  /** Prefix for browser localStorage keys so two clients never share a cache. */
  storagePrefix: string;
  /** Legal entity as it appears in QuickBooks. */
  legalEntity: string;
  brand: {
    /** One-paragraph description of the business for every AI prompt. */
    description: string;
    /** Founder who appears on camera (drives the founder creative track). */
    founder: { name: string; onCamera: boolean } | null;
    /** Approx. average order value in USD, when known (null = omit from prompts). */
    aov: number | null;
    /** Retention-plan and insight prompts lean on this for "value" content ideas. */
    contentAngles: string;
  };
  shopify: {
    /** Fallback when SHOPIFY_STORE_DOMAIN isn't set. */
    defaultDomain: string;
  };
  ads: {
    platforms: PlatformKey[];
    /**
     * Case-insensitive substring of the Meta ad account name. Windsor's
     * facebook feed can carry every client in the agency workspace, so
     * BigQuery and REST rows are filtered to this account. Override with the
     * META_ACCOUNT_NAME env var. Empty string = no name filter.
     */
    metaAccountNameMatch: string;
    /** 'exact' = account_name must equal the match (Rocknot's original rule); 'contains' = substring. */
    metaAccountNameMode: 'exact' | 'contains';
    /** Fallback when META_AD_ACCOUNT_ID isn't set ('' = env only). */
    metaAccountIdDefault: string;
    /**
     * Pinterest Ads Manager's conversion settings, applied verbatim to every
     * direct Pinterest API call so the dashboard's Pinterest row equals the
     * Pinterest dashboard. Omit = Pinterest's 7-day click / 7-day
     * engagement / 1-day view, reported by ad date.
     */
    pinterestAttribution?: {
      clickWindowDays: 1 | 7 | 30;
      engagementWindowDays: 1 | 7 | 30;
      viewWindowDays: 1 | 7 | 30;
      conversionReportTime: 'TIME_OF_AD_ACTION' | 'TIME_OF_CONVERSION';
    };
  };
  finance: {
    /** Case-insensitive regex source matched against QuickBooks account_name ('' = keep all). */
    qbAccountMatch: string;
    /**
     * Stated gross margin (0–100) used as the COGS basis when no booked
     * QuickBooks months are available (COGS% = 100 − this). null = no basis:
     * the COGS / contribution cards stay hidden until books are connected.
     */
    grossMarginPct: number | null;
    /**
     * The team's marketing budgeting Google Sheet (link-shared, read as CSV):
     * one row per expense line, one column per month. Feeds the Overview's
     * fully loaded profit / MER / CAC and Cleo's get_marketing_expenses.
     */
    expensesSheet: { id: string; tab: string; year: number } | null;
    /**
     * A fixed monthly marketing cost folded into "other marketing" for the
     * fully loaded MER / CAC / contribution figures WITHOUT appearing as a
     * line in any breakdown (agency retainer not recorded on the sheet).
     * Prorated by day like the sheet's months. Omit for none.
     */
    hiddenMonthlyCost?: number;
  };
  /**
   * Extra campaign-name words for the funnel split on Ad Performance (lower
   * case phrases). Checked before the built-in rules in src/lib/funnel.ts.
   */
  funnelRules?: { tof?: string[]; mof?: string[]; bof?: string[] };
  revenue: {
    /**
     * Shopify's net sales subtracts the FULL refund on a return. A store that
     * charges a return fee keeps that fee, so it is real revenue: when true,
     * ShopifyQL `return_fees` is added back into net sales for MER/goals.
     * Only affects the ShopifyQL path (BigQuery order rows carry no fee data).
     */
    includeReturnFees: boolean;
    /**
     * What the Overview's MER numerators (paid and fully loaded) are built on.
     * 'net' (default): Shopify net sales — after discounts AND returns.
     * 'gross_less_discounts': gross sales minus discounts, BEFORE returns —
     * Kailee P's choice (Oct 2026): the agency is judged on what was sold, not on
     * returns processed later. Contribution margin stays on net sales either way.
     */
    merBasis?: 'net' | 'gross_less_discounts';
  };
  windsor: {
    /**
     * The agency's Windsor workspace holds EVERY client's connectors, so every
     * direct REST call must be scoped to this client's account. Per source:
     *   string  → sent as Windsor's `select_accounts` parameter
     *   ''      → unscoped (only safe while this client is the sole account of that type)
     *   null    → this client has no such account yet: the REST call is skipped
     * Env override per source: WINDSOR_ACCOUNT_FACEBOOK, WINDSOR_ACCOUNT_GOOGLE_ADS, …
     */
    accounts: Record<WindsorSource, string | null>;
  };
  /**
   * Product lines reported separately on the Overview (e.g. women's vs kids):
   * revenue/orders split by Shopify product_type, ad spend by campaign name,
   * each with its own cost-per-order target. Omit for a single-line brand.
   * Exactly one line should be the default (catches everything unmatched).
   */
  lines?: ProductLine[];
  /** Marketplace channels reported on their own tab (Shopify sales_channel filter). */
  marketplaces?: MarketplaceChannel[];
  /** BFCM tab seeds: collection pages the sale drives traffic to (shown until an admin edits the plan's links). */
  bfcm?: { collections: Array<{ label: string; url: string }>; lastYear?: { from: string; to: string; earlyAccess?: { from: string; to: string } } };
  goals: {
    /** Starting annual net-sales target shown until an admin saves one (0 = ask). */
    defaultAnnualTarget: number;
    /** Fully loaded MER target: net sales ÷ (ad spend + every other marketing cost). null = not set. */
    targetFullyLoadedMer?: number | null;
    /** Contribution-margin floor (% of net sales after COGS and ALL marketing) the business holds itself to. null = not set. */
    contributionFloorPct?: number | null;
    /** Net-sales MER the ad budgets are planned around. */
    targetMer: number;
    /** Per-platform ROAS the Ad Performance recommendations grade against. */
    targetRoas: number;
    /** New-customer CAC (ad spend ÷ new customers) flagged red when exceeded. */
    targetCac: number;
    /**
     * Seasonal targets. When the selected range ends in one of a season's
     * months, its numbers replace the base targets above (see effectiveGoals).
     * Lets a seasonal business hold peak-season and slow-season guardrails.
     */
    seasons?: GoalSeason[];
    /** The agreed month-by-month plan (Goals tab: "Plan, guardrails and checkpoints"). */
    plan?: MonthPlan[];
    /** Dated touch points where the plan is re-read; reviews are stored per client (checkpointStore). */
    checkpoints?: Checkpoint[];
  };
  inventory: {
    /**
     * "rocknot-bags": Rocknot's hand-audited bag/strap consolidation rules.
     * "standard": one row per Shopify variant, no special-casing.
     */
    mode: 'rocknot-bags' | 'standard';
  };
  creatives: {
    /** Founder on-camera brief track (null = only video-edit and static tracks). */
    founderTrack: { label: string; personName: string } | null;
    /** Pinned Drive folders on the Creative Analysis tab. */
    driveFolders: Array<{ label: string; url: string; tone: 'blue' | 'purple' }>;
  };
  alerts: {
    /** "From" display name for the Monday restock email. */
    fromName: string;
  };
  analyst: {
    /** Name of the in-house AI analyst persona. */
    name: string;
  };
  /** Rocknot's one-time data seed routes (reorders, calendar) only make sense for Rocknot. */
  seedsEnabled: boolean;
  /**
   * Sales and ad numbers (Overview, Ad Performance, Creative Analysis) come
   * straight from Shopify and each ad platform's API instead of Windsor —
   * even when WINDSOR_API_KEY is set for other sources such as Instagram.
   */
  directData?: boolean;
  /**
   * The client's own admins (e.g. owner and operator). Admins straight away;
   * copied once into the Team & Access list when that store is first
   * available, after which they are ordinary, removable admins — unlike
   * AUTH_ADMINS, which are permanent.
   */
  startingAdmins?: string[];
  /**
   * Subscription app whose renewal orders land in Shopify as their own sales
   * channel (e.g. Loop). Turns on the Subscriptions tab. Omit when the brand
   * sells no subscriptions.
   */
  subscriptions?: { provider: 'loop'; shopifyChannel: string };
}

const ROCKNOT: ClientProfile = {
  id: 'rocknot',
  name: 'Rocknot',
  wordmark: 'ROCKNOT',
  initial: 'R',
  logo: '/logo.png',
  theme: { accentFrom: '#a78bfa', accentTo: '#f472b6', loginMark: '#ec4899', icon: { from: '#a78bfa', to: '#f472b6' } },
  siteDomain: 'rocknot.com',
  dashboardUrl: 'https://rocknot-dashboard.vercel.app',
  storagePrefix: 'rocknot',
  legalEntity: 'Rocknot LLC',
  brand: {
    description: 'Rocknot is a DTC music-inspired rhinestone jewelry, handbag & accessories brand (bags with interchangeable straps, jewelry, phone accessories).',
    founder: { name: 'Orly', onCamera: true },
    aov: 170,
    contentAngles: 'styling tips, founder story, UGC roundups',
  },
  shopify: { defaultDomain: 'shop-rocknot.myshopify.com' },
  ads: {
    platforms: ['meta', 'google', 'tiktok', 'snapchat'],
    metaAccountNameMatch: 'rocknot',
    metaAccountNameMode: 'exact',
    metaAccountIdDefault: '165092079662754',
  },
  finance: { qbAccountMatch: 'rocknot', grossMarginPct: null, expensesSheet: null }, // QuickBooks connected — booked months set the basis
  revenue: { includeReturnFees: false },
  windsor: {
    accounts: {
      // Ids as they appear in Rocknot's Windsor → BigQuery tasks (select_accounts=).
      facebook: '165092079662754',
      shopify: 'shop-rocknot.myshopify.com',
      google_ads: '785-386-4235',
      tiktok: '7331079299845357570',
      snapchat: 'cd018406-4f67-4afc-85cb-8479a6a43698',
      // QuickBooks: Rocknot LLC is the only company connected; rows are also
      // filtered by finance.qbAccountMatch.
      quickbooks: '',
      pinterest: null,
      // Organic Content tab sources (Windsor "Pinterest Organic" / "Instagram
      // Insights" data sources). null = not connected: the tab says so.
      pinterest_organic: null,
      instagram: '17841450822497159', // Instagram Insights (Oct 2026)
      // Google Analytics 4 (Traffic tab → Google Analytics view). null = the
      // view is hidden and Cleo's get_site_analytics says not connected.
      google_analytics: null,
    },
  },
  goals: { defaultAnnualTarget: 4_000_000, targetMer: 3.5, targetRoas: 3.5, targetCac: 100 },
  inventory: { mode: 'rocknot-bags' },
  creatives: {
    founderTrack: { label: 'Orly', personName: 'Orly' },
    driveFolders: [
      { label: '📁 Rocknot Marketing Folder', url: 'https://drive.google.com/drive/folders/1DfcJWwZPVDG9vIbPNZr5qjCBDfR_C9TL', tone: 'blue' },
      { label: '🎨 Internal Design Folder', url: 'https://drive.google.com/drive/folders/1LGEZyg5zqCCLLWgpI4lfYUjsoLAC6ia4', tone: 'purple' },
    ],
  },
  alerts: { fromName: 'Rocknot Dashboard' },
  analyst: { name: 'Cleo' },
  seedsEnabled: true,
};

// Kailee P — bridal shoes (kaileep.com) plus flower girl and kids shoes.
// Paid media runs on Google, Meta and Pinterest (NP Digital); email via
// Klaviyo; store on Shopify. Business facts below come from the Sept 2026
// engagement running doc and the NP Digital Google/Meta audit.
const KAILEEP: ClientProfile = {
  id: 'kaileep',
  name: 'Kailee P',
  wordmark: 'KAILEE P',
  initial: 'K',
  logo: '', // drop a file at public/kaileep-logo.png and set this to '/kaileep-logo.png'
  theme: { accentFrom: '#f9a8d4', accentTo: '#e9d5ff', loginMark: '#f472b6', icon: { from: '#f472b6', to: '#c084fc' } },
  siteDomain: 'kaileep.com',
  dashboardUrl: 'https://kaileep-dashboard.vercel.app',
  storagePrefix: 'kaileep',
  legalEntity: 'Kailee P',
  brand: {
    description: 'Kailee P is a DTC bridal shoe brand (kaileep.com): wedding heels, flats and "something blue" styles for brides, plus flower girl and kids shoes. Purchases are occasion-driven with a long planning window; the core buyer is a woman aged 25-34 planning her wedding, and bridal accessories are natural add-ons.',
    founder: { name: 'Kailee', onCamera: true },
    aov: 150, // October 2026 brief target
    contentAngles: 'real-bride and wedding-day features, styling the shoe with the dress, comfort and break-in tips, flower girl moments, the second pair for the reception (ceremony look + celebration look), interchangeable ankle straps (plain, pearl, sparkle) via the product customizer, low block heels and closed toes for cooler-season weddings',
  },
  shopify: { defaultDomain: 'kailee-p.myshopify.com' },
  ads: {
    platforms: ['meta', 'google', 'pinterest'],
    // Meta ad account "Kailee P. Weddings" (Windsor account name matches on 'kailee').
    metaAccountNameMatch: 'kailee',
    metaAccountNameMode: 'contains',
    metaAccountIdDefault: '449159425278819',
    // Ads Manager → Conversion settings (7/1): 7-day click, 7-day engagement,
    // 1-day view, reported on the ad-event date.
    pinterestAttribution: { clickWindowDays: 7, engagementWindowDays: 7, viewWindowDays: 1, conversionReportTime: 'TIME_OF_AD_ACTION' },
  },
  finance: {
    qbAccountMatch: 'kailee', grossMarginPct: 89, // per Airin, Sep 2026: ~89% gross margin across the board
    // "2026 Marketing Budgeting Sheet - SHOPIFY ONLY", tab FOR DASHBOARD (Oct 2026, per Angie).
    expensesSheet: { id: '1Zl7XNRfsruSxyGoPDcTGPYr3z7Pabu4E5qYdnbQkjDg', tab: 'FOR DASHBOARD', year: 2026 },
    // No hidden retainer: Airin carries the agency fee in the sheet's "PAID ADS"
    // row from Nov 2026 (confirmed Nov 7, 2026), so adding it here double-counted it.
  },
  revenue: { includeReturnFees: true, merBasis: 'gross_less_discounts' }, // Kailee P charges a return fee and keeps it; MER on gross − discounts (before returns)
  windsor: {
    accounts: {
      facebook: '449159425278819',
      shopify: 'kailee-p.myshopify.com',
      google_ads: '862-657-0919', // Kailee P. Inc. (Windsor task BQ - Google Ads - Kailee P)
      // Two Pinterest ad accounts under one Pinterest business: Bridal + Kids.
      pinterest: '549755884097,549768552210',
      // Not connected yet: REST calls for these are skipped rather than
      // returning another client's data from the shared workspace.
      tiktok: null,
      snapchat: null,
      quickbooks: null,
      // Organic Content tab. Instagram Insights: "Kailee P. Wedding Shoes"
      // (@kaileepweddings). Pinterest Organic: Windsor keys this connector by
      // Pinterest USERNAME (its error names the configured accounts), not the
      // numeric business id the accounts list shows.
      pinterest_organic: 'shopkaileep',
      instagram: '17841402329636544',
      // GA4 property "Kailee P" (Windsor Google Analytics 4 connector).
      google_analytics: '347015181',
    },
  },
  // No annual target has been shared yet — the Goals tab asks for one. The
  // MER/ROAS bars start from the NP Digital audit's blended Meta ROAS (~15x
  // reported) discounted for the Google tag inflation it found; adjust once
  // the real plan lands.
  // Two product lines with their own cost-per-order targets (October 2026
  // brief: women's $30, kids $15; kids ≈ 20% of revenue). Shopify types the
  // products "Women Shoes" / "Kids Shoes"; NP Digital labels kids campaigns.
  lines: [
    { key: 'women', label: "Women's", productMatch: '', campaignMatch: '', targetCpa: 30, revenueShare: 0.8, isDefault: true },
    { key: 'kids', label: 'Kids', productMatch: 'kid|flower girl|junior', campaignMatch: 'kid|flower girl|junior', targetCpa: 15, revenueShare: 0.2 },
  ],
  // Nordstrom dropship (Sep 2026, per Angie): Kailee ships each pair, Shopify
  // records the order at full retail under the Dscopify app's channel, and
  // Nordstrom keeps a 20% commission that never appears in Shopify and bills
  // $5 per customer return (per Angie, Oct 2026). Nordstrom's 90-day return
  // policy runs far longer than the store's.
  marketplaces: [
    { key: 'nordstrom', label: 'Nordstrom', shopifyChannel: 'Dscopify Dropship', sourceMatch: 'dscopify', commissionPct: 20, returnFee: 5, returnWindowDays: 90,
      description: 'Nordstrom Marketplace dropship · Shopify sales channel "Dscopify Dropship" · orders at full retail; Nordstrom keeps 20% and bills $5 per return, neither in Shopify' },
  ],
  // October 2026 brief: blended MER 5–6 (5 = the pass line), Google ROAS ≥ 6x,
  // CPA target < $27–30.
  // BFCM 2026 collection pages (per Angie, Oct 2026).
  bfcm: {
    collections: [
      { label: 'All BFCM deals', url: 'https://www.kaileep.com/collections/all-black-friday-cyber-monday-deals' },
      { label: "Women's shoes", url: 'https://www.kaileep.com/collections/women-shoes-2026-black-friday-cyber-monday-deals' },
      { label: 'Bridal shoes', url: 'https://www.kaileep.com/collections/bridal-shoes-black-friday-cyber-monday-deals' },
      { label: 'Kids shoes', url: 'https://www.kaileep.com/collections/kids-shoes-2026-black-friday-cyber-monday-deals' },
    ],
    // BFCM 2025 (per Angie): gated VIP early access Nov 9–15, public sale Nov 27–30.
    lastYear: { from: '2025-11-27', to: '2025-11-30', earlyAccess: { from: '2025-11-09', to: '2025-11-15' } },
  },
  // $4M 2026 net-sales target set Sep 2026. Paid MER 5x is the agency's number;
  // fully loaded MER and the contribution floor are the business's (Airin, Oct 2026).
  goals: {
    defaultAnnualTarget: 4_000_000, targetMer: 5, targetRoas: 6, targetCac: 30, targetFullyLoadedMer: 3.5, contributionFloorPct: 50,
    // Seasonal guardrails agreed with Airin (Oct 30, 2026). Peak and slow
    // months come from 2024–2025 online-store sales: Jan–Aug averages ~30%
    // more per month than Sep–Dec; July is the biggest month. Fully loaded
    // figures count every non-media line on the budgeting sheet (the agency
    // retainer is in its "PAID ADS" row) plus live ad spend.
    seasons: [
      { name: 'Peak season', months: [1, 2, 3, 4, 5, 6, 7, 8], targetMer: 6.5, merFloor: 6.0, merLabel: '6.5–7.5x', targetFullyLoadedMer: 4.25, fullyLoadedFloor: 3.8, fullyLoadedLabel: '4.25–4.5x', targetCac: 28, cacCeiling: 30, cacLabel: '$25–28', targetFullyLoadedCac: 35, fullyLoadedCacCeiling: 38, posture: 'Scale 10–15% a week when performance supports it; no increases while a floor is breached.' },
      { name: 'Slow season', months: [9, 10, 11, 12], targetMer: 5.5, merFloor: 5.0, merLabel: '5.5x', targetFullyLoadedMer: 3.5, fullyLoadedFloor: 3.3, fullyLoadedLabel: '3.5–3.8x', targetCac: 30, cacCeiling: 35, cacLabel: '$28–30', targetFullyLoadedCac: 42, fullyLoadedCacCeiling: 48, posture: 'Hold: budget changes at most 10–15% a week, no increases while performance is below a floor. BFCM (Nov 25–30) is judged on its own.' },
    ],
    // 90-day growth plan (Nov 5, 2026 memo to Airin). Revenue is gross sales
    // less discounts, all channels except Nordstrom (Airin's basis and the
    // sheet's "Actual sales" row). Fully loaded CAC = media + non-media
    // marketing + agency fee ÷ new customers. Last year on this basis:
    // Nov $217.7K, Dec $235.0K, Jan $382.4K, Feb $357.9K.
    // Growth case: conversion is up 21% on 2025, traffic is down 18%; the
    // target is +15% revenue and +20% new customers by January from getting
    // the traffic back (Google rebuild, brand defence vs Nordstrom, email
    // tagging, kids) with a 10% price rise on top. The floor is where the
    // plan changes (spend, fixed costs or both), not the target.
    // Fully loaded CAC = live ad spend + the sheet's non-media lines (~$25.9K
    // a month planned for Nov–Dec, retainer included) ÷ new customers.
    plan: [
      { month: '2026-11', revenueGoal: 240000, floorGoal: 225000, newCustomerGoal: 1550, newCustomerFloor: 1500, adBudget: 44000, targetFullyLoadedCac: 45, fullyLoadedCacCeiling: 48, rule: 'Meta ramp read on Nov 7: continue only if blended CAC ≤ $28 and paid MER ≥ 5.3x, otherwise 15% back to Google. Google Shopping and non-brand rebuilt toward $28K by Dec 1. BFCM (Nov 25–30) judged on its own.' },
      { month: '2026-12', revenueGoal: 270000, floorGoal: 250000, newCustomerGoal: 1715, newCustomerFloor: 1575, adBudget: 40000, adBudgetMax: 44000, targetFullyLoadedCac: 38, fullyLoadedCacCeiling: 43, aovTarget: 140, rule: 'Google-first at $28K (incl. kids), Meta $9K rising to $11K if the gates pass, Pinterest $3K top of funnel on breakeven, brand defence on "kailee p nordstrom". Start at $40K; lift toward $44K only if paid MER ≥ 6.0x on Dec 5 and again on Dec 12, extra into Dec 26–31. Under 5.5x on Dec 5 → hold at $40K. Target needs 6.75x paid MER (Oct 5.5x, last Dec 10.2x) and ~109K human sessions vs 100K last December.' },
      { month: '2027-01', revenueGoal: 440000, floorGoal: 400000, newCustomerGoal: 2450, newCustomerFloor: 2300, adBudget: 44000, adBudgetMax: 50000, targetFullyLoadedCac: 29, fullyLoadedCacCeiling: 35, aovTarget: 155, rule: 'Target needs ~155K human sessions at this year\'s 1.9% conversion (last Jan 146K, Jan 2025 160K) and 10x paid MER (last Jan 9.5x plus the 10% price rise). Lift 10–15% on Jan 2, 9, 16 and 23 only while paid MER ≥ 6.0x and ads-only CAC < $30. Jan 9 reads conversion through the price increase; if paid MER is near October\'s 5.5x instead, fully loaded CAC is ~$50 and the fixed-base / spend decision goes to Airin that day.' },
      { month: '2027-02', revenueGoal: 412000, floorGoal: 375000, newCustomerGoal: 2350, newCustomerFloor: 2250, adBudget: 42000, targetFullyLoadedCac: 29, fullyLoadedCacCeiling: 35, aovTarget: 155, rule: '$35 or better holds only if the fixed marketing base is back at the Q1 level (~$27.5K a month), women\'s returns are moving from 25.5% toward 21% of gross, and the price increase landed without a conversion drop. Feb 2 is the 90-day review: if Dec and Jan both came in under their floors, the plan changes, not the targets.' },
    ],
    checkpoints: [
      { id: 'cp-2026-11-07', date: '2026-11-07', title: 'Meta ramp read', check: 'Blended new-customer CAC and paid MER after the Oct 31 changes (last 7 days was $62 on Nov 3).', decision: 'Continue the ramp if blended CAC is at or under $28 and paid MER at or above 5.3x; otherwise pull Meta back 15% and move it to Google non-brand search and Shopping.', owner: 'Angie' },
      { id: 'cp-2026-11-29', date: '2026-11-29', title: 'BFCM extension call', check: 'Sale performance against the slow-season floors.', decision: 'Default: the sale ends midnight Nov 30. Extend only if it is beating the floors.', owner: 'Angie, Airin' },
      { id: 'cp-2026-11-20', date: '2026-11-20', title: 'December lock', check: 'Shipping cutoff dates confirmed with fulfillment; gift-guide assets in review; Klaviyo UTM tagging live on every send and flow so email traffic stops landing in "direct".', decision: 'Lock the December email and SMS calendar.', owner: 'Karina, Astrid' },
      { id: 'cp-2026-12-01', date: '2026-12-01', title: 'December live', check: 'Gift guide live, BFCM campaigns off, December budgets set at $40K Google-first (Google Shopping and non-brand $28K incl. a kids campaign, Meta $9K, Pinterest $3K top of funnel, brand defence covering "kailee p nordstrom" queries).', owner: 'Angie, Ting' },
      { id: 'cp-2026-12-05', date: '2026-12-05', title: 'Gate 1', check: 'Paid MER, ads-only CAC, and four-week fully loaded MER and CAC against the slow-season guardrails; human sessions against the 109K December target.', decision: 'Paid MER at or above 6.0x → lift 10–15% toward $44K. Under 5.5x → hold at $40K and judge the month against its floor ($250K, 1,575 new customers).', owner: 'Angie' },
      { id: 'cp-2026-12-12', date: '2026-12-12', title: 'Gate 2', check: 'Same test as Gate 1 after the first lift.', decision: 'Paid MER at or above 6.0x → second lift toward $44K, weighted to Dec 26–31. Otherwise hold.', owner: 'Angie' },
      { id: 'cp-2026-12-15', date: '2026-12-15', title: 'Airin decisions', check: 'Fixed marketing base for January (back to the Q1 level of ~$27.5K a month, or not); the January price increase (10% planned) and AOV target; year-end kids clearance (extra 20% test); Nordstrom sell-through by style and DTC-first launches.', owner: 'Airin' },
      { id: 'cp-2026-12-19', date: '2026-12-19', title: 'Checkpoint 4 and January approval', check: 'Peak-season targets confirmed; engagement content bank complete; Pinterest ads against breakeven (Pinterest-attributed sales cover the $3K).', decision: 'Approve the January budget plan. Pinterest under breakeven → discuss with two months of data.', owner: 'Angie, Airin' },
      { id: 'cp-2026-12-26', date: '2026-12-26', title: 'The flip', check: 'Engaged hub live, welcome flow switched, bridal ads on, Meta budget moved to bridal prospecting.', owner: 'Angie, Ting, Karina' },
      { id: 'cp-2027-01-02', date: '2027-01-02', title: 'January lift 1', check: 'Paid MER at or above 6.0x and ads-only CAC under $30.', decision: 'Lift 10–15% or hold.', owner: 'Angie' },
      { id: 'cp-2027-01-09', date: '2027-01-09', title: 'January lift 2 and the efficiency read', check: 'Paid MER against last January\'s 9.5x (October was 5.5x); conversion through the price increase; flower-girl attach rate; list growth pace.', decision: 'Second lift or hold. If paid MER is near 5.5x, fully loaded CAC lands near $50 and the three options (cut the fixed base harder, accept a higher CAC through peak, or reduce spend and volume together) go to Airin with numbers today.', owner: 'Angie, Airin' },
      { id: 'cp-2027-01-16', date: '2027-01-16', title: 'January lift 3', check: 'Same test; influencer content check-in.', decision: 'Third lift or hold.', owner: 'Angie' },
      { id: 'cp-2027-01-23', date: '2027-01-23', title: 'January lift 4 and February brief', check: 'Pace to $370K; retargeting pool sizes (150K Meta, 60K Pinterest); bundle attach rate (under 10% → revisit).', decision: 'Fourth lift or hold; February creative brief to Michelle and Astrid.', owner: 'Angie' },
      { id: 'cp-2027-02-02', date: '2027-02-02', title: '90-day review', check: 'December and January against the plan table: new customers year over year, revenue on the gross-less-discounts basis, fully loaded CAC, returns rate, and whether the three conditions for $35 held.', decision: 'If both months missed the new-customer targets, the plan changes, not the targets. Set the February–March plan.', owner: 'Angie, Airin' },
    ],
  },
  inventory: { mode: 'standard' },
  creatives: {
    founderTrack: { label: 'Kailee', personName: 'Kailee' },
    driveFolders: [],
  },
  alerts: { fromName: 'Kailee P Dashboard' },
  analyst: { name: 'Cleo' },
  seedsEnabled: false,
};

// Skimpies — new client (Oct 2026). Profile scaffolded ahead of onboarding:
// every account id is unset, so REST calls for those sources are skipped
// rather than reading another client's data from the shared Windsor
// workspace. Fill each blank in as the account details arrive (see the
// README's onboarding checklist).
const SKIMPIES: ClientProfile = {
  id: 'skimpies',
  name: 'Skimpies',
  wordmark: 'SKIMPIES',
  initial: 'S',
  logo: '', // drop a file at public/skimpies-logo.png and set this to '/skimpies-logo.png'
  theme: { accentFrom: '#60a5fa', accentTo: '#2563eb', loginMark: '#3b82f6', icon: { from: '#3b82f6', to: '#1d4ed8' } },
  siteDomain: '', // storefront domain — set once confirmed
  dashboardUrl: 'https://skimpies-dashboard.vercel.app',
  storagePrefix: 'skimpies',
  legalEntity: 'Skimpies',
  brand: {
    // Placeholder until the brand brief lands; the AI Insights page's brand
    // brief (KV) overrides the prompt defaults without a code change.
    description: 'Skimpies is a DTC eCommerce brand selling on Shopify.',
    founder: null,
    aov: null,
    contentAngles: 'product styling, customer reviews and UGC, behind-the-scenes',
  },
  shopify: { defaultDomain: '63674c.myshopify.com' }, // Dev Dashboard app "A6 Dashboard - Skimpies" (Oct 2026)
  ads: {
    platforms: ['meta', 'google'],
    metaAccountNameMatch: 'skimpies',
    metaAccountNameMode: 'contains',
    metaAccountIdDefault: '551437367250692', // "Skimpies's ad account", via Area 6's A6-dashboard system user (Oct 2026)
  },
  finance: { qbAccountMatch: 'skimpies', grossMarginPct: null, expensesSheet: null },
  revenue: { includeReturnFees: false },
  windsor: {
    accounts: {
      // null = not connected yet: the REST call is skipped. Set the ids from
      // Skimpies' Windsor → BigQuery tasks (select_accounts=) as they're added,
      // or override per source with WINDSOR_ACCOUNT_<SOURCE> env vars.
      facebook: null,
      shopify: null,
      google_ads: null,
      tiktok: null,
      snapchat: null,
      pinterest: null,
      quickbooks: null,
      pinterest_organic: null,
      instagram: '17841454886028910', // Instagram Insights (Oct 2026) — the only Windsor source Skimpies uses
      google_analytics: null,
    },
  },
  // No targets agreed yet — the Goals tab asks for the annual target; the
  // MER/ROAS/CAC bars start from agency defaults until the plan lands.
  goals: { defaultAnnualTarget: 0, targetMer: 3, targetRoas: 3, targetCac: 50 },
  inventory: { mode: 'standard' },
  creatives: { founderTrack: null, driveFolders: [] },
  alerts: { fromName: 'Skimpies Dashboard' },
  analyst: { name: 'Cleo' },
  seedsEnabled: false,
  // Shopify and Meta are connected directly; Windsor only serves Instagram.
  directData: true,
  // Marketplace orders synced into Shopify (Oct 2026 sales-channel check: in
  // 30 days Amazon brought 531 orders, every one a "new customer" because
  // Amazon hides the buyer, and TikTok Shop 102 new customers). Excluded from
  // the store's sales / CAC / AOV / customers (each gets its own tab), but
  // counted in MER: Meta ads drive Amazon sales, and TikTok Shop is organic. Fees and
  // commissions aren't in Shopify — fill commissionPct once known.
  marketplaces: [
    { key: 'amazon', label: 'Amazon', shopifyChannel: 'Amazon Channel - CED', sourceMatch: 'amazon', commissionPct: null, returnFee: null, returnWindowDays: 30, countInMer: true, countInSales: true, icon: '/brands/amazon.svg',
      description: 'Amazon orders synced into Shopify by CedCommerce · Shopify sales channel "Amazon Channel - CED" · Amazon fees are not in Shopify' },
    { key: 'tiktok-shop', label: 'TikTok Shop', shopifyChannel: 'TikTok', sourceMatch: 'tiktok', commissionPct: null, returnFee: null, returnWindowDays: 30, countInMer: true, countInSales: true, icon: '/brands/tiktok.svg',
      description: 'TikTok Shop orders · Shopify sales channel "TikTok" · TikTok Shop fees are not in Shopify' },
  ],
  // Loop renewals arrive in Shopify as the "Loop Subscriptions" channel.
  subscriptions: { provider: 'loop', shopifyChannel: 'Loop Subscriptions' },
  // Owner, operator and team (Oct 2026).
  startingAdmins: ['bettebentley@me.com', 'rebeccaneises@gmail.com', 'briansantamaria@gmail.com'],
};

export const CLIENTS: Record<ClientId, ClientProfile> = { rocknot: ROCKNOT, kaileep: KAILEEP, skimpies: SKIMPIES };

function isClientId(v: string): v is ClientId {
  return v === 'rocknot' || v === 'kaileep' || v === 'skimpies';
}

let warnedUnset = false;

export function getClientId(): ClientId {
  const explicit = (process.env.CLIENT || process.env.NEXT_PUBLIC_CLIENT || '').trim().toLowerCase();
  if (isClientId(explicit)) return explicit;

  // Safety net for the original Rocknot deployment: any Rocknot-specific
  // credential in the environment locks the profile to Rocknot, so a missing
  // CLIENT var can never re-brand Rocknot's dashboard as another client.
  const ds = (process.env.BQ_DATASET || '').trim().toLowerCase();
  const shop = (process.env.SHOPIFY_STORE_DOMAIN || '').trim().toLowerCase();
  const metaId = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');
  const looksRocknot = ds.includes('rocknot') || shop.includes('rocknot')
    || (metaId && metaId === ROCKNOT.ads.metaAccountIdDefault) || Boolean((process.env.SNAP_AD_ACCOUNT_ID || '').trim());
  if (looksRocknot) return 'rocknot';
  if (ds.includes('kailee') || shop.includes('kailee')) return 'kaileep';
  if (ds.includes('skimpies') || shop.includes('skimpies')) return 'skimpies';

  if (!warnedUnset && typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    warnedUnset = true;
    console.warn('[client] CLIENT env var is not set — defaulting to the kaileep profile. Set CLIENT explicitly on every deployment.');
  }
  return 'kaileep';
}

export function getClient(): ClientProfile {
  return CLIENTS[getClientId()];
}

// ── Convenience helpers used by the data layer ──────────────────────────────

export function clientPlatforms(profile: ClientProfile = getClient()): PlatformDef[] {
  return profile.ads.platforms.map(k => PLATFORMS[k]);
}

/**
 * Whether sales and ad numbers come straight from Shopify and the ad platforms
 * (no Windsor): set on the profile, or implied when the deployment has no
 * Windsor key at all.
 */
export function usesDirectData(profile: ClientProfile = getClient()): boolean {
  return Boolean(profile.directData) || !(process.env.WINDSOR_API_KEY || '').trim();
}

export function hasPlatform(key: PlatformKey, profile: ClientProfile = getClient()): boolean {
  return profile.ads.platforms.includes(key);
}

/** Shopify store domain: env first, then the profile's default. */
export function shopifyDomain(profile: ClientProfile = getClient()): string {
  return (process.env.SHOPIFY_STORE_DOMAIN || profile.shopify.defaultDomain).trim();
}

/** Bare numeric Meta ad account id ('' when unknown). */
export function metaAccountId(profile: ClientProfile = getClient()): string {
  return (process.env.META_AD_ACCOUNT_ID || profile.ads.metaAccountIdDefault).trim().replace('act_', '');
}

/** Lower-cased substring the Meta account name must contain ('' = no filter). */
export function metaAccountNameMatch(profile: ClientProfile = getClient()): string {
  return (process.env.META_ACCOUNT_NAME || profile.ads.metaAccountNameMatch).trim().toLowerCase();
}

/**
 * SQL fragment (starting with AND) that keeps only this client's Meta rows in
 * the shared facebook_ads table. Interpolated as a literal — the value comes
 * from code/env, never from a request.
 */
export function metaAccountSql(profile: ClientProfile = getClient()): string {
  const m = metaAccountNameMatch(profile).replace(/[^a-z0-9 _.-]/g, '');
  if (!m) return '';
  return profile.ads.metaAccountNameMode === 'exact'
    ? ` AND LOWER(account_name) = '${m}'`
    : ` AND LOWER(account_name) LIKE '%${m}%'`;
}

/**
 * Keep only this client's rows from Windsor's multi-client facebook feed:
 * by account_id when configured, otherwise by account_name substring, else all.
 */
export function keepClientMetaRows<T extends object>(rows: T[], profile: ClientProfile = getClient()): T[] {
  const field = (r: T, k: string) => (r as Record<string, unknown>)[k];
  const id = metaAccountId(profile);
  if (id) return rows.filter(r => String(field(r, 'account_id') ?? '').replace('act_', '') === id);
  const name = metaAccountNameMatch(profile);
  if (name) return rows.filter(r => {
    const n = String(field(r, 'account_name') ?? '').toLowerCase();
    return !n || n.includes(name);
  });
  return rows;
}

/**
 * Windsor REST scoping for a source: the `select_accounts` value to send, ''
 * for an unscoped call, or null when this client has no such account (skip).
 * Windsor endpoint aliases (tiktok_ads → tiktok, all → shopify) are normalised.
 */
export function windsorAccount(source: string, profile: ClientProfile = getClient()): string | null {
  const key = (source === 'tiktok_ads' ? 'tiktok' : source === 'all' ? 'shopify' : source) as WindsorSource;
  const env = process.env[`WINDSOR_ACCOUNT_${key.toUpperCase()}`];
  if (env !== undefined && env.trim() !== '') return env.trim();
  const v = profile.windsor.accounts[key];
  return v === undefined ? '' : v;
}

/**
 * Query params for a Windsor REST call scoped to this client, or null when
 * the call must be skipped because the client has no account of that type.
 */
export function windsorParams(source: string, params: Record<string, string>, profile: ClientProfile = getClient()): Record<string, string> | null {
  const acct = windsorAccount(source, profile);
  if (acct === null) return null;
  const out: Record<string, string> = acct ? { ...params, select_accounts: acct } : { ...params };
  // Pinterest: Windsor applies the attribution window / report time through
  // its `options` parameter (the same one the BigQuery task's URL carries),
  // so every live call reports on the profile's conversion settings —
  // identical to the synced table and to Ads Manager.
  const opts = windsorPinterestOptions(profile);
  if (source === 'pinterest' && opts && !out.options) out.options = opts;
  return out;
}

/**
 * Windsor's `options` JSON for Pinterest, built from the profile's conversion
 * settings: {"pinterest":{"attribution_window":"7/7/1","conversion_report_time":"TIME_OF_AD_ACTION"}}.
 * '' when the profile sets none (Windsor then defaults to 30/30/1).
 */
export function windsorPinterestOptions(profile: ClientProfile = getClient()): string {
  const a = profile.ads.pinterestAttribution;
  if (!a) return '';
  return JSON.stringify({
    pinterest: {
      attribution_window: `${a.clickWindowDays}/${a.engagementWindowDays}/${a.viewWindowDays}`,
      conversion_report_time: a.conversionReportTime,
    },
  });
}

/** Case-insensitive QuickBooks entity matcher (null = keep every account). */
/** Whether Shopify return fees count toward net sales for MER (see ClientProfile.revenue). */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthsLabel(months: number[]): string {
  const m = [...months].sort((a, b) => a - b);
  if (!m.length) return '';
  const contiguous = m.every((v, i) => i === 0 || v === m[i - 1] + 1);
  return contiguous && m.length > 1 ? `${MONTH_ABBR[m[0] - 1]}–${MONTH_ABBR[m[m.length - 1] - 1]}` : m.map(v => MONTH_ABBR[v - 1]).join(', ');
}

/**
 * The targets in force for a date (default: today, store time). A season
 * whose months include that date's month overrides the base goals; fields
 * the season leaves unset fall back to the base goals.
 */
export function effectiveGoals(profile: ClientProfile = getClient(), dateStr?: string): EffectiveGoals {
  const d = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const month = Number(d.slice(5, 7)) || new Date().getMonth() + 1;
  const g = profile.goals;
  const s = (g.seasons || []).find(x => x.months.includes(month)) || null;
  const p = (g.plan || []).find(x => x.month === d.slice(0, 7)) || null;
  return {
    targetMer: s?.targetMer ?? g.targetMer,
    merFloor: s?.merFloor ?? null,
    targetFullyLoadedMer: s?.targetFullyLoadedMer ?? g.targetFullyLoadedMer ?? null,
    fullyLoadedFloor: s?.fullyLoadedFloor ?? null,
    targetCac: s?.targetCac ?? g.targetCac,
    cacCeiling: s?.cacCeiling ?? null,
    contributionFloorPct: g.contributionFloorPct ?? null,
    targetRoas: g.targetRoas,
    merLabel: s?.merLabel ?? `${s?.targetMer ?? g.targetMer}x`,
    fullyLoadedLabel: s?.fullyLoadedLabel ?? ((s?.targetFullyLoadedMer ?? g.targetFullyLoadedMer) != null ? `${s?.targetFullyLoadedMer ?? g.targetFullyLoadedMer}x` : null),
    cacLabel: s?.cacLabel ?? `$${s?.targetCac ?? g.targetCac}`,
    season: s ? { name: s.name, months: monthsLabel(s.months), posture: s.posture } : null,
    targetFullyLoadedCac: p?.targetFullyLoadedCac ?? s?.targetFullyLoadedCac ?? null,
    fullyLoadedCacCeiling: p?.fullyLoadedCacCeiling ?? s?.fullyLoadedCacCeiling ?? null,
    monthPlan: p,
  };
}

export function includeReturnFees(profile: ClientProfile = getClient()): boolean {
  return profile.revenue.includeReturnFees;
}
/** The sales basis for the Overview's MER numerators (see ClientProfile.revenue.merBasis). */
export function merBasis(profile: ClientProfile = getClient()): 'net' | 'gross_less_discounts' {
  return profile.revenue.merBasis ?? 'net';
}

/** Product lines for this client ([] when the brand reports as one line). */
export function productLines(profile: ClientProfile = getClient()): ProductLine[] {
  return profile.lines ?? [];
}

/** Marketplace channels with their own tab ([] for a store-only brand). */
export function marketplaces(profile: ClientProfile = getClient()): MarketplaceChannel[] {
  return profile.marketplaces ?? [];
}
/**
 * ShopifyQL WHERE clause that keeps STORE sales only — marketplace channels
 * (e.g. Nordstrom dropship) are excluded from every Overview / product /
 * customer / returns figure, because ads and email drive the store, not the
 * marketplace. '' when the client has no marketplace channels (Rocknot).
 */
export function storeOnlyWhere(profile: ClientProfile = getClient()): string {
  const list = marketplaces(profile);
  if (!list.length) return '';
  return 'WHERE ' + list.map(m => `sales_channel != '${m.shopifyChannel.replace(/'/g, "\\'")}'`).join(' AND ');
}
/**
 * ShopifyQL WHERE clause for the Overview's sales, orders and AOV: like
 * storeOnlyWhere, but keeps marketplace channels flagged countInSales.
 */
export function salesWhere(profile: ClientProfile = getClient()): string {
  const list = marketplaces(profile).filter(m => !m.countInSales);
  if (!list.length) return '';
  return 'WHERE ' + list.map(m => `sales_channel != '${m.shopifyChannel.replace(/'/g, "\\'")}'`).join(' AND ');
}
/**
 * BigQuery predicate (no leading AND) that drops marketplace-channel rows from
 * the Windsor `shopify_orders` table, using its `order_source_name` column.
 * '' when the client has no marketplaces. Callers must first confirm the
 * column exists (older syncs predate it) — see shopifyOrdersFilter() in bigquery.ts.
 */
export function marketplaceExclusionPredicate(profile: ClientProfile = getClient()): string {
  const list = marketplaces(profile);
  if (!list.length) return '';
  const rx = list.map(m => m.sourceMatch.replace(/[^a-z0-9_|.-]/gi, '')).filter(Boolean).join('|');
  if (!rx) return '';
  return `NOT REGEXP_CONTAINS(LOWER(IFNULL(CAST(order_source_name AS STRING), '')), r'${rx}')`;
}
export function marketplaceByKey(key: string, profile: ClientProfile = getClient()): MarketplaceChannel | null {
  return marketplaces(profile).find(m => m.key === key) ?? null;
}

/** Which line a Shopify product_type (or title) belongs to. */
export function lineForProduct(productType: string, lines: ProductLine[] = productLines()): ProductLine | null {
  const t = (productType || '').toLowerCase();
  for (const l of lines) {
    if (l.isDefault || !l.productMatch) continue;
    if (new RegExp(l.productMatch, 'i').test(t)) return l;
  }
  return lines.find(l => l.isDefault) ?? null;
}

export function qbAccountRegex(profile: ClientProfile = getClient()): RegExp | null {
  return profile.finance.qbAccountMatch ? new RegExp(profile.finance.qbAccountMatch, 'i') : null;
}
