// Traffic tab data: where site sessions come from, straight from Shopify's
// sessions report (ShopifyQL). Every number here is what Shopify Analytics
// itself shows under Sessions by referrer / UTM / landing page — no modelling.
//
// The organic-post half of the tab (Instagram / Pinterest / TikTok post
// performance) is not in here yet: it needs the Windsor organic tables.
import { shopifyDomain, hasPlatform, metaAccountSql, getClient } from '@/src/lib/client';
import { runQuery, getDataset } from '@/src/lib/bigquery';

const SHOPIFY_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const SHOPIFY_DOMAIN = shopifyDomain();

type Row = Record<string, string>;

export function trafficConfigured(): boolean {
  return Boolean(SHOPIFY_TOKEN && SHOPIFY_DOMAIN);
}

async function shopifyql(ql: string, timeoutMs = 20000): Promise<Row[]> {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { tableData { rows columns { name } } parseErrors } }`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  const topErrors = (json?.errors as Array<{ message?: string }> | undefined) || [];
  if (topErrors.length) throw new Error(topErrors.map(e => e.message).join('; ') || 'Shopify GraphQL error');
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  return rows.map(r => {
    if (!Array.isArray(r)) return r;
    const o: Row = {};
    cols.forEach((c, i) => { o[c.name] = r[i] ?? ''; });
    return o;
  });
}

const num = (v: string | undefined) => { const n = parseFloat(v || '0'); return Number.isFinite(n) ? n : 0; };

// ── Channel classification ────────────────────────────────────────────────
// Shopify tags each session with a referrer_source (direct / social / search /
// email / paid / unknown), a referrer_name (facebook, google, chatgpt …) and
// whatever utm_medium the link carried. Combining the three gives the
// channel groups below. Paid is decided by the UTM medium the ad carried, so
// an Instagram ad click (referrer social, medium cpm_Instagram_Feed) lands in
// Paid Social and a plain tap from a post lands in Organic Social.
export const CHANNELS = [
  'Paid Social', 'Organic Social', 'Paid Search', 'Organic Search', 'Google Shopping',
  'Email & SMS', 'AI Assistants', 'Referral', 'Direct', 'Other Tagged',
] as const;
export type Channel = typeof CHANNELS[number];

const AI_REFERRERS = ['chatgpt', 'openai', 'perplexity', 'gemini', 'copilot', 'claude', 'anthropic', 'bard', 'you.com', 'phind', 'mistral', 'meta ai', 'grok'];
const SEARCH_ENGINES = ['google', 'bing', 'yahoo!', 'yahoo', 'duckduckgo', 'ecosia', 'brave', 'baidu', 'yandex'];

export function isPaidMedium(medium: string): boolean {
  const m = medium.toLowerCase();
  if (!m) return false;
  return /^(paid|cpc|cpm|ppc|cpv|cpa|display|paid_social|paidsocial|paid-social|social_paid|retargeting|prospecting)/.test(m)
    || m.startsWith('cpm_') || m.includes('paid') || m.includes('_ads') || m === 'ads' || m === 'ad'
    // Ad links whose template put the campaign name in utm_medium
    // (e.g. Rocknot's "CM_BGS_…_Campaign", "…_Retargeting_ABO").
    || /campaign|adset|_abo|_cbo|\btof\b|\bmof\b|\bbof\b/.test(m);
}

export function isAiReferrer(name: string): boolean {
  const n = name.toLowerCase();
  return AI_REFERRERS.some(a => n === a || n.startsWith(a + '.') || n.includes(a));
}

export function channelOf(source: string, name: string, medium: string): Channel {
  const s = source.toLowerCase(); const n = name.toLowerCase(); const m = medium.toLowerCase();
  if (n && isAiReferrer(n)) return 'AI Assistants';
  if (m === 'email' || m === 'sms' || m.includes('klaviyo') || m === 'newsletter' || s === 'email') return 'Email & SMS';
  if (m === 'product_sync' || m === 'shopping') return 'Google Shopping';
  if (isPaidMedium(m) || s === 'paid') {
    return (s === 'search' || s === 'paid' || SEARCH_ENGINES.includes(n)) ? 'Paid Search' : 'Paid Social';
  }
  if (s === 'social') return 'Organic Social';
  if (s === 'search') return 'Organic Search';
  if (m) return 'Other Tagged';
  if (s === 'direct' || s === '') return 'Direct';
  return 'Referral';
}

// ── Result shapes ─────────────────────────────────────────────────────────
export interface Totals { sessions: number; visitors: number; addedToCart: number; reachedCheckout: number; completed: number }
export interface ChannelRow { channel: Channel; sessions: number; completed: number; priorSessions?: number; topSources: string[] }
export interface SourceRow { source: string; name: string; medium: string; sessions: number; cartAdds: number; completed: number }
export interface CampaignRow {
  medium: string; campaign: string; content: string; sessions: number; completed: number;
  /** Resolved from the ad platform when utm_content / utm_campaign carry IDs. */
  adName?: string; campaignName?: string; platform?: string; spend?: number;
}
export interface ReferrerRow { url: string; sessions: number; completed: number }
export interface AiRow { assistant: string; landingPage: string; sessions: number; completed: number }
export interface LandingRow { path: string; sessions: number; cartAdds: number; completed: number }
export interface OrderSourceRow { source: string; name: string; orders: number; netSales: number }
export interface DayRow { date: string; sessions: number; completed: number }
export interface TrafficData {
  range: { from: string; to: string };
  totals: Totals;
  daily: DayRow[];
  channels: ChannelRow[];
  sources: SourceRow[];
  ads: CampaignRow[];
  organicPosts: CampaignRow[];
  otherTagged: CampaignRow[];
  referrers: ReferrerRow[];
  ai: { assistants: { assistant: string; sessions: number; completed: number }[]; pages: AiRow[] };
  blog: LandingRow[];
  landingPages: LandingRow[];
  orderSources: OrderSourceRow[];
  devices: { device: string; sessions: number; cartAdds: number; completed: number }[];
  countries: { country: string; sessions: number; cartAdds: number; completed: number }[];
  /** Suspected bot / low-intent traffic, separated out so the human numbers can be read on their own. */
  quality: TrafficQuality;
  prior?: { range: { from: string; to: string }; totals: Totals } | null;
  errors: string[];
}

export interface QualityFlag { kind: 'source' | 'country' | 'device' | 'landing'; label: string; sessions: number; reason: string }
export interface TrafficQuality {
  /** Sessions Shopify counted that show no human behaviour at all (see reasons). */
  suspectedBot: number;
  /** Sessions after removing the suspected-bot rows. */
  humanSessions: number;
  humanCompleted: number;
  flags: QualityFlag[];
}

// ── Ad-name lookup (Meta / TikTok ad IDs → names + spend) ────────────────
interface AdLookup { byId: Record<string, { name: string; campaign: string; platform: string; spend: number }>; byName: Record<string, { name: string; campaign: string; platform: string; spend: number }> }

async function fetchAdLookup(from: string, to: string): Promise<AdLookup> {
  const out: AdLookup = { byId: {}, byName: {} };
  if (!process.env.BQ_DATASET || !process.env.GCP_PROJECT_ID) return out;
  const ds = getDataset();
  const tables: Array<{ table: string; platform: string; where: string }> = [];
  if (hasPlatform('meta')) tables.push({ table: 'facebook_ads', platform: 'Meta', where: metaAccountSql() });
  if (hasPlatform('tiktok')) tables.push({ table: 'tiktok_ads', platform: 'TikTok', where: '' });
  if (hasPlatform('pinterest')) tables.push({ table: 'pinterest_ads', platform: 'Pinterest', where: '' });
  await Promise.all(tables.map(async t => {
    try {
      const rows = await runQuery<{ ad_id: string; ad_name: string; campaign: string; spend: number }>(
        `SELECT CAST(ad_id AS STRING) AS ad_id, ANY_VALUE(ad_name) AS ad_name, ANY_VALUE(campaign) AS campaign, SUM(CAST(spend AS FLOAT64)) AS spend
         FROM \`${ds}.${t.table}\` WHERE DATE(date) BETWEEN @date_from AND @date_to${t.where}
         GROUP BY ad_id`,
        { date_from: from, date_to: to },
      );
      for (const r of rows) {
        const rec = { name: String(r.ad_name || ''), campaign: String(r.campaign || ''), platform: t.platform, spend: Number(r.spend) || 0 };
        if (r.ad_id) out.byId[String(r.ad_id)] = rec;
        if (rec.name) {
          const k = rec.name.toLowerCase();
          out.byName[k] = out.byName[k] ? { ...out.byName[k], spend: out.byName[k].spend + rec.spend } : rec;
        }
      }
    } catch { /* table missing or column names differ — ads just show their raw UTM values */ }
  }));
  return out;
}

// ── Main fetch ────────────────────────────────────────────────────────────
export async function fetchTraffic(from: string, to: string, prior?: { from: string; to: string } | null): Promise<TrafficData> {
  const errors: string[] = [];
  const range = `SINCE ${from} UNTIL ${to}`;
  const q = async <T,>(label: string, ql: string, map: (rows: Row[]) => T, empty: T): Promise<T> => {
    try { return map(await shopifyql(ql)); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return empty; }
  };
  const totalsOf = (rows: Row[]): Totals => ({
    sessions: num(rows[0]?.sessions), visitors: num(rows[0]?.online_store_visitors),
    addedToCart: num(rows[0]?.sessions_with_cart_additions), reachedCheckout: num(rows[0]?.sessions_that_reached_checkout),
    completed: num(rows[0]?.sessions_that_completed_checkout),
  });
  const TOTALS_QL = 'FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';
  const SOURCES_QL = 'FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY referrer_source, referrer_name, utm_medium';
  const aiWhere = `WHERE ${['chatgpt', 'openai', 'perplexity', 'gemini', 'copilot', 'claude', 'grok'].map(a => `referrer_name = '${a}'`).join(' OR ')}`;

  const [totals, daily, sources, campaigns, referrers, aiPages, landing, orderSources, devices, countries, priorTotals, priorSources, adLookup] = await Promise.all([
    q('totals', `${TOTALS_QL} ${range}`, totalsOf, { sessions: 0, visitors: 0, addedToCart: 0, reachedCheckout: 0, completed: 0 }),
    q('daily', `FROM sessions SHOW sessions, sessions_that_completed_checkout TIMESERIES day ${range}`, rows => rows.map(r => {
      const dateKey = Object.keys(r).find(k => !['sessions', 'sessions_that_completed_checkout'].includes(k)) || 'day';
      return { date: String(r[dateKey] || '').slice(0, 10), sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout) };
    }), [] as DayRow[]),
    q('sources', `${SOURCES_QL} ${range} ORDER BY sessions DESC LIMIT 400`, rows => rows.map(r => ({
      source: r.referrer_source || '', name: r.referrer_name || '', medium: r.utm_medium || '', sessions: num(r.sessions), cartAdds: num(r.sessions_with_cart_additions), completed: num(r.sessions_that_completed_checkout),
    })), [] as SourceRow[]),
    q('campaigns', `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY utm_medium, utm_campaign, utm_content ${range} ORDER BY sessions DESC LIMIT 400`, rows => rows.map(r => ({
      medium: r.utm_medium || '', campaign: r.utm_campaign || '', content: r.utm_content || '', sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout),
    })), [] as CampaignRow[]),
    q('referrers', `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY referrer_url ${range} ORDER BY sessions DESC LIMIT 300`, rows => rows.map(r => ({
      url: r.referrer_url || '', sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout),
    })), [] as ReferrerRow[]),
    q('ai', `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY referrer_name, landing_page_path ${aiWhere} ${range} ORDER BY sessions DESC LIMIT 100`, rows => rows.map(r => ({
      assistant: r.referrer_name || '', landingPage: r.landing_page_path || '/', sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout),
    })), [] as AiRow[]),
    q('landing', `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY landing_page_path ${range} ORDER BY sessions DESC LIMIT 500`, rows => rows.map(r => ({
      path: r.landing_page_path || '/', sessions: num(r.sessions), cartAdds: num(r.sessions_with_cart_additions), completed: num(r.sessions_that_completed_checkout),
    })), [] as LandingRow[]),
    q('orders', `FROM sales SHOW orders, net_sales GROUP BY order_referrer_source, order_referrer_name ${range} ORDER BY orders DESC LIMIT 40`, rows => rows.map(r => ({
      source: r.order_referrer_source || '', name: r.order_referrer_name || '', orders: num(r.orders), netSales: num(r.net_sales),
    })), [] as OrderSourceRow[]),
    q('devices', `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY session_device_type ${range} ORDER BY sessions DESC LIMIT 6`, rows => rows.map(r => ({ device: r.session_device_type || 'Unknown', sessions: num(r.sessions), cartAdds: num(r.sessions_with_cart_additions), completed: num(r.sessions_that_completed_checkout) })), [] as TrafficData['devices']),
    q('countries', `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY session_country ${range} ORDER BY sessions DESC LIMIT 40`, rows => rows.map(r => ({ country: r.session_country || 'Unknown', sessions: num(r.sessions), cartAdds: num(r.sessions_with_cart_additions), completed: num(r.sessions_that_completed_checkout) })), [] as TrafficData['countries']),
    prior ? q('prior totals', `${TOTALS_QL} SINCE ${prior.from} UNTIL ${prior.to}`, totalsOf, null as Totals | null) : Promise.resolve(null),
    prior ? q('prior sources', `${SOURCES_QL} SINCE ${prior.from} UNTIL ${prior.to} ORDER BY sessions DESC LIMIT 400`, rows => rows.map(r => ({
      source: r.referrer_source || '', name: r.referrer_name || '', medium: r.utm_medium || '', sessions: num(r.sessions), cartAdds: num(r.sessions_with_cart_additions), completed: num(r.sessions_that_completed_checkout),
    })), [] as SourceRow[]) : Promise.resolve([] as SourceRow[]),
    fetchAdLookup(from, to),
  ]);

  // Channels: roll the (source, name, medium) rows up into channel groups.
  const chanMap = new Map<Channel, ChannelRow & { srcCount: Record<string, number> }>();
  for (const s of sources) {
    const ch = channelOf(s.source, s.name, s.medium);
    const row = chanMap.get(ch) || { channel: ch, sessions: 0, completed: 0, topSources: [], srcCount: {} };
    row.sessions += s.sessions; row.completed += s.completed;
    const label = s.name || (s.medium ? `utm ${s.medium}` : s.source || 'direct');
    row.srcCount[label] = (row.srcCount[label] || 0) + s.sessions;
    chanMap.set(ch, row);
  }
  for (const s of priorSources) {
    const ch = channelOf(s.source, s.name, s.medium);
    const row = chanMap.get(ch) || { channel: ch, sessions: 0, completed: 0, topSources: [], srcCount: {} };
    row.priorSessions = (row.priorSessions || 0) + s.sessions;
    chanMap.set(ch, row);
  }
  const channels: ChannelRow[] = Array.from(chanMap.values())
    .map(({ srcCount, ...r }) => ({ ...r, topSources: Object.entries(srcCount).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([k]) => k) }))
    .sort((a, b) => b.sessions - a.sessions);

  // Ads vs organic posts vs everything else that carried a UTM.
  const isEmailMedium = (m: string) => ['email', 'sms', 'newsletter'].includes(m.toLowerCase()) || m.toLowerCase().includes('klaviyo');
  const resolve = (r: CampaignRow): CampaignRow => {
    const byId = adLookup.byId[r.content] || adLookup.byId[r.campaign];
    const byName = adLookup.byName[r.content.toLowerCase()];
    const hit = byId || byName;
    if (!hit) return r;
    return { ...r, adName: hit.name || undefined, campaignName: hit.campaign || undefined, platform: hit.platform, spend: hit.spend };
  };
  const tagged = campaigns.filter(c => c.campaign || c.content);
  const ads = tagged.filter(c => isPaidMedium(c.medium) || /^\d{10,}$/.test(c.content) || /^\d{10,}$/.test(c.campaign)).map(resolve);
  const organicPosts = tagged.filter(c => !ads.includes(c) && !isEmailMedium(c.medium) && c.medium.toLowerCase() !== 'product_sync');
  const otherTagged = tagged.filter(c => !ads.includes(c) && !organicPosts.includes(c) && !isEmailMedium(c.medium));

  // Referring websites: drop our own domain, social/search/email/AI hosts.
  const own = [SHOPIFY_DOMAIN, getClient().siteDomain].map(d => d.toLowerCase().replace(/^www\./, ''));
  const notWebsite = ['facebook.', 'instagram.', 'tiktok.', 'pinterest.', 'snapchat.', 'youtube.', 'twitter.', 'x.com', 't.co', 'linkedin.', 'threads.', 'reddit.',
    'google.', 'googlequicksearchbox', 'bing.', 'yahoo.', 'duckduckgo.', 'ecosia.', 'syndicatedsearch', 'mail.', 'gmail', 'outlook.', 'klaviyo', 'shopify.com', 'shop.app', 'shopifypreview',
    ...AI_REFERRERS];
  const referrerRows = referrers.filter(r => {
    const u = r.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!u) return false;
    const host = u.split('/')[0];
    if (own.some(d => d && host.endsWith(d))) return false;
    if (host.endsWith('.myshopify.com')) return false;
    return !notWebsite.some(n => host.includes(n));
  });

  // AI assistants, rolled up per assistant and by landing page.
  const aiAgg = new Map<string, { sessions: number; completed: number }>();
  for (const r of aiPages) { const a = aiAgg.get(r.assistant) || { sessions: 0, completed: 0 }; a.sessions += r.sessions; a.completed += r.completed; aiAgg.set(r.assistant, a); }
  const assistants = Array.from(aiAgg.entries()).map(([assistant, v]) => ({ assistant, ...v })).sort((a, b) => b.sessions - a.sessions);

  const blog = landing.filter(l => /^\/blogs\//.test(l.path));

  // ── Bot / low-intent separation ──
  // Shopify already drops the crawlers it recognises before counting a session,
  // and ShopifyQL has no bot flag, so what is left is judged by behaviour: a
  // source that sends a meaningful volume of sessions in which nobody ever
  // adds to cart or checks out is not shopping. Each flagged row explains why.
  const MIN = 40;
  const flags: QualityFlag[] = [];
  let suspectedBot = 0;
  for (const s of sources) {
    if (s.sessions >= MIN && s.cartAdds === 0 && s.completed === 0) {
      const label = [s.source || 'direct', s.name, s.medium ? `utm ${s.medium}` : ''].filter(Boolean).join(' · ');
      flags.push({ kind: 'source', label, sessions: s.sessions, reason: `${s.sessions} sessions, nobody added to cart` });
      suspectedBot += s.sessions;
    }
  }
  const crawlerPath = /\.(json|xml|txt)$|^\/sitemap|^\/cart|^\/account|^\/apps\/|^\/wpm@|^\/\.well-known|^\/admin|^\/checkouts?\/|^\/collections\/all\?|\?page=\d{2,}/i;
  for (const l of landing) {
    if (l.sessions >= MIN && (crawlerPath.test(l.path) || (l.cartAdds === 0 && l.completed === 0 && l.sessions >= MIN * 2))) {
      flags.push({ kind: 'landing', label: l.path, sessions: l.sessions, reason: crawlerPath.test(l.path) ? 'crawler-style entry page' : `${l.sessions} sessions, nobody added to cart` });
    }
  }
  for (const d of devices) {
    if (d.sessions >= MIN && d.cartAdds === 0 && d.completed === 0) {
      flags.push({ kind: 'device', label: d.device, sessions: d.sessions, reason: 'device type Shopify could not identify, no cart activity' });
    }
  }
  for (const c of countries) {
    if (c.sessions >= MIN * 2 && c.completed === 0 && c.cartAdds / c.sessions < 0.01) {
      flags.push({ kind: 'country', label: c.country, sessions: c.sessions, reason: `${c.sessions} sessions, under 1% added to cart, no orders` });
    }
  }
  // Landing / device / country flags overlap the source flags, so only the
  // source total is subtracted; the others are shown as evidence.
  const quality: TrafficQuality = {
    suspectedBot,
    humanSessions: Math.max(0, totals.sessions - suspectedBot),
    humanCompleted: totals.completed,
    flags: flags.sort((a, b) => b.sessions - a.sessions),
  };

  return {
    range: { from, to },
    totals, daily, channels, sources,
    ads, organicPosts, otherTagged,
    referrers: referrerRows,
    ai: { assistants, pages: aiPages },
    blog,
    landingPages: landing.filter(l => !/^\/blogs\//.test(l.path)).slice(0, 25),
    orderSources,
    devices, countries: countries.slice(0, 8),
    quality,
    prior: prior && priorTotals ? { range: prior, totals: priorTotals } : null,
    errors,
  };
}
