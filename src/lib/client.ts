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
//   1. CLIENT env var            — "rocknot" | "kaileep"
//   2. BQ_DATASET env var        — a dataset named after a known client
//   3. default                   — "kaileep"
//
// Server code calls getClient(). Client components use useClient() from
// src/components/ClientProvider.tsx (the root layout hands the profile down).
// Keep profiles JSON-serialisable: they cross the server → browser boundary.

export type ClientId = 'rocknot' | 'kaileep';

// Every ad platform the dashboard knows how to read. A client lists the ones
// it actually runs; queries and UI for the rest are skipped.
export type PlatformKey = 'meta' | 'google' | 'tiktok' | 'snapchat' | 'pinterest';

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
export type WindsorSource = 'facebook' | 'google_ads' | 'tiktok' | 'snapchat' | 'pinterest' | 'shopify' | 'quickbooks';

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
  };
  finance: {
    /** Case-insensitive regex source matched against QuickBooks account_name ('' = keep all). */
    qbAccountMatch: string;
  };
  revenue: {
    /**
     * Shopify's net sales subtracts the FULL refund on a return. A store that
     * charges a return fee keeps that fee, so it is real revenue: when true,
     * ShopifyQL `return_fees` is added back into net sales for MER/goals.
     * Only affects the ShopifyQL path (BigQuery order rows carry no fee data).
     */
    includeReturnFees: boolean;
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
  goals: {
    /** Starting annual net-sales target shown until an admin saves one (0 = ask). */
    defaultAnnualTarget: number;
    /** Net-sales MER the ad budgets are planned around. */
    targetMer: number;
    /** Per-platform ROAS the Ad Performance recommendations grade against. */
    targetRoas: number;
    /** New-customer CAC (ad spend ÷ new customers) flagged red when exceeded. */
    targetCac: number;
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
  finance: { qbAccountMatch: 'rocknot' },
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
  },
  finance: { qbAccountMatch: 'kailee' },
  revenue: { includeReturnFees: true }, // Kailee P charges a return fee and keeps it
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
  // October 2026 brief: blended MER 5–6 (5 = the pass line), Google ROAS ≥ 6x,
  // CPA target < $27–30.
  goals: { defaultAnnualTarget: 0, targetMer: 5, targetRoas: 6, targetCac: 30 },
  inventory: { mode: 'standard' },
  creatives: {
    founderTrack: { label: 'Kailee', personName: 'Kailee' },
    driveFolders: [],
  },
  alerts: { fromName: 'Kailee P Dashboard' },
  analyst: { name: 'Cleo' },
  seedsEnabled: false,
};

export const CLIENTS: Record<ClientId, ClientProfile> = { rocknot: ROCKNOT, kaileep: KAILEEP };

function isClientId(v: string): v is ClientId {
  return v === 'rocknot' || v === 'kaileep';
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
  return acct ? { ...params, select_accounts: acct } : params;
}

/** Case-insensitive QuickBooks entity matcher (null = keep every account). */
/** Whether Shopify return fees count toward net sales for MER (see ClientProfile.revenue). */
export function includeReturnFees(profile: ClientProfile = getClient()): boolean {
  return profile.revenue.includeReturnFees;
}

/** Product lines for this client ([] when the brand reports as one line). */
export function productLines(profile: ClientProfile = getClient()): ProductLine[] {
  return profile.lines ?? [];
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
