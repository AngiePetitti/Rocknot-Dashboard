'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TIMEFRAME_LABELS } from '@/src/lib/utils';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import { useClient } from '@/src/components/ClientProvider';
import type { OrganicData, OrganicPost, BlogPost, SourceBlock, Audience } from '@/src/lib/organic';
import FollowerGrowthChart from '@/src/components/charts/FollowerGrowthChart';

interface OrganicResponse extends Partial<OrganicData> { source?: string; error?: string }

const n = (v: number | undefined) => Math.round(v || 0).toLocaleString();
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');

const PIN_SORTS: Array<{ key: string; label: string }> = [
  { key: 'impressions', label: 'Impressions' }, { key: 'saves', label: 'Saves' }, { key: 'outboundClicks', label: 'Outbound clicks' }, { key: 'pinClicks', label: 'Pin clicks' },
];
const IG_SORTS: Array<{ key: string; label: string }> = [
  { key: 'reach', label: 'Reach' }, { key: 'likes', label: 'Likes' }, { key: 'saves', label: 'Saves' }, { key: 'comments', label: 'Comments' }, { key: 'shares', label: 'Shares' }, { key: 'views', label: 'Views' },
];

function Thumb({ src, alt, ratio }: { src: string; alt: string; ratio: 'pin' | 'square' | 'wide' }) {
  const [broken, setBroken] = useState(false);
  const cls = ratio === 'pin' ? 'aspect-[2/3]' : ratio === 'square' ? 'aspect-square' : 'aspect-[16/9]';
  return (
    <div className={`${cls} w-full bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center`}>
      {src && !broken ? (
        // Platform CDN images: plain <img> (next/image would need every CDN host allow-listed).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-cover" />
      ) : (
        <span className="text-[11px] text-gray-400 px-3 text-center">No image</span>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase font-semibold text-gray-400 truncate">{label}</p>
      <p className="text-sm font-bold text-gray-800 tabular-nums">{n(value)}</p>
    </div>
  );
}

function SetupCard({ title, platform, isAdmin, block }: { title: string; platform: 'Pinterest Organic' | 'Instagram Insights'; isAdmin: boolean; block: SourceBlock<OrganicPost> }) {
  return (
    <Card className="mb-6">
      <h3 className="text-sm font-bold text-gray-800 mb-1">{title}</h3>
      {block.status === 'error' ? (
        <>
          <p className="text-xs text-red-600 mb-2">Windsor returned an error for this source.</p>
          {isAdmin && <p className="text-[11px] text-gray-500 break-words">{block.error}</p>}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500">Not connected yet.</p>
          {isAdmin && (
            <ol className="text-xs text-gray-600 mt-2 list-decimal pl-5 space-y-1">
              <li>In Windsor, add the <strong>{platform}</strong> data source and sign in with the account that owns the profile.</li>
              <li>Open <code className="bg-gray-100 px-1 rounded">/api/debug/organic</code> on this dashboard and send Claude the account id it lists for this source.</li>
              <li>The profile gets that id and this section fills in on the next deploy.</li>
            </ol>
          )}
        </>
      )}
    </Card>
  );
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;
const PLATFORM_COLORS: Record<'Instagram' | 'Pinterest', string> = { Instagram: '#d946ef', Pinterest: '#e11d48' };

/** One platform's panel in the Audience card: followers, net change, and its other account/engagement numbers. */
function AudienceColumn({ label, a, totals, rangeLabel }: { label: 'Instagram' | 'Pinterest'; a: Audience | undefined; totals: Record<string, number> | undefined; rangeLabel: string }) {
  const color = PLATFORM_COLORS[label];
  const stats: Array<[string, number | undefined]> = label === 'Instagram'
    ? [['Views', totals?.views], ['Reach', totals?.reach || totals?.impressions], ['Likes', totals?.likes], ['Saves', totals?.saves], ['Comments', totals?.comments], ['Shares', totals?.shares], ['Profile views', a?.profileViews], ['Website taps', a?.websiteClicks]]
    : [['Monthly views', a?.monthlyViews], ['Impressions', totals?.impressions], ['Saves', totals?.saves], ['Outbound clicks', totals?.outboundClicks], ['Pins', a?.pins], ['Boards', a?.boards], ['Following', a?.following]];
  const shown = stats.filter(([, v]) => v != null && v > 0).slice(0, 8);
  // A net change needs more than one dated point: either running totals on
  // several days, or the feed's own daily new-follower counts (Instagram
  // reports follower_count per day even when the total is a single snapshot).
  const datedPoints = (a?.series || []).filter(pt => pt.followers != null || pt.newFollowers != null).length;
  const change = a?.status === 'ok' && a.newFollowers != null && !a.asOf && (datedPoints > 1 || a.followers == null) ? a.newFollowers : null;
  const state = !a || a.status === 'not_connected' ? 'Not connected yet' : a.status === 'error' ? 'Follower data unavailable right now' : null;
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
        </div>
        {change != null && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${change > 0 ? 'bg-green-50 text-green-600' : change < 0 ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
            {change > 0 ? '▲ Growing' : change < 0 ? '▼ Declining' : '• Flat'} · {signed(change)}{a?.followersStart ? ` (${(Math.round((change / a.followersStart) * 1000) / 10).toFixed(1)}%)` : ''} · {rangeLabel.toLowerCase()}
          </span>
        )}
      </div>
      {state ? (
        <p className="text-sm text-gray-400 mt-3">{state}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-3xl font-bold text-gray-800 leading-none">{a!.followers != null ? n(a!.followers) : (a!.newFollowers != null ? signed(a!.newFollowers) : '—')}</p>
            <p className="text-xs text-gray-400">{a!.followers != null ? (a!.asOf ? `followers as of ${a!.asOf} (latest snapshot — the feed has no follower history for this period)` : change == null ? 'followers · change shows once the feed has two or more days of follower history' : 'followers') : a!.newFollowers != null ? `net new, ${rangeLabel.toLowerCase()}` : 'no follower count from this feed for this period'}</p>
          </div>
          {shown.length > 0 && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5 mt-4 pt-3 border-t border-gray-100">
              {shown.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 truncate">{k}</dt>
                  <dd className="text-sm font-semibold text-gray-700 tabular-nums">{n(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  );
}

/** Growth summary for one platform's daily series. */
function growthSummary(s: Audience['series']) {
  const totals = s.filter(p => p.followers != null);
  const dailies = s.filter(p => p.newFollowers != null);
  const first = totals[0]; const last = totals[totals.length - 1];
  const net = first && last && first !== last ? last.followers! - first.followers! : (dailies.length ? dailies.reduce((t, p) => t + (p.newFollowers || 0), 0) : null);
  const perDay = net != null && dailies.length ? net / Math.max(1, dailies.length) : null;
  const best = dailies.length ? dailies.reduce((b, p) => (p.newFollowers! > b.newFollowers! ? p : b)) : null;
  const worst = dailies.length ? dailies.reduce((b, p) => (p.newFollowers! < b.newFollowers! ? p : b)) : null;
  const down = dailies.filter(p => p.newFollowers! < 0).length;
  return { first, last, net, perDay, best, worst, down, days: dailies.length };
}

function PostGrid({ block, sorts, ratio, metricDefs, emptyText }: {
  block: SourceBlock<OrganicPost>; sorts: Array<{ key: string; label: string }>; ratio: 'pin' | 'square';
  metricDefs: Array<{ key: string; label: string }>; emptyText: string;
}) {
  const [sortKey, setSortKey] = useState(sorts[0].key);
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => [...block.items].sort((a, b) => (b.metrics[sortKey] || 0) - (a.metrics[sortKey] || 0)), [block.items, sortKey]);
  const shown = showAll ? items : items.slice(0, 12);
  if (!items.length) return <p className="text-xs text-gray-400 py-3">{emptyText}</p>;
  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] text-gray-400">Sort by</span>
        {sorts.filter(s => items.some(i => (i.metrics[s.key] || 0) > 0)).map(s => (
          <button key={s.key} onClick={() => setSortKey(s.key)}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${sortKey === s.key ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">{items.length} posts</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {shown.map(p => (
          <a key={p.id} href={p.url || undefined} target="_blank" rel="noreferrer" className="group block rounded-2xl border border-gray-100 bg-white p-2 hover:shadow-md transition-shadow">
            <Thumb src={p.imageUrl} alt={p.title} ratio={ratio} />
            <p className="text-xs font-semibold text-gray-800 mt-2 line-clamp-2 min-h-[2rem]" title={p.title}>{p.title}</p>
            <p className="text-[10px] text-gray-400 truncate">{[p.group, p.publishedAt].filter(Boolean).join(' · ') || ' '}</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-2">
              {metricDefs.filter(m => p.metrics[m.key] !== undefined && (block.totals[m.key] || 0) > 0).slice(0, 4).map(m => (
                <Metric key={m.key} label={m.label} value={p.metrics[m.key]} />
              ))}
            </div>
          </a>
        ))}
      </div>
      {items.length > 12 && (
        <button onClick={() => setShowAll(v => !v)} className="mt-3 text-xs font-semibold text-indigo-600 hover:underline">
          {showAll ? 'Show top 12' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

export default function OrganicContent() {
  const searchParams = useSearchParams();
  const client = useClient();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const rangeLabel = tfRaw === 'custom' && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tfRaw] || 'Last 30 Days');
  const [data, setData] = useState<OrganicResponse | null>(null);
  const [showAllBlog, setShowAllBlog] = useState(false);
  type BlogSort = 'publishedAt' | 'sessions' | 'cartAdds' | 'completed' | 'cvr' | 'bounce';
  const [blogSort, setBlogSort] = useState<{ key: BlogSort; dir: 'asc' | 'desc' }>({ key: 'sessions', dir: 'desc' });
  const toggleBlogSort = (key: BlogSort) => setBlogSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    fetch(`/api/organic?${p}`, { cache: 'no-store' }).then(r => r.json()).then(setData).catch(e => setData({ source: 'error', error: `The organic data request didn't complete (${e instanceof Error ? e.message : 'network'}). Reload to try again; each source now loads independently.` }));
  }, [tfRaw, dateFrom, dateTo]);

  const pin = data?.pinterest;
  const ig = data?.instagram;
  const blog = data?.blog;
  const traffic = data?.socialTraffic;
  const blogItems: BlogPost[] = useMemo(() => {
    const items = [...(blog?.items || [])];
    const val = (b: BlogPost) => blogSort.key === 'bounce' ? (b.bounceRate ?? -1) : blogSort.key === 'cvr' ? (b.sessions > 0 ? b.completed / b.sessions : -1)
      : blogSort.key === 'publishedAt' ? (b.publishedAt || '') : b[blogSort.key];
    items.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
      return blogSort.dir === 'desc' ? -c : c;
    });
    return items;
  }, [blog?.items, blogSort]);
  const blogShown = showAllBlog ? blogItems : blogItems.slice(0, 15);
  const SortTH = ({ k, label }: { k: BlogSort; label: string }) => (
    <th className="text-right text-xs font-semibold uppercase pb-2 pl-2">
      <button onClick={() => toggleBlogSort(k)} className={`inline-flex items-center gap-1 ${blogSort.key === k ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}>
        {label}<span className="text-[9px]">{blogSort.key === k ? (blogSort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header title="Organic Content" subtitle="How pins, posts and blog articles perform · Pinterest and Instagram via Windsor, blog via Shopify sessions" />
      <TimeframeSelector />
      {!data && <p className="text-xs text-gray-400 mb-4">Loading organic performance for {rangeLabel}…</p>}
      {data?.error && <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>}

      {data && !data.error && (
        <>
          {/* ── Audience: followers and the other account-level numbers, across platforms ── */}
          {data.audience && (
            <Card className="mt-4 mb-6">
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-gray-800">Audience</h3>
                <p className="text-[11px] text-gray-400">Followers as of the last day · engagement totals for {rangeLabel.toLowerCase()}</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <AudienceColumn label="Instagram" a={data.audience.Instagram} totals={ig?.status === 'ok' ? ig.totals : undefined} rangeLabel={rangeLabel} />
                <AudienceColumn label="Pinterest" a={data.audience.Pinterest} totals={pin?.status === 'ok' ? pin.totals : undefined} rangeLabel={rangeLabel} />
              </div>
            </Card>
          )}

          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <MetricCard title="Pin Impressions" accentColor="#e11d48"
              value={pin?.status === 'ok' ? n(pin.totals.impressions) : '—'}
              subtitle={pin?.status === 'ok' ? `${n(pin.totals.saves)} saves · ${n(pin.totals.outboundClicks)} outbound clicks${pin.note ? ' · last 7 days only' : ''}` : pin?.status === 'error' ? (/timeout|aborted|budget/i.test(pin.error || '') ? "Pinterest's live feed timed out — see the Pinterest Pins section" : 'Pinterest feed error — see below') : 'Pinterest Organic not connected'} />
            <MetricCard title="Instagram Reach" accentColor="#d946ef"
              value={ig?.status === 'ok' ? n(ig.totals.reach || ig.totals.impressions) : '—'}
              subtitle={ig?.status === 'ok' ? `${n(ig.totals.views)} views · ${n(ig.totals.likes)} likes · ${n(ig.totals.saves)} saves · ${n(ig.totals.comments)} comments` : 'Instagram Insights not connected'} />
            <MetricCard title="Blog Sessions" accentColor="#34d399"
              value={blog?.status === 'ok' ? n(blog.totals.sessions) : '—'}
              subtitle={blog?.status === 'ok' ? `${n(blog.totals.articles)} articles (${n(blog.totals.articleSessions)} sessions) · incl. blog home & tag pages ${n(blog.totals.sessions)} · ${n(blog.totals.completed)} orders · ${pct(blog.totals.completed || 0, blog.totals.sessions || 0)} CVR` : 'Shopify not connected'} />
            <MetricCard title="Organic Social Visits" accentColor="#818cf8"
              value={n((traffic?.Pinterest.sessions || 0) + (traffic?.Instagram.sessions || 0))}
              subtitle={`Pinterest ${n(traffic?.Pinterest.sessions)} (${n(traffic?.Pinterest.completed)} orders) · Instagram ${n(traffic?.Instagram.sessions)} (${n(traffic?.Instagram.completed)} orders) · unpaid taps to ${client.siteDomain}`} />
          </div>

          {/* ── Follower growth: how each audience is moving day by day ── */}
          {data.audience && (() => {
            const platforms = (['Instagram', 'Pinterest'] as const).map(label => ({ label, a: data.audience![label] }));
            const withSeries = platforms.filter(p => p.a.status === 'ok' && p.a.series.length > 1);
            return (
              <Card className="mb-6">
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h3 className="text-sm font-bold text-gray-800">Follower Growth</h3>
                  <p className="text-[11px] text-gray-400">Day by day over {rangeLabel.toLowerCase()} · one chart per platform (their audiences differ in size, so each has its own scale)</p>
                </div>
                {withSeries.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    {platforms.every(p => p.a.status === 'not_connected') ? 'Connect Instagram Insights or Pinterest Organic in Windsor to see follower growth.'
                      : 'No day-by-day follower rows for this period yet. Pinterest fills in once the pinterest_organic BigQuery task has run; Instagram needs more than one day in the range.'}
                  </p>
                ) : (
                  <div className={`grid gap-6 ${withSeries.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                    {withSeries.map(({ label, a }) => {
                      const g = growthSummary(a.series);
                      const up = g.net != null && g.net > 0; const flat = g.net === 0;
                      return (
                        <div key={label}>
                          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                            <div className="flex items-center gap-2">
                              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PLATFORM_COLORS[label] }} />
                              <p className="text-xs font-semibold text-gray-600">{label} followers</p>
                            </div>
                            {g.net != null && (
                              <p className={`text-xs font-semibold ${up ? 'text-green-500' : flat ? 'text-gray-400' : 'text-red-500'}`}>
                                {up ? '▲ Growing' : flat ? '• Flat' : '▼ Shrinking'} · {signed(g.net)}{g.first && g.last ? ` (${n(g.first.followers!)} → ${n(g.last.followers!)})` : ''}
                              </p>
                            )}
                          </div>
                          <FollowerGrowthChart label={label} color={PLATFORM_COLORS[label]} series={a.series} />
                          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-gray-500">
                            {g.perDay != null && <span>Avg <b className="text-gray-700">{`${g.perDay > 0 ? '+' : g.perDay < 0 ? '−' : ''}${Math.abs(g.perDay).toFixed(1)}`}</b> / day</span>}
                            {g.best && g.best.newFollowers! > 0 && <span>Best day <b className="text-gray-700">{g.best.date.slice(5)}</b> ({signed(g.best.newFollowers!)})</span>}
                            {g.worst && g.worst.newFollowers! < 0 && <span>Biggest drop <b className="text-gray-700">{g.worst.date.slice(5)}</b> ({signed(g.worst.newFollowers!)})</span>}
                            {g.days > 0 && <span><b className="text-gray-700">{g.down}</b> of {g.days} days lost followers</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })()}

          {/* ── Pinterest pins ── */}
          {pin && pin.status !== 'ok' ? (
            <SetupCard title="Pinterest Pins" platform="Pinterest Organic" isAdmin={isAdmin} block={pin} />
          ) : pin && (
            <Card className="mb-6">
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-gray-800">Pinterest Pins</h3>
                <p className="text-[11px] text-gray-400">Organic pins with activity in this period · impressions, saves and clicks are Pinterest&apos;s own counts</p>
              </div>
              {pin.note && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3">{pin.note}</p>}
              <PostGrid block={pin} sorts={PIN_SORTS} ratio="pin" emptyText={pin.note ? 'No pins to show for these days yet.' : 'No organic pin activity in this period.'}
                metricDefs={[{ key: 'impressions', label: 'Impr.' }, { key: 'saves', label: 'Saves' }, { key: 'outboundClicks', label: 'Outbound' }, { key: 'pinClicks', label: 'Pin clicks' }]} />
            </Card>
          )}

          {/* ── Instagram posts ── */}
          {ig && ig.status !== 'ok' ? (
            <SetupCard title="Instagram Posts" platform="Instagram Insights" isAdmin={isAdmin} block={ig} />
          ) : ig && (
            <Card className="mb-6">
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-gray-800">Instagram Posts &amp; Reels</h3>
                <p className="text-[11px] text-gray-400">Posts and reels published in this period · reach, likes, saves, comments, shares, views are Instagram&apos;s own lifetime counts for each post</p>
              </div>
              {ig.note && <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 mb-3">{ig.note}</p>}
              <PostGrid block={ig} sorts={IG_SORTS} ratio="square" emptyText="No Instagram post activity in this period."
                metricDefs={[{ key: 'reach', label: 'Reach' }, { key: 'likes', label: 'Likes' }, { key: 'saves', label: 'Saves' }, { key: 'comments', label: 'Comments' }, { key: 'shares', label: 'Shares' }, { key: 'views', label: 'Views' }]} />
            </Card>
          )}

          {/* ── Blog ── */}
          <Card className="mb-6">
            <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
              <h3 className="text-sm font-bold text-gray-800">Blog Posts</h3>
              <p className="text-[11px] text-gray-400">Sessions that started on the article · Shopify sessions report · bounce rate from Google Analytics 4 (sessions under 10s with no conversion and one page){blog?.status === 'ok' && blog.totals.bounceRatePct != null ? ` · blog-wide ${blog.totals.bounceRatePct}%` : ''}</p>
            </div>
            {blog?.status === 'ok' && blog.note && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3">{blog.note}</p>}
            {blog?.status === 'error' && <p className="text-xs text-red-600 mb-2">{blog.error}</p>}
            {blog?.status === 'ok' && blogItems.length > 0 && (blog.totals.articlesKnown || 0) === 0 && isAdmin && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                Titles and cover images could not be loaded: the Shopify app lacks the <code className="bg-white px-1 rounded">read_content</code> scope and the public blog feed returned nothing. Shopify admin → Settings → Apps and sales channels → Develop apps → this app → Configuration → tick read_content → Save.
              </p>
            )}
            {blog?.status === 'not_connected' && <p className="text-xs text-gray-400">Shopify is not connected on this deployment.</p>}
            {blog?.status === 'ok' && blogItems.length === 0 && <p className="text-xs text-gray-400 py-3">No sessions started on a /blogs/ page of {client.siteDomain} in this period.</p>}
            {blogItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-2">Article</th>
                      <SortTH k="publishedAt" label="Published" />
                      <SortTH k="sessions" label="Sessions" />
                      <SortTH k="cartAdds" label="Add to cart" />
                      <SortTH k="completed" label="Orders" />
                      <SortTH k="cvr" label="CVR" />
                      <SortTH k="bounce" label="Bounce" />
                    </tr>
                  </thead>
                  <tbody>
                    {blogShown.map(b => (
                      <tr key={b.path} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-2">
                          <a href={b.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 group">
                            <div className="w-16 shrink-0"><Thumb src={b.imageUrl} alt={b.title} ratio="wide" /></div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800 group-hover:underline line-clamp-2">
                                {b.title}
                                {b.kind !== 'article' && <span className="ml-1.5 text-[10px] font-semibold uppercase text-gray-400 align-middle">{b.kind === 'index' ? 'blog home' : 'tag page'}</span>}
                              </p>
                              <p className="text-[10px] text-gray-400 font-mono truncate">{b.path.replace(/^\/blogs\//, '')}</p>
                            </div>
                          </a>
                        </td>
                        <td className="py-2 pl-2 text-right text-xs text-gray-500 tabular-nums whitespace-nowrap">{b.publishedAt || '—'}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{n(b.sessions)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums text-gray-600">{n(b.cartAdds)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{n(b.completed)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums text-gray-600">{pct(b.completed, b.sessions)}</td>
                        <td className={`py-2 pl-2 text-right tabular-nums ${b.bounceRate == null ? 'text-gray-300' : b.bounceRate >= 0.7 ? 'text-red-500' : b.bounceRate <= 0.4 ? 'text-green-600' : 'text-gray-600'}`} title={b.bounceRate != null ? `${n(b.gaSessions)} GA4 sessions` : 'No GA4 row for this page'}>{b.bounceRate == null ? '—' : `${(b.bounceRate * 100).toFixed(0)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {blogItems.length > 15 && (
                  <button onClick={() => setShowAllBlog(v => !v)} className="mt-3 text-xs font-semibold text-indigo-600 hover:underline">
                    {showAllBlog ? 'Show top 15' : `Show all ${blogItems.length}`}
                  </button>
                )}
              </div>
            )}
          </Card>

          <p className="text-[11px] text-gray-400">
            Pin and post metrics are the platforms&apos; own counts for the selected period (lifetime counters such as likes are shown as of the latest day). &quot;Organic Social Visits&quot; are site sessions whose referrer was Pinterest or Instagram with no paid tag — many in-app taps hide the referrer and land under Direct on the Traffic tab, so treat it as a floor.
          </p>
        </>
      )}
    </div>
  );
}
