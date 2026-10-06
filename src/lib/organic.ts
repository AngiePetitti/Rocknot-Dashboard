// Organic Content tab data: how organic Pinterest pins and Instagram posts
// are performing (Windsor's Pinterest Organic / Instagram Insights feeds,
// with the post's own image), and how blog articles perform on the site
// (Shopify sessions that started on a /blogs/ page, joined to the article's
// title and cover image from the Shopify Admin API).
import { getClient, shopifyDomain, windsorParams, windsorAccount } from '@/src/lib/client';
import { shopifyql, shopifyConfigured } from '@/src/lib/shopifyql';
import { isPaidMedium } from '@/src/lib/traffic';

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
): Promise<{ attempts: WindsorAttempt[]; rows: Array<Record<string, unknown>> | null; fieldSet: string | null; notConnected: boolean }> {
  const attempts: WindsorAttempt[] = [];
  if (!WINDSOR_KEY) return { attempts, rows: null, fieldSet: null, notConnected: true };
  const scoped = windsorParams(source, { date_from: from, date_to: to });
  if (!scoped) return { attempts, rows: null, fieldSet: null, notConnected: true };
  for (const fs of fieldSets) {
    const qs = new URLSearchParams({ api_key: WINDSOR_KEY, fields: fs.fields.join(','), _renderer: 'json', ...scoped });
    try {
      const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (json.error || !Array.isArray(json.data)) {
        attempts.push({ fieldSet: fs.name, fields: fs.fields, error: String(json.error || json.message || `HTTP ${res.status}`) });
        continue;
      }
      attempts.push({ fieldSet: fs.name, fields: fs.fields, rows: json.data.slice(0, 3) });
      return { attempts, rows: json.data as Array<Record<string, unknown>>, fieldSet: fs.name, notConnected: false };
    } catch (e) {
      attempts.push({ fieldSet: fs.name, fields: fs.fields, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { attempts, rows: null, fieldSet: null, notConnected: false };
}

// Windsor field names from its Pinterest Organic / Instagram Insights field
// references. Media/identity fields first; metrics-only fallbacks after.
export const PINTEREST_ORGANIC_FIELDSETS = [
  { name: 'full', fields: ['date', 'pin_id', 'pin_title', 'pin_description', 'pin_permalink', 'pin_media_image_url', 'pin_board_name', 'pin_created_at', 'pin_impression', 'save', 'pin_click', 'pin_outbound_click'] },
  { name: 'no_media', fields: ['date', 'pin_id', 'pin_title', 'pin_permalink', 'pin_created_at', 'pin_impression', 'save', 'pin_click', 'pin_outbound_click'] },
  { name: 'minimal', fields: ['date', 'pin_id', 'pin_title', 'pin_impression', 'save', 'pin_click', 'pin_outbound_click'] },
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

export async function fetchPinterestOrganic(from: string, to: string): Promise<SourceBlock<OrganicPost>> {
  const r = await windsorOrganicRows('pinterest_organic', PINTEREST_ORGANIC_FIELDSETS, from, to);
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
  const rolled = rollUp(r.rows, 'pin_id', ['pin_impression', 'save', 'pin_click', 'pin_outbound_click']);
  const items: OrganicPost[] = Array.from(rolled.entries()).map(([id, v]) => {
    const last = v.rows[v.rows.length - 1];
    return {
      id, platform: 'Pinterest' as const,
      title: str(last.pin_title) || str(last.pin_description).slice(0, 80) || `Pin ${id}`,
      imageUrl: str(last.pin_media_image_url),
      url: str(last.pin_permalink) || `https://www.pinterest.com/pin/${id}/`,
      publishedAt: str(last.pin_created_at).slice(0, 10),
      group: str(last.pin_board_name),
      metrics: { impressions: v.metrics.pin_impression, saves: v.metrics.save, pinClicks: v.metrics.pin_click, outboundClicks: v.metrics.pin_outbound_click },
    };
  }).filter(p => Object.values(p.metrics).some(x => x > 0))
    .sort((a, b) => b.metrics.impressions - a.metrics.impressions);
  return { status: 'ok', items, totals: sumTotals(items, PINTEREST_METRICS), fieldSet: r.fieldSet || undefined };
}

function pickImage(type: string, mediaUrl: string, thumbUrl: string): string {
  const isVideo = /REEL|VIDEO/i.test(type) || /\.mp4(\?|$)/i.test(mediaUrl);
  if (isVideo) return thumbUrl || '';
  return mediaUrl || thumbUrl;
}

export async function fetchInstagramOrganic(from: string, to: string): Promise<SourceBlock<OrganicPost>> {
  const r = await windsorOrganicRows('instagram', INSTAGRAM_FIELDSETS, from, to);
  if (r.notConnected) return { status: 'not_connected', items: [], totals: {} };
  if (!r.rows) return { status: 'error', error: r.attempts.map(a => `${a.fieldSet}: ${a.error}`).join(' | '), items: [], totals: {} };
  const rolled = rollUp(r.rows, 'media_id', ['media_reach', 'media_impressions', 'media_like_count', 'media_comments_count', 'media_saved', 'media_shares', 'media_views']);
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
  return { status: 'ok', items, totals: sumTotals(items, INSTAGRAM_METRICS), fieldSet: r.fieldSet || undefined };
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
    const [rows, adminArticles] = await Promise.all([
      shopifyql(landingQl(5000), { timeoutMs: 25000 }).catch(() => shopifyql(landingQl(1000), { timeoutMs: 20000 })),
      fetchArticles(),
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
    const totals = {
      sessions: items.reduce((s, b) => s + b.sessions, 0),
      cartAdds: items.reduce((s, b) => s + b.cartAdds, 0),
      completed: items.reduce((s, b) => s + b.completed, 0),
      articles: articleItems.length,
      articleSessions: articleItems.reduce((s, b) => s + b.sessions, 0),
      articlesKnown: articles.size,
    };
    return { status: 'ok', items, totals };
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

export async function fetchOrganic(from: string, to: string): Promise<OrganicData> {
  const [pinterest, instagram, blog, socialTraffic] = await Promise.all([
    fetchPinterestOrganic(from, to),
    fetchInstagramOrganic(from, to),
    fetchBlogPerformance(from, to),
    fetchSocialTraffic(from, to),
  ]);
  return { range: { from, to }, pinterest, instagram, blog, socialTraffic };
}

/** Whether a source is wired for this client (for the tab's setup hints). */
export function organicSourceConfigured(source: 'pinterest_organic' | 'instagram'): boolean {
  return Boolean(WINDSOR_KEY) && windsorAccount(source) !== null;
}
