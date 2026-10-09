// Organic Content tab data: how organic Pinterest pins and Instagram posts
// are performing (Windsor's Pinterest Organic / Instagram Insights feeds,
// with the post's own image), and how blog articles perform on the site
// (Shopify sessions that started on a /blogs/ page, joined to the article's
// title and cover image from the Shopify Admin API).
import { getClient, shopifyDomain, windsorParams, windsorAccount } from '@/src/lib/client';
import { shopifyql, shopifyConfigured } from '@/src/lib/shopifyql';
import { isPaidMedium } from '@/src/lib/traffic';
import { runQuery, isBigQueryConfigured, tableExists, getDataset } from '@/src/lib/bigquery';

export type OrganicPlatform = 'Pinterest' | 'Instagram';

export interface OrganicPost {
  id: string;
  platform: OrganicPlatform;
  title: string;
  imageUrl: string;
  url: string;
  publishedAt: string;
  /** Pinterest board / Instagram media type (IMAGE, VIDEO, CAROUSEL_ALBUM, REEL). */
  group: string;
  metrics: Record<string, number>;
}

export interface BlogPost {
  path: string;
  /** article = a post; index = a blog's home page; tag = a /tagged/ listing. */
  kind: 'article' | 'index' | 'tag';
  title: string;
  imageUrl: string;
  url: string;
  publishedAt: string;
  sessions: number;
  cartAdds: number;
  completed: number;
  /** GA4 bounce rate for sessions landing on this page (0–1); null when GA4 has no row for it. */
  bounceRate: number | null;
  /** GA4 sessions behind the bounce rate (GA4 and Shopify count sessions differently). */
  gaSessions: number;
}

export interface SourceBlock<T> {
  status: 'ok' | 'not_connected' | 'error';
  error?: string;
  items: T[];
  totals: Record<string, number>;
  /** Which Windsor field set succeeded (debugging aid). */
  fieldSet?: string;
  /** Caveat shown under the block (e.g. Pinterest's 90-day analytics limit). */
  note?: string;
}

export interface SocialTraffic { sessions: number; cartAdds: number; completed: number }

export interface OrganicData {
  range: { from: string; to: string };
  pinterest: SourceBlock<OrganicPost>;
  instagram: SourceBlock<OrganicPost>;
  blog: SourceBlock<BlogPost>;
  /** Unpaid site sessions whose referrer was the platform (Shopify sessions report). */
  socialTraffic: Record<OrganicPlatform, SocialTraffic>;
  /** Followers and profile activity per platform. */
  audience: Record<OrganicPlatform, Audience>;
}

/** One day of account-level audience data (for the follower growth chart). */
export interface AudiencePoint {
  date: string;
  /** Running follower total that day (null when the feed only reports daily new followers). */
  followers: number | null;
  /** Net new followers that day (reported by the feed, or the day-over-day change in the total). */
  newFollowers: number | null;
  profileViews?: number;
  websiteClicks?: number;
  monthlyViews?: number;
}

/** Account-level audience for a platform over the range. */
export interface Audience {
  status: 'ok' | 'not_connected' | 'error';
  error?: string;
  /** Followers on the last day of the range (null when the source has no follower field). */
  followers: number | null;
  /** Followers on the first day of the range. */
  followersStart: number | null;
  /** Net new followers over the range (daily new-follower sum when the source reports it, else last − first). */
  newFollowers: number | null;
  profileViews?: number;
  websiteClicks?: number;
  /** Pinterest: accounts followed, boards, pins and the rolling 30-day "monthly views" as of the last day. */
  following?: number;
  boards?: number;
  pins?: number;
  monthlyViews?: number;
  /** Daily points over the range, oldest first (empty when the feed has no dated rows). */
  series: AudiencePoint[];
  fieldSet?: string;
  attempts?: WindsorAttempt[];
}

const WINDSOR_KEY = (process.env.WINDSOR_API_KEY || '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));

// ── Windsor ───────────────────────────────────────────────────────────────

export interface WindsorAttempt { fieldSet: string; fields: string[]; rows?: Array<Record<string, unknown>>; error?: string }

/**
 * Pull rows from a Windsor organic source, trying richer field sets first:
 * an unknown field makes Windsor reject the whole request, and its error
 * message lists the fields it does know — kept for the debug endpoint.
 */
export async function windsorOrganicRows(
  source: 'pinterest_organic' | 'instagram',
  fieldSets: Array<{ name: string; fields: string[] }>,
  from: string, to: string,
  budgetMs = source === 'pinterest_organic' ? 55000 : 30000,
): Promise<{ attempts: WindsorAttempt[]; rows: Array<Record<string, unknown>> | null; fieldSet: string | null; notConnected: boolean }> {
  const attempts: WindsorAttempt[] = [];
  if (!WINDSOR_KEY) return { attempts, rows: null, fieldSet: null, notConnected: true };
  const scoped = windsorParams(source, { date_from: from, date_to: to });
  if (!scoped) return { attempts, rows: null, fieldSet: null, notConnected: true };
  // Pinterest Organic is pulled live from Pinterest by Windsor and can be slow.
  // Each source gets a total time budget across ALL its attempts, so one slow
  // source can never take the whole Organic Content page past the server's
  // limit (which showed as "Failed to load" for everything).
  const started = Date.now();
  const remaining = () => budgetMs - (Date.now() - started);
  const perRequest = source === 'pinterest_organic' ? 40000 : 20000;
  for (const fs of fieldSets) {
    if (remaining() < 5000) { attempts.push({ fieldSet: fs.name, fields: fs.fields, error: 'skipped: time budget for this source used up' }); continue; }
    // Self-correcting: when Windsor's error names one of the requested
    // fields ("'save' [Error pulling data…]"), drop it and retry before
    // moving to the next set. Never drops `date` or the id field.
    let fields = [...fs.fields];
    for (let round = 0; round < 5 && fields.length >= 2; round++) {
      if (remaining() < 5000) break;
      const qs = new URLSearchParams({ api_key: WINDSOR_KEY, fields: fields.join(','), _renderer: 'json', ...scoped });
      let err = '';
      try {
        const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(Math.max(3000, Math.min(perRequest, remaining()))) });
        const json = await res.json();
        if (!json.error && Array.isArray(json.data)) {
          attempts.push({ fieldSet: round ? `${fs.name} (pruned ${fs.fields.length - fields.length})` : fs.name, fields, rows: json.data.slice(0, 3) });
          return { attempts, rows: json.data as Array<Record<string, unknown>>, fieldSet: fs.name, notConnected: false };
        }
        err = String(json.error || json.message || `HTTP ${res.status}`);
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      attempts.push({ fieldSet: fs.name, fields, error: err });
      const lower = err.toLowerCase();
      const bad = fields.find(f => f !== 'date' && !/_id$/.test(f) && new RegExp(`(^|[^a-z0-9_])${f}([^a-z0-9_]|$)`).test(lower));
      if (!bad) break;
      fields = fields.filter(f => f !== bad);
    }
  }
  return { attempts, rows: null, fieldSet: null, notConnected: false };
}

// Windsor field names from its Pinterest Organic / Instagram Insights field
// references. Media/identity fields first; metrics-only fallbacks after.
export const PINTEREST_ORGANIC_FIELDSETS = [
  { name: 'full', fields: ['date', 'pin_id', 'pin_title', 'pin_description', 'pin_permalink', 'pin_media_image_url', 'pin_board_name', 'pin_created_at', 'pin_impression', 'save', 'pin_click', 'pin_outbound_click'] },
  { name: 'pin_prefixed', fields: ['date', 'pin_id', 'pin_title', 'pin_description', 'pin_link', 'pin_image_url', 'pin_board_name', 'pin_created_date', 'pin_impression', 'pin_save', 'pin_pin_click', 'pin_outbound_click'] },
  { name: 'alt_names', fields: ['date', 'pin_id', 'pin_title', 'pin_description', 'pin_link', 'pin_media_image_url', 'pin_board_name', 'pin_created_at', 'impression', 'pin_save', 'pin_click', 'outbound_click'] },
  { name: 'no_media', fields: ['date', 'pin_id', 'pin_title', 'pin_permalink', 'pin_created_at', 'pin_impression', 'save', 'pin_click', 'pin_outbound_click'] },
  { name: 'minimal', fields: ['date', 'pin_id', 'pin_title', 'pin_impression', 'pin_click'] },
];
export const INSTAGRAM_FIELDSETS = [
  { name: 'full', fields: ['date', 'media_id', 'media_caption', 'media_type', 'media_url', 'media_thumbnail_url', 'media_permalink', 'timestamp', 'media_reach', 'media_impressions', 'media_like_count', 'media_comments_count', 'media_saved', 'media_shares', 'media_views'] },
  { name: 'no_views', fields: ['date', 'media_id', 'media_caption', 'media_type', 'media_url', 'media_permalink', 'timestamp', 'media_reach', 'media_like_count', 'media_comments_count', 'media_saved'] },
  { name: 'minimal', fields: ['date', 'media_id', 'media_caption', 'media_permalink', 'media_reach', 'media_like_count', 'media_comments_count'] },
];

/**
 * Roll per-day rows up to one record per post. Windsor serves some metrics
 * per day (sum them) and some as running lifetime totals repeated on every
 * day (take the latest) — detected per metric: identical on every row → lifetime.
 */
function rollUp(rows: Array<Record<string, unknown>>, idKey: string, metricKeys: string[]): Map<string, { rows: Array<Record<string, unknown>>; metrics: Record<string, number> }> {
  const byId = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const id = str(r[idKey]);
    if (!id) continue;
    const list = byId.get(id) || [];
    list.push(r);
    byId.set(id, list);
  }
  const out = new Map<string, { rows: Array<Record<string, unknown>>; metrics: Record<string, number> }>();
  Array.from(byId.entries()).forEach(([id, list]) => {
    list.sort((a, b) => str(a.date).localeCompare(str(b.date)));
    const metrics: Record<string, number> = {};
    for (const k of metricKeys) {
      const vals = list.map(r => num(r[k]));
      const distinct = new Set(vals.filter(v => v !== 0));
      const lifetime = list.length > 1 && distinct.size <= 1 && vals[vals.length - 1] !== 0;
      metrics[k] = lifetime ? vals[vals.length - 1] : vals.reduce((s, v) => s + v, 0);
    }
    out.set(id, { rows: list, metrics });
  });
  return out;
}

function sumTotals(items: OrganicPost[], keys: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const k of keys) t[k] = items.reduce((s, p) => s + (p.metrics[k] || 0), 0);
  return t;
}

export const PINTEREST_METRICS = ['impressions', 'saves', 'pinClicks', 'outboundClicks'];
export const INSTAGRAM_METRICS = ['reach', 'impressions', 'likes', 'comments', 'saves', 'shares', 'views'];

// Preferred source once a Windsor → BigQuery task exists for Pinterest Organic
// (table `pinterest_organic` in the client's dataset): instant, and no live
// pull from Pinterest on every page load. Column names vary by connector
// version, so each metric is read from whichever of its known names exists.
const PIN_TABLE_ALTS: Record<string, string[]> = {
  pin_id: ['pin_id', 'id'], pin_title: ['pin_title', 'title'], pin_description: ['pin_description', 'description'],
  pin_permalink: ['pin_link', 'pin_permalink', 'link', 'url'],
  // Windsor's task form lists "Pin image url" and "Pin media cover image url".
  pin_media_image_url: ['pin_image_url', 'pin_media_cover_image_url', 'pin_media_image_url', 'media_image_url', 'image_url'],
  pin_board_name: ['pin_board_name', 'board_name'], pin_created_at: ['pin_created_date', 'pin_created_at', 'created_at'],
  impressions: ['pin_impression', 'impression', 'impressions'], saves: ['save', 'pin_save', 'saves'],
  pinClicks: ['pin_click', 'pin_pin_click', 'pin_clicks', 'click'], outboundClicks: ['pin_outbound_click', 'outbound_click', 'outbound_clicks'],
};
export async function fetchPinterestOrganicFromTable(from: string, to: string): Promise<SourceBlock<OrganicPost> | null> {
  if (!isBigQueryConfigured() || !(await tableExists('pinterest_organic'))) return null;
  try {
    const ds = getDataset();
    const cols = await runQuery<{ column_name: string }>(`SELECT column_name FROM \`${ds}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'pinterest_organic'`);
    const have = new Set(cols.map(c => c.column_name));
    const pick = (k: string) => PIN_TABLE_ALTS[k].find(c => have.has(c)) || null;
    const id = pick('pin_id');
    if (!id || !have.has('date')) return { status: 'error', error: `pinterest_organic table lacks a pin id / date column (has: ${Array.from(have).join(', ')})`, items: [], totals: {} };
    const sel = Object.keys(PIN_TABLE_ALTS).map(k => { const c = pick(k); return c ? `CAST(${c} AS STRING) AS ${k}` : `NULL AS ${k}`; }).join(', ');
    const rows = await runQuery<Record<string, string | null>>(`SELECT CAST(date AS STRING) AS date, ${sel} FROM \`${ds}.pinterest_organic\` WHERE DATE(date) BETWEEN @from AND @to`, { from, to });
    const rolled = rollUp(rows.map(r => ({ ...r })), 'pin_id', ['impressions', 'saves', 'pinClicks', 'outboundClicks']);
    const items: OrganicPost[] = Array.from(rolled.entries()).map(([pid, v]) => {
      const last = v.rows[v.rows.length - 1];
      return {
        id: pid, platform: 'Pinterest' as const,
        title: str(last.pin_title) || str(last.pin_description).slice(0, 80) || `Pin ${pid}`,
        imageUrl: str(last.pin_media_image_url), url: str(last.pin_permalink) || `https://www.pinterest.com/pin/${pid}/`,
        publishedAt: str(last.pin_created_at).slice(0, 10), group: str(last.pin_board_name),
        metrics: { impressions: v.metrics.impressions || 0, saves: v.metrics.saves || 0, pinClicks: v.metrics.pinClicks || 0, outboundClicks: v.metrics.outboundClicks || 0 },
      };
    }).filter(p => Object.values(p.metrics).some(x => x > 0)).sort((a, b) => b.metrics.impressions - a.metrics.impressions);
    return { status: 'ok', items, totals: sumTotals(items, PINTEREST_METRICS), fieldSet: 'bigquery:pinterest_organic' };
  } catch (e) {
    return { status: 'error', error: `pinterest_organic table: ${e instanceof Error ? e.message : String(e)}`, items: [], totals: {} };
  }
}

export async function fetchPinterestOrganic(from: string, to: string): Promise<SourceBlock<OrganicPost>> {
  const fromTable = await fetchPinterestOrganicFromTable(from, to);
  if (fromTable && fromTable.status === 'ok') return fromTable;
  let r = await windsorOrganicRows('pinterest_organic', PINTEREST_ORGANIC_FIELDSETS, from, to);
  // Windsor's live Pinterest pull scales with the range; when a long range
  // times out, fall back to the last 7 days so the tab still shows pins,
  // labelled as such. The BigQuery task removes this limit entirely.
  let shortened: string | null = null;
  const timedOut = !r.rows && !r.notConnected && r.attempts.some(a => /timeout|aborted/i.test(a.error || ''));
  if (timedOut) {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    if (days > 7) {
      const shortFrom = new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10);
      const r7 = await windsorOrganicRows('pinterest_organic', PINTEREST_ORGANIC_FIELDSETS.slice(0, 2), shortFrom, to, 45000);
      if (r7.rows) { r = r7; shortened = `Pinterest's live feed timed out for the full range, so this shows the last 7 days (${shortFrom} → ${to}). A Windsor → BigQuery task for Pinterest Organic removes this limit.`; }
      else r.attempts.push(...r7.attempts.map(a => ({ ...a, fieldSet: `7d:${a.fieldSet}` })));
    }
  }
  if (r.notConnected) {
    // Windsor can't see a profile reached through Business Access; Pinterest's
    // own API can, acting through the client's ad account.
    const { fetchPinterestOrganicDirect, pinterestOrganicDirectConfigured } = await import('@/src/lib/pinterestOrganicDirect');
    if (!pinterestOrganicDirectConfigured()) return { status: 'not_connected', items: [], totals: {} };
    const d = await fetchPinterestOrganicDirect(from, to);
    if (d.error) return { status: 'error', error: d.error, items: [], totals: {} };
    return { status: 'ok', items: d.items, totals: sumTotals(d.items, PINTEREST_METRICS), fieldSet: 'pinterest_api', ...(d.note ? { note: d.note } : {}) };
  }
  if (!r.rows) return { status: 'error', error: r.attempts.map(a => `${a.fieldSet}: ${a.error}`).join(' | '), items: [], totals: {} };
  const rolled = rollUp(r.rows, 'pin_id', ['pin_impression', 'impression', 'save', 'pin_save', 'pin_click', 'pin_pin_click', 'pin_outbound_click', 'outbound_click']);
  const items: OrganicPost[] = Array.from(rolled.entries()).map(([id, v]) => {
    const last = v.rows[v.rows.length - 1];
    return {
      id, platform: 'Pinterest' as const,
      title: str(last.pin_title) || str(last.pin_description).slice(0, 80) || `Pin ${id}`,
      imageUrl: str(last.pin_media_image_url) || str(last.pin_image_url) || str(last.pin_media_cover_image_url),
      url: str(last.pin_permalink) || str(last.pin_link) || `https://www.pinterest.com/pin/${id}/`,
      publishedAt: (str(last.pin_created_at) || str(last.pin_created_date)).slice(0, 10),
      group: str(last.pin_board_name),
      metrics: { impressions: v.metrics.pin_impression || v.metrics.impression || 0, saves: v.metrics.save || v.metrics.pin_save || 0, pinClicks: v.metrics.pin_click || v.metrics.pin_pin_click || 0, outboundClicks: v.metrics.pin_outbound_click || v.metrics.outbound_click || 0 },
    };
  }).filter(p => Object.values(p.metrics).some(x => x > 0))
    .sort((a, b) => b.metrics.impressions - a.metrics.impressions);
  return { status: 'ok', items, totals: sumTotals(items, PINTEREST_METRICS), fieldSet: r.fieldSet || undefined, ...(shortened ? { note: shortened } : {}) };
}

function pickImage(type: string, mediaUrl: string, thumbUrl: string): string {
  const isVideo = /REEL|VIDEO/i.test(type) || /\.mp4(\?|$)/i.test(mediaUrl);
  if (isVideo) return thumbUrl || '';
  return mediaUrl || thumbUrl;
}

/** Always show at least this many Instagram posts: when the period holds fewer, older posts fill the grid (labelled). */
export const INSTAGRAM_MIN_POSTS = 12;

export async function fetchInstagramOrganic(from: string, to: string): Promise<SourceBlock<OrganicPost>> {
  // The period's posts, plus (in parallel, so nothing waits) the 90 days
  // before it — used only when the period has fewer than INSTAGRAM_MIN_POSTS.
  const earlierFrom = new Date(Date.parse(from) - 90 * 86400000).toISOString().slice(0, 10);
  const earlierTo = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const [r, earlier] = await Promise.all([
    windsorOrganicRows('instagram', INSTAGRAM_FIELDSETS, from, to),
    windsorOrganicRows('instagram', INSTAGRAM_FIELDSETS.slice(0, 1), earlierFrom, earlierTo, 25000).catch(() => null),
  ]);
  if (r.notConnected) return { status: 'not_connected', items: [], totals: {} };
  if (!r.rows) return { status: 'error', error: r.attempts.map(a => `${a.fieldSet}: ${a.error}`).join(' | '), items: [], totals: {} };
  const inRange = instagramItems(r.rows);
  if (inRange.length >= INSTAGRAM_MIN_POSTS || !earlier?.rows?.length) return { status: 'ok', items: inRange, totals: sumTotals(inRange, INSTAGRAM_METRICS), fieldSet: r.fieldSet || undefined };
  const seen = new Set(inRange.map(p => p.id));
  const older = instagramItems(earlier.rows).filter(p => !seen.has(p.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, INSTAGRAM_MIN_POSTS - inRange.length);
  const items = [...inRange, ...older];
  return {
    status: 'ok', items, totals: sumTotals(inRange, INSTAGRAM_METRICS), fieldSet: r.fieldSet || undefined,
    note: inRange.length === 0
      ? `No posts were published in this period; showing the ${older.length} most recent posts before it. Totals above cover the period only.`
      : `${inRange.length} post${inRange.length === 1 ? '' : 's'} published in this period; ${older.length} earlier post${older.length === 1 ? '' : 's'} added so the ${INSTAGRAM_MIN_POSTS} most recent show. Totals above cover the period only.`,
  };
}

function instagramItems(rows: Array<Record<string, unknown>>): OrganicPost[] {
  const rolled = rollUp(rows, 'media_id', ['media_reach', 'media_impressions', 'media_like_count', 'media_comments_count', 'media_saved', 'media_shares', 'media_views']);
  const items: OrganicPost[] = Array.from(rolled.entries()).map(([id, v]) => {
    const last = v.rows[v.rows.length - 1];
    const type = str(last.media_type);
    const caption = str(last.media_caption).replace(/\s+/g, ' ').trim();
    return {
      id, platform: 'Instagram' as const,
      title: caption ? (caption.length > 90 ? `${caption.slice(0, 90)}…` : caption) : `${type || 'Post'} ${id}`,
      // Reels/videos (media_type REELS / VIDEO): media_url is the .mp4 — show
      // the thumbnail instead. Carousels and images have no thumbnail field.
      imageUrl: pickImage(str(last.media_type), str(last.media_url), str(last.media_thumbnail_url)),
      url: str(last.media_permalink),
      publishedAt: str(last.timestamp).slice(0, 10),
      group: type,
      metrics: {
        reach: v.metrics.media_reach, impressions: v.metrics.media_impressions, likes: v.metrics.media_like_count,
        comments: v.metrics.media_comments_count, saves: v.metrics.media_saved, shares: v.metrics.media_shares, views: v.metrics.media_views,
      },
    };
  }).filter(p => Object.values(p.metrics).some(x => x > 0))
    .sort((a, b) => (b.metrics.reach || b.metrics.impressions) - (a.metrics.reach || a.metrics.impressions));
  return items;
}

// ── Blog ──────────────────────────────────────────────────────────────────

interface ArticleMeta { title: string; imageUrl: string; publishedAt: string; handle: string; blogHandle: string }

type ArticleNode = { title: string; handle: string; publishedAt: string | null; image: { url: string } | null; blog: { handle: string } };

/**
 * Published articles from the Shopify Admin API (needs the read_content
 * scope on the token). Returns Shopify's errors too, for the debug endpoint.
 */
export async function fetchArticlesRaw(): Promise<{ nodes: ArticleNode[]; errors: string[]; status: number | null }> {
  const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
  if (!token || !shopifyDomain()) return { nodes: [], errors: ['Shopify not configured'], status: null };
  const run = async (query: string) => {
    const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query }),
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json();
    const errors = ((json?.errors as Array<{ message?: string }> | undefined) || []).map(e => e.message || String(e));
    return { status: res.status, json, errors };
  };
  try {
    // Preferred: the top-level articles query (2024-10+).
    const a = await run(`{ articles(first: 250, sortKey: PUBLISHED_AT, reverse: true, query: "published_status:published") {
      nodes { title handle publishedAt image { url(transform: { maxWidth: 400 }) } blog { handle } } } }`);
    const nodes = (a.json?.data?.articles?.nodes || []) as ArticleNode[];
    if (nodes.length || !a.errors.length) return { nodes, errors: a.errors, status: a.status };
    // Fallback: walk blogs → articles.
    const b = await run(`{ blogs(first: 20) { nodes { handle articles(first: 250) {
      nodes { title handle publishedAt image { url(transform: { maxWidth: 400 }) } } } } } }`);
    const blogs = (b.json?.data?.blogs?.nodes || []) as Array<{ handle: string; articles: { nodes: Array<Omit<ArticleNode, 'blog'>> } }>;
    const flat: ArticleNode[] = [];
    for (const bl of blogs) for (const ar of bl.articles.nodes) flat.push({ ...ar, blog: { handle: bl.handle } });
    return { nodes: flat, errors: [...a.errors, ...b.errors], status: b.status };
  } catch (e) {
    return { nodes: [], errors: [e instanceof Error ? e.message : String(e)], status: null };
  }
}

/** Published articles keyed by /blogs/<blog>/<article> path. */
export async function fetchArticles(): Promise<Map<string, ArticleMeta>> {
  const out = new Map<string, ArticleMeta>();
  const { nodes } = await fetchArticlesRaw();
  for (const a of nodes) {
    if (!a.publishedAt) continue;
    out.set(`/blogs/${a.blog.handle}/${a.handle}`, { title: a.title, imageUrl: a.image?.url || '', publishedAt: a.publishedAt.slice(0, 10), handle: a.handle, blogHandle: a.blog.handle });
  }
  return out;
}

/**
 * Fallback when the Admin API lacks read_content: Shopify storefronts publish
 * a public Atom feed per blog (/blogs/<handle>.atom) with each article's
 * title, link, publish date and body HTML (first <img> = cover). No token.
 */
export async function fetchArticlesFromFeed(blogHandles: string[]): Promise<Map<string, ArticleMeta>> {
  const out = new Map<string, ArticleMeta>();
  const domain = getClient().siteDomain;
  const decode = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
  await Promise.all(blogHandles.map(async blog => {
    for (let page = 1; page <= 6; page++) {
      try {
        const res = await fetch(`https://${domain}/blogs/${blog}.atom?page=${page}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) break;
        const xml = await res.text();
        const entries = xml.split('<entry>').slice(1);
        if (!entries.length) break;
        for (const e of entries) {
          const title = decode((e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
          const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
          const published = ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || '').slice(0, 10);
          const content = decode((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '');
          const img = (content.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
          const m = link.match(/\/blogs\/([^/?#]+)\/([^/?#]+)/);
          if (!m) continue;
          const path = `/blogs/${m[1]}/${m[2]}`;
          if (!out.has(path)) out.set(path, { title, imageUrl: img.startsWith('//') ? `https:${img}` : img, publishedAt: published, handle: m[2], blogHandle: m[1] });
        }
        if (entries.length < 50) break;
      } catch { break; }
    }
  }));
  return out;
}

/**
 * Cover image for articles the feed couldn't give one: the article page's
 * og:image (the featured image Shopify themes put in the share tags).
 * Only for the articles actually shown; cached a day; a handful at a time.
 */
export async function fetchOgImages(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const domain = getClient().siteDomain;
  const batch = 6;
  for (let i = 0; i < paths.length; i += batch) {
    await Promise.all(paths.slice(i, i + batch).map(async path => {
      try {
        const res = await fetch(`https://${domain}${path}`, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (A6 Dashboard)' } });
        if (!res.ok) return;
        const html = (await res.text()).slice(0, 200000);
        const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
        if (m) out.set(path, m[1].startsWith('//') ? `https:${m[1]}` : m[1]);
      } catch { /* no image for this one */ }
    }));
  }
  return out;
}

export async function fetchBlogPerformance(from: string, to: string): Promise<SourceBlock<BlogPost>> {
  if (!shopifyConfigured()) return { status: 'not_connected', items: [], totals: {} };
  try {
    // Blog articles sit in the long tail of landing pages, so pull wide;
    // fall back to a smaller page if Shopify refuses the limit.
    const landingQl = (limit: number) => `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT ${limit}`;
    const [rows, adminArticles, gaLanding] = await Promise.all([
      shopifyql(landingQl(5000), { timeoutMs: 25000 }).catch(() => shopifyql(landingQl(1000), { timeoutMs: 20000 })),
      fetchArticles(),
      // Bounce rate lives in GA4 (Shopify's sessions report has none); missing GA4 just leaves the column blank.
      import('@/src/lib/ga4').then(mod => mod.fetchGaLandingEngagement(from, to)).catch(() => null),
    ]);
    // No read_content scope → public Atom feeds for the blogs visitors landed on.
    let articles = adminArticles;
    if (!articles.size) {
      const blogs = new Set<string>();
      for (const r of rows) {
        const m = str(r.landing_page_path).match(/^\/blogs\/([^/?#]+)/);
        if (m) blogs.add(m[1]);
      }
      if (blogs.size) articles = await fetchArticlesFromFeed(Array.from(blogs));
    }
    const byPath = new Map<string, BlogPost>();
    for (const r of rows) {
      const raw = str(r.landing_page_path);
      if (!/^\/blogs\//.test(raw)) continue;
      // Strip query strings / trailing slashes so one article is one row.
      const path = raw.split('?')[0].replace(/\/+$/, '');
      const parts = path.split('/').filter(Boolean); // ['blogs', blog, article?]
      const kind: BlogPost['kind'] = parts.length <= 2 ? 'index' : parts[2] === 'tagged' ? 'tag' : 'article';
      const meta = articles.get(path);
      const fallbackTitle = kind === 'index' ? `Blog home · ${parts[1] || ''}`
        : kind === 'tag' ? `Tag page · ${(parts[3] || '').replace(/-/g, ' ')}`
        : (parts[2] || '').replace(/-/g, ' ');
      const cur = byPath.get(path) || {
        path, kind,
        title: meta?.title || fallbackTitle,
        imageUrl: meta?.imageUrl || '',
        url: `https://${getClient().siteDomain}${path}`,
        publishedAt: meta?.publishedAt || '',
        sessions: 0, cartAdds: 0, completed: 0,
        bounceRate: gaLanding?.get(path)?.bounceRate ?? null, gaSessions: gaLanding?.get(path)?.sessions ?? 0,
      };
      cur.sessions += num(r.sessions); cur.cartAdds += num(r.sessions_with_cart_additions); cur.completed += num(r.sessions_that_completed_checkout);
      byPath.set(path, cur);
    }
    const items = Array.from(byPath.values()).sort((a, b) => b.sessions - a.sessions);
    const articleItems = items.filter(b => b.kind === 'article');
    // Fill missing covers from the article pages (top 30 shown articles).
    const needImg = articleItems.filter(b => !b.imageUrl).slice(0, 30).map(b => b.path);
    if (needImg.length) {
      const og = await fetchOgImages(needImg);
      for (const b of articleItems) if (!b.imageUrl && og.get(b.path)) b.imageUrl = og.get(b.path)!;
    }
    const totals: Record<string, number> = {
      sessions: items.reduce((s, b) => s + b.sessions, 0),
      cartAdds: items.reduce((s, b) => s + b.cartAdds, 0),
      completed: items.reduce((s, b) => s + b.completed, 0),
      articles: articleItems.length,
      articleSessions: articleItems.reduce((s, b) => s + b.sessions, 0),
      articlesKnown: articles.size,
    };
    // Session-weighted GA4 bounce rate across the blog pages that have one (0–100).
    const withBounce = items.filter(b => b.bounceRate != null && b.gaSessions > 0);
    const gaN = withBounce.reduce((s, b) => s + b.gaSessions, 0);
    if (gaN > 0) { totals.bounceRatePct = Math.round((withBounce.reduce((s, b) => s + b.bounceRate! * b.gaSessions, 0) / gaN) * 1000) / 10; totals.bouncePages = withBounce.length; }
    return { status: 'ok', items, totals, ...(gaLanding ? {} : { note: 'Bounce rate needs Google Analytics 4 (connected in Windsor) — GA4 returned nothing for this period.' }) };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e), items: [], totals: {} };
  }
}

// ── Unpaid site traffic from each platform ────────────────────────────────

export async function fetchSocialTraffic(from: string, to: string): Promise<Record<OrganicPlatform, SocialTraffic>> {
  const empty = (): SocialTraffic => ({ sessions: 0, cartAdds: 0, completed: 0 });
  const out: Record<OrganicPlatform, SocialTraffic> = { Pinterest: empty(), Instagram: empty() };
  if (!shopifyConfigured()) return out;
  try {
    const rows = await shopifyql(`FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY referrer_name, utm_medium SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 500`, { timeoutMs: 20000 });
    for (const r of rows) {
      const name = str(r.referrer_name).toLowerCase();
      const medium = str(r.utm_medium);
      if (isPaidMedium(medium)) continue;
      const key: OrganicPlatform | null = name.includes('pinterest') ? 'Pinterest' : name.includes('instagram') ? 'Instagram' : null;
      if (!key) continue;
      out[key].sessions += num(r.sessions); out[key].cartAdds += num(r.sessions_with_cart_additions); out[key].completed += num(r.sessions_that_completed_checkout);
    }
  } catch { /* leave zeros */ }
  return out;
}

// Account-level (not per-post) fields. Graded like the post sets: the first
// set Windsor accepts wins; /api/debug/organic shows the attempts.
export const INSTAGRAM_ACCOUNT_FIELDSETS = [
  // Windsor names: followers_count (total), follower_count (new per day), profile_views_1d, website_clicks_1d.
  { name: 'full', fields: ['date', 'followers_count', 'follower_count', 'profile_views_1d', 'website_clicks_1d'] },
  { name: 'followers', fields: ['date', 'followers_count', 'follower_count'] },
  { name: 'count_only', fields: ['date', 'followers_count'] },
  { name: 'daily_only', fields: ['date', 'follower_count'] },
];
export const PINTEREST_ACCOUNT_FIELDSETS = [
  // Windsor's Pinterest Organic account fields are prefixed "account_" (its UI
  // lists "Account follower count" etc.); the unprefixed names came back null.
  { name: 'account_prefixed', fields: ['date', 'account_follower_count', 'account_following_count', 'account_board_count', 'account_monthly_views', 'account_pin_count'] },
  { name: 'full', fields: ['date', 'followers', 'following', 'pin_count', 'board_count', 'monthly_views'] },
  { name: 'followers', fields: ['date', 'followers'] },
  { name: 'alt', fields: ['date', 'follower_count'] },
  { name: 'alt2', fields: ['date', 'user_followers'] },
];

const EMPTY_AUD = (): Pick<Audience, 'followers' | 'followersStart' | 'newFollowers' | 'series'> => ({ followers: null, followersStart: null, newFollowers: null, series: [] });

// Field names the audience reader understands, from any of the feeds
// (Windsor live Instagram, Windsor live Pinterest, the pinterest_organic table).
const AUD_KEYS = ['followers_count', 'followers', 'follower_count', 'user_followers', 'account_follower_count', 'profile_views', 'profile_views_1d', 'website_clicks', 'website_clicks_1d', 'following', 'account_following_count', 'pin_count', 'account_pin_count', 'board_count', 'account_board_count', 'monthly_views', 'account_monthly_views'];

/** Collapse dated rows (one per day, or one per post per day) into the Audience shape. */
function audienceFromRows(source: 'pinterest_organic' | 'instagram', rows: Array<Record<string, unknown>>, meta: { fieldSet?: string; attempts?: WindsorAttempt[] }): Audience {
  // One row per day (collapse any per-post duplication by taking each day's max).
  const byDay = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const d = str(row.date).slice(0, 10);
    if (!d) continue;
    const cur = byDay.get(d) || {};
    for (const k of AUD_KEYS) if (row[k] != null && row[k] !== '') cur[k] = Math.max(cur[k] ?? 0, num(row[k]));
    byDay.set(d, cur);
  }
  const dated = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const days = dated.map(([, v]) => v);
  if (!days.length) return { status: 'ok', ...EMPTY_AUD(), fieldSet: meta.fieldSet, attempts: meta.attempts };
  const totalKey = ['followers_count', 'followers', 'user_followers', 'account_follower_count'].find(k => days.some(d => d[k] != null));
  const hasDaily = days.some(d => d.follower_count != null);
  // Instagram's follower_count is NEW followers per day; on Pinterest a
  // follower_count field would be a running total, so only sum it for Instagram.
  const dailyKey = hasDaily && source === 'instagram' ? 'follower_count' : null;
  const withTotal = totalKey ? days.filter(d => d[totalKey] != null) : [];
  const last = withTotal.length ? withTotal[withTotal.length - 1][totalKey!] : (!totalKey && hasDaily && source !== 'instagram' ? days[days.length - 1].follower_count ?? null : null);
  const first = withTotal.length ? withTotal[0][totalKey!] : null;
  const dailySum = dailyKey ? days.reduce((s, d) => s + (d[dailyKey] || 0), 0) : null;
  const newFollowers = dailySum != null ? dailySum : (last != null && first != null ? last - first : null);
  const sum = (k: string) => (days.some(d => d[k] != null) ? days.reduce((s, d) => s + (d[k] || 0), 0) : undefined);
  const latest = (...ks: string[]) => { for (const k of ks) { const v = [...days].reverse().find(d => d[k] != null)?.[k]; if (v != null) return v; } return undefined; };
  // Daily series: running total where the feed has one; daily net new from the
  // feed, or the day-over-day change in the total (first day has no prior).
  let prevTotal: number | null = null;
  const series: AudiencePoint[] = dated.map(([date, d]) => {
    const total = totalKey && d[totalKey] != null ? d[totalKey] : (source !== 'instagram' && !totalKey && d.follower_count != null ? d.follower_count : null);
    const fromFeed = dailyKey && d[dailyKey] != null ? d[dailyKey] : null;
    const delta = fromFeed != null ? fromFeed : (total != null && prevTotal != null ? total - prevTotal : null);
    if (total != null) prevTotal = total;
    const pv = d.profile_views ?? d.profile_views_1d; const wc = d.website_clicks ?? d.website_clicks_1d; const mv = d.account_monthly_views ?? d.monthly_views;
    return { date, followers: total, newFollowers: delta, ...(pv != null ? { profileViews: pv } : {}), ...(wc != null ? { websiteClicks: wc } : {}), ...(mv != null ? { monthlyViews: mv } : {}) };
  });
  return {
    status: 'ok', followers: last, followersStart: first, newFollowers,
    profileViews: sum('profile_views') ?? sum('profile_views_1d'), websiteClicks: sum('website_clicks') ?? sum('website_clicks_1d'),
    following: latest('account_following_count', 'following'), boards: latest('account_board_count', 'board_count'),
    pins: latest('account_pin_count', 'pin_count'), monthlyViews: latest('account_monthly_views', 'monthly_views'),
    series, fieldSet: meta.fieldSet, attempts: meta.attempts,
  };
}

async function fetchAudience(source: 'pinterest_organic' | 'instagram', fieldSets: Array<{ name: string; fields: string[] }>, from: string, to: string): Promise<Audience> {
  const r = await windsorOrganicRows(source, fieldSets, from, to, source === 'pinterest_organic' ? 30000 : 20000);
  if (r.notConnected) return { status: 'not_connected', ...EMPTY_AUD() };
  if (!r.rows) return { status: 'error', error: r.attempts.map(a => `${a.fieldSet}: ${a.error}`).join(' | '), ...EMPTY_AUD(), attempts: r.attempts };
  return audienceFromRows(source, r.rows, { fieldSet: r.fieldSet || undefined, attempts: r.attempts });
}

// Account columns the Windsor → BigQuery task can carry for Pinterest Organic
// (ticked as "Account follower count" etc. in the task form). Read from the
// table when present: instant, and no live pull from Pinterest.
const PIN_TABLE_ACCOUNT_COLS = ['account_follower_count', 'account_following_count', 'account_board_count', 'account_pin_count', 'account_monthly_views', 'followers', 'follower_count', 'following', 'board_count', 'pin_count', 'monthly_views'];
async function fetchPinterestAudienceFromTable(from: string, to: string): Promise<Audience | null> {
  if (!isBigQueryConfigured() || !(await tableExists('pinterest_organic'))) return null;
  try {
    const ds = getDataset();
    const cols = await runQuery<{ column_name: string }>(`SELECT column_name FROM \`${ds}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'pinterest_organic'`);
    const have = new Set(cols.map(c => c.column_name));
    const use = PIN_TABLE_ACCOUNT_COLS.filter(c => have.has(c));
    if (!use.length || !have.has('date')) return null;
    // Account totals repeat on every pin row for the day, so MAX per day is the day's value.
    const rows = await runQuery<Record<string, unknown>>(`SELECT CAST(date AS STRING) AS date, ${use.map(c => `MAX(SAFE_CAST(${c} AS FLOAT64)) AS ${c}`).join(', ')} FROM \`${ds}.pinterest_organic\` WHERE DATE(date) BETWEEN @from AND @to GROUP BY date ORDER BY date`, { from, to });
    if (!rows.length) return null;
    const a = audienceFromRows('pinterest_organic', rows, { fieldSet: 'bigquery:pinterest_organic' });
    return a.followers != null || a.newFollowers != null ? a : null;
  } catch {
    return null;
  }
}
async function fetchPinterestAudience(from: string, to: string): Promise<Audience> {
  const fromTable = await fetchPinterestAudienceFromTable(from, to);
  if (fromTable) return fromTable;
  return fetchAudience('pinterest_organic', PINTEREST_ACCOUNT_FIELDSETS, from, to);
}

// A block that fails or overruns reports its own error; the rest of the page still renders.
function guarded<T>(p: Promise<T>, fallback: (err: string) => T, ceilingMs: number): Promise<T> {
  return Promise.race<T>([
    p.catch(e => fallback(e instanceof Error ? e.message : String(e))),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback(`took longer than ${Math.round(ceilingMs / 1000)}s`)), ceilingMs)),
  ]);
}
export async function fetchOrganic(from: string, to: string): Promise<OrganicData> {
  const errBlock = <T,>(err: string): SourceBlock<T> => ({ status: 'error', error: err, items: [], totals: {} });
  const errAud = (err: string): Audience => ({ status: 'error', error: err, ...EMPTY_AUD() });
  const [pinterest, instagram, blog, socialTraffic, pinAudience, igAudience] = await Promise.all([
    guarded(fetchPinterestOrganic(from, to), errBlock<OrganicPost>, 70000),
    guarded(fetchInstagramOrganic(from, to), errBlock<OrganicPost>, 45000),
    guarded(fetchBlogPerformance(from, to), errBlock<BlogPost>, 45000),
    guarded(fetchSocialTraffic(from, to), () => ({ Pinterest: { sessions: 0, cartAdds: 0, completed: 0 }, Instagram: { sessions: 0, cartAdds: 0, completed: 0 } }), 30000),
    guarded(fetchPinterestAudience(from, to), errAud, 40000),
    guarded(fetchAudience('instagram', INSTAGRAM_ACCOUNT_FIELDSETS, from, to), errAud, 30000),
  ]);
  return { range: { from, to }, pinterest, instagram, blog, socialTraffic, audience: { Pinterest: pinAudience, Instagram: igAudience } };
}

/** Whether a source is wired for this client (for the tab's setup hints). */
export function organicSourceConfigured(source: 'pinterest_organic' | 'instagram'): boolean {
  return Boolean(WINDSOR_KEY) && windsorAccount(source) !== null;
}
