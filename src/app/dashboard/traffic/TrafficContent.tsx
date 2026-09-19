'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TIMEFRAME_LABELS } from '@/src/lib/utils';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import { useClient } from '@/src/components/ClientProvider';
import type { TrafficData, CampaignRow, Channel } from '@/src/lib/traffic';

interface TrafficResponse extends Partial<TrafficData> { source?: string; error?: string }

const n = (v: number) => Math.round(v).toLocaleString();
const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');
const share = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

const CHANNEL_COLORS: Record<Channel, string> = {
  'Paid Social': '#818cf8', 'Organic Social': '#f9a8d4', 'Paid Search': '#fbbf24', 'Organic Search': '#34d399',
  'Google Shopping': '#4ade80', 'Email & SMS': '#a78bfa', 'AI Assistants': '#22d3ee', 'Referral': '#fb923c', 'Direct': '#94a3b8', 'Other Tagged': '#cbd5e1',
};
const CHANNEL_HELP: Record<Channel, string> = {
  'Paid Social': 'Clicks on ads whose link carried a paid UTM medium (Meta, TikTok, Pinterest ads).',
  'Organic Social': 'Taps from social apps with no paid tag — bio links, posts, stories, shares.',
  'Paid Search': 'Google / Bing ad clicks.',
  'Organic Search': 'Unpaid results on Google, Bing, DuckDuckGo, Yahoo.',
  'Google Shopping': 'Free product listings synced through Shopify\'s Google channel (product_sync / sag_organic tags).',
  'Email & SMS': 'Klaviyo campaigns and flows, plus anything tagged email or sms.',
  'AI Assistants': 'ChatGPT, Perplexity, Gemini, Copilot, Claude and other assistants linking out.',
  'Referral': 'Other websites, apps and tools linking in (affiliates, LTK, review widgets, press).',
  'Direct': 'Typed the address, used a bookmark, or came from an app that hides the referrer (many Instagram / iMessage taps land here).',
  'Other Tagged': 'Links with a UTM medium that is not paid, email or shopping (influencer, affiliate, QR …).',
};

function Delta({ current, prior }: { current: number; prior?: number }) {
  if (prior === undefined || prior === 0) return null;
  const d = Math.round(((current - prior) / prior) * 1000) / 10;
  return <span className={`text-[11px] font-semibold ml-1 ${d >= 0 ? 'text-green-500' : 'text-red-500'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}%</span>;
}

const TH = ({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <th className={`text-xs font-semibold text-gray-400 uppercase pb-2 ${right ? 'text-right pl-2' : 'text-left pr-2'} ${className}`}>{children}</th>
);
const TD = ({ children, right, mono, className = '' }: { children: React.ReactNode; right?: boolean; mono?: boolean; className?: string }) => (
  <td className={`py-2 align-top ${right ? 'text-right pl-2 tabular-nums' : 'pr-2'} ${mono ? 'font-mono text-xs' : ''} ${className}`}>{children}</td>
);

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 py-3">{text}</p>;
}

export default function TrafficContent() {
  const searchParams = useSearchParams();
  const client = useClient();
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';
  const rangeLabel = tfRaw === 'custom' && dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : (TIMEFRAME_LABELS[tfRaw] || 'Last 30 Days');
  const [data, setData] = useState<TrafficResponse | null>(null);
  const [showAllAds, setShowAllAds] = useState(false);
  const [showAllRefs, setShowAllRefs] = useState(false);

  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (compareOn) p.set('compare', 'true');
    fetch(`/api/traffic?${p}`, { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ source: 'error', error: 'Failed to load' }));
  }, [tfRaw, dateFrom, dateTo, compareOn]);

  const totals = data?.totals;
  const prior = data?.prior?.totals || undefined;
  const totalSessions = totals?.sessions || 0;
  const chartData = useMemo(() => (data?.daily || []).map(d => ({ date: d.date.slice(5), Sessions: d.sessions, Orders: d.completed })), [data]);
  const tickInterval = Math.max(0, Math.floor(chartData.length / 6) - 1);
  const totalOrdersBySource = (data?.orderSources || []).reduce((s, r) => s + r.orders, 0);
  const totalNetBySource = (data?.orderSources || []).reduce((s, r) => s + r.netSales, 0);

  const adLabel = (a: CampaignRow) => a.adName || a.content || a.campaign || '(untagged ad)';
  const campaignLabel = (a: CampaignRow) => a.campaignName || (a.campaign !== a.content ? a.campaign : '') || '';
  const orderSourceLabel = (source: string, name: string) => {
    const own = client.siteDomain.replace(/\.(com|net|co|shop)$/i, '').toLowerCase();
    if (!source && !name) return 'Direct / untracked';
    if (!source && name.toLowerCase() === own) return `${client.wordmark} site (internal link)`;
    if (!source) return name;
    return `${name || source} · ${source}`;
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header title="Traffic" subtitle="Where site visits come from · Shopify sessions by channel, ad, post, referring site and landing page" />
      <TimeframeSelector />
      {!data && <p className="text-xs text-gray-400 mb-4">Loading Shopify sessions for {rangeLabel}…</p>}
      {data?.error && (
        <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>
      )}

      {data && !data.error && totals && (
        <>
          {/* ── Funnel cards (human basis: suspected-bot sessions removed) ── */}
          {(() => {
            const human = data.quality?.humanSessions ?? totals.sessions;
            const priorHuman = data.quality?.priorHumanSessions ?? prior?.sessions;
            const botN = data.quality?.suspectedBot ?? 0;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mt-4 mb-6">
                <MetricCard title="Human Sessions" value={n(human)} subtitle={botN > 0 ? `${n(totals.sessions)} raw − ${n(botN)} suspected bot` : `${n(totals.visitors)} visitors · no bots detected`} accentColor="#818cf8"
                  comparison={prior && priorHuman ? { current: human, prior: priorHuman } : undefined} />
                <MetricCard title="Add to Cart" value={pct(totals.addedToCart, human)} subtitle={`${n(totals.addedToCart)} sessions`} accentColor="#f9a8d4"
                  comparison={prior ? { current: totals.addedToCart, prior: prior.addedToCart } : undefined} />
                <MetricCard title="Checkout" value={pct(totals.reachedCheckout, human)} subtitle={`${n(totals.reachedCheckout)} sessions reached it`} accentColor="#fbbf24"
                  comparison={prior ? { current: totals.reachedCheckout, prior: prior.reachedCheckout } : undefined} />
                <MetricCard title="Conversion" value={pct(totals.completed, human)} subtitle={`${n(totals.completed)} orders · human basis${botN > 0 ? ` (raw ${pct(totals.completed, totals.sessions)})` : ''}`} accentColor="#34d399"
                  comparison={prior ? { current: totals.completed, prior: prior.completed } : undefined} />
                {/* Fifth card spans the row on phones so it is not left alone on one side. */}
                <div className="col-span-2 lg:col-span-1">
                  <MetricCard title="AI Visits" value={n((data.ai?.assistants || []).reduce((s, a) => s + a.sessions, 0))}
                    subtitle={(data.ai?.assistants || []).length ? (data.ai!.assistants.map(a => `${a.assistant} ${a.sessions}`).join(' · ')) : 'None in this period'} accentColor="#22d3ee" />
                </div>
              </div>
            );
          })()}

          {/* ── Sessions by day ── */}
          {chartData.length > 1 && (
            <Card className="mb-6">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Sessions by Day</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trafficSessions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={tickInterval} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} formatter={(v) => n(Number(v) || 0)} />
                  <Area type="monotone" dataKey="Sessions" stroke="#818cf8" strokeWidth={2} fill="url(#trafficSessions)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* ── Bot vs human ── */}
          {data.quality && (
            <Card className="mb-6" accentColor={data.quality.suspectedBot > 0 ? '#f59e0b' : '#34d399'}>
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-gray-800">Bot &amp; Low-Intent Traffic</h3>
                <p className="text-[11px] text-gray-400">Shopify drops known crawlers before counting; this catches what slips through</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[11px] text-gray-400 uppercase font-semibold">Shopify sessions</p>
                  <p className="text-lg font-bold text-gray-800">{n(totals.sessions)}</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <p className="text-[11px] text-amber-600 uppercase font-semibold">Suspected bot</p>
                  <p className="text-lg font-bold text-amber-700">{n(data.quality.suspectedBot)} <span className="text-xs font-semibold">({share(data.quality.suspectedBot, totals.sessions)})</span></p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <p className="text-[11px] text-emerald-600 uppercase font-semibold">Likely human</p>
                  <p className="text-lg font-bold text-emerald-700">{n(data.quality.humanSessions)}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <p className="text-[11px] text-emerald-600 uppercase font-semibold">Human conversion</p>
                  <p className="text-lg font-bold text-emerald-700">{pct(data.quality.humanCompleted, data.quality.humanSessions)} <span className="text-xs font-semibold text-emerald-600">vs {pct(totals.completed, totals.sessions)} raw</span></p>
                </div>
              </div>
              {data.quality.flags.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing looks automated in this period: every source with meaningful volume had shoppers adding to cart.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="border-b border-gray-100"><TH>Flagged</TH><TH>What</TH><TH>Why it looks automated</TH><TH right>Sessions</TH></tr></thead>
                    <tbody>
                      {data.quality.flags.slice(0, 15).map((f, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD><span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{f.kind}</span></TD>
                          <TD mono className="break-all text-gray-700">{f.label}</TD>
                          <TD className="text-xs text-gray-500">{f.reason}</TD>
                          <TD right>{n(f.sessions)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-3">How it works: ShopifyQL has no bot flag, so a source is flagged when it sends a real volume of sessions in which nobody ever adds to cart or checks out. Only flagged sources are subtracted from the human count; flagged landing pages, devices and countries overlap them and are shown as evidence. Real people who only browse can be caught too, so treat this as a floor, not an exact split.</p>
            </Card>
          )}

          {/* ── Channels ── */}
          <Card className="mb-6">
            <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
              <h3 className="text-sm font-bold text-gray-800">Traffic by Channel</h3>
              <p className="text-[11px] text-gray-400">Sessions grouped by Shopify referrer + the UTM medium on the link</p>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden mb-4 bg-gray-100">
              {(data.channels || []).map(c => (
                <div key={c.channel} title={`${c.channel}: ${n(c.sessions)} sessions`} style={{ width: `${(c.sessions / Math.max(1, data.quality?.humanSessions ?? totalSessions)) * 100}%`, background: CHANNEL_COLORS[c.channel] }} />
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead><tr className="border-b border-gray-100">
                  <TH>Channel</TH><TH>Top sources</TH><TH right>Sessions</TH><TH right>Share</TH><TH right>Orders</TH><TH right>CVR</TH>
                </tr></thead>
                <tbody>
                  {(data.channels || []).map(c => (
                    <tr key={c.channel} className="border-b border-gray-50">
                      <TD><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: CHANNEL_COLORS[c.channel] }} /><span className="font-medium text-gray-800" title={CHANNEL_HELP[c.channel]}>{c.channel}</span></TD>
                      <TD className="text-xs text-gray-500">{c.topSources.join(', ')}</TD>
                      <TD right>{n(c.sessions)}<Delta current={c.sessions} prior={compareOn ? (c.priorSessions ?? 0) : undefined} /></TD>
                      <TD right className="text-gray-500">{share(c.sessions, data.quality?.humanSessions ?? totalSessions)}</TD>
                      <TD right>{n(c.completed)}</TD>
                      <TD right className={c.sessions > 200 && c.completed / c.sessions > (totals.completed / Math.max(1, data.quality?.humanSessions ?? totals.sessions)) ? 'text-green-600 font-semibold' : 'text-gray-600'}>{pct(c.completed, c.sessions)}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Orders here = sessions that completed checkout, Shopify&apos;s session-level count. Hover a channel name for how it is defined.</p>
          </Card>

          {/* ── Ads + organic posts ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">By Ad</h3>
                <p className="text-[11px] text-gray-400">utm_campaign · utm_content on the ad link</p>
              </div>
              {(data.ads || []).length === 0 ? <Empty text="No ad-tagged sessions in this period. Ads need utm_medium=paid (or a cpm_ / cpc medium) on their link." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="border-b border-gray-100"><TH>Ad</TH><TH right>Sessions</TH><TH right>Orders</TH><TH right>CVR</TH><TH right>Spend</TH></tr></thead>
                    <tbody>
                      {(showAllAds ? data.ads! : data.ads!.slice(0, 12)).map((a, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD>
                            <p className="font-medium text-gray-800 text-xs md:text-sm break-words">{adLabel(a)}</p>
                            <p className="text-[11px] text-gray-400 break-words">{[a.platform, campaignLabel(a), a.medium].filter(Boolean).join(' · ')}</p>
                          </TD>
                          <TD right>{n(a.sessions)}</TD><TD right>{n(a.completed)}</TD><TD right className="text-gray-600">{pct(a.completed, a.sessions)}</TD>
                          <TD right className="text-gray-600">{a.spend !== undefined ? $(a.spend) : '—'}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.ads!.length > 12 && (
                    <button onClick={() => setShowAllAds(v => !v)} className="text-xs text-violet-600 font-medium mt-2">{showAllAds ? 'Show fewer' : `Show all ${data.ads!.length}`}</button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-3">Ad names and spend are matched from the ad platform when the link carries the ad ID or exact ad name. Spend is the ad&apos;s total for the period, all placements.</p>
            </Card>

            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">Organic Posts &amp; Tagged Links</h3>
                <p className="text-[11px] text-gray-400">UTM-tagged, not paid or email</p>
              </div>
              {(data.organicPosts || []).length === 0 ? <Empty text="No tagged organic links yet. Add ?utm_source=instagram&utm_medium=organic&utm_content=<post> to bio and post links and they show up here." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead><tr className="border-b border-gray-100"><TH>Link tag</TH><TH right>Sessions</TH><TH right>Orders</TH><TH right>CVR</TH></tr></thead>
                    <tbody>
                      {data.organicPosts!.slice(0, 15).map((a, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD>
                            <p className="font-medium text-gray-800 text-xs md:text-sm break-words">{a.content || a.campaign}</p>
                            <p className="text-[11px] text-gray-400 break-words">{[a.campaign !== a.content ? a.campaign : '', a.medium].filter(Boolean).join(' · ')}</p>
                          </TD>
                          <TD right>{n(a.sessions)}</TD><TD right>{n(a.completed)}</TD><TD right className="text-gray-600">{pct(a.completed, a.sessions)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(data.otherTagged || []).length > 0 && (
                <p className="text-[11px] text-gray-400 mt-3">{data.otherTagged!.length} other tagged link{data.otherTagged!.length === 1 ? '' : 's'} (medium: {Array.from(new Set(data.otherTagged!.map(t => t.medium))).slice(0, 4).join(', ')}) not shown.</p>
              )}
              <p className="text-[11px] text-gray-400 mt-3">Post-level reach, saves, follows and profile visits come from Instagram / Pinterest / TikTok directly and will appear here once those feeds are connected.</p>
            </Card>
          </div>

          {/* ── Referring websites + AI ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">Referring Websites</h3>
                <p className="text-[11px] text-gray-400">Other sites linking in · social, search, email excluded</p>
              </div>
              {(data.referrers || []).length === 0 ? <Empty text="No outside websites sent traffic in this period." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead><tr className="border-b border-gray-100"><TH>Website</TH><TH right>Sessions</TH><TH right>Orders</TH><TH right>CVR</TH></tr></thead>
                    <tbody>
                      {(showAllRefs ? data.referrers! : data.referrers!.slice(0, 12)).map((r, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD mono className="break-all text-gray-700">{r.url}</TD>
                          <TD right>{n(r.sessions)}</TD><TD right>{n(r.completed)}</TD><TD right className="text-gray-600">{pct(r.completed, r.sessions)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.referrers!.length > 12 && (
                    <button onClick={() => setShowAllRefs(v => !v)} className="text-xs text-violet-600 font-medium mt-2">{showAllRefs ? 'Show fewer' : `Show all ${data.referrers!.length}`}</button>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">AI Assistants</h3>
                <p className="text-[11px] text-gray-400">ChatGPT, Perplexity, Gemini, Copilot, Claude</p>
              </div>
              {(data.ai?.pages || []).length === 0 ? <Empty text="No visits from AI assistants in this period." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead><tr className="border-b border-gray-100"><TH>Assistant</TH><TH>Page they sent people to</TH><TH right>Sessions</TH><TH right>Orders</TH></tr></thead>
                    <tbody>
                      {data.ai!.pages.slice(0, 15).map((r, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD className="font-medium text-gray-800 capitalize">{r.assistant}</TD>
                          <TD mono className="break-all text-gray-700">{r.landingPage}</TD>
                          <TD right>{n(r.sessions)}</TD><TD right>{n(r.completed)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-3">Assistants do not pass the question that was asked, only the page they linked. The landing page is the best clue to what the visitor was looking for.</p>
            </Card>
          </div>

          {/* ── Blog + landing pages ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 mb-6">
            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">Blog Posts</h3>
                <p className="text-[11px] text-gray-400">Sessions that started on a blog article</p>
              </div>
              {(data.blog || []).length === 0 ? <Empty text={`No sessions started on a /blogs/ page of ${client.siteDomain} in this period.`} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead><tr className="border-b border-gray-100"><TH>Article</TH><TH right>Sessions</TH><TH right>Orders</TH><TH right>CVR</TH></tr></thead>
                    <tbody>
                      {data.blog!.slice(0, 15).map((r, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <TD mono className="break-all text-gray-700">{r.path.replace(/^\/blogs\//, '')}</TD>
                          <TD right>{n(r.sessions)}</TD><TD right>{n(r.completed)}</TD><TD right className="text-gray-600">{pct(r.completed, r.sessions)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">Top Landing Pages</h3>
                <p className="text-[11px] text-gray-400">First page of the session</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[440px]">
                  <thead><tr className="border-b border-gray-100"><TH>Page</TH><TH right>Sessions</TH><TH right>Orders</TH><TH right>CVR</TH></tr></thead>
                  <tbody>
                    {(data.landingPages || []).slice(0, 12).map((r, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <TD mono className="break-all text-gray-700">{r.path}</TD>
                        <TD right>{n(r.sessions)}</TD><TD right>{n(r.completed)}</TD><TD right className="text-gray-600">{pct(r.completed, r.sessions)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* ── Orders by source + device/country ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6 mb-6">
            <Card className="xl:col-span-2">
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <h3 className="text-sm font-bold text-gray-800">Orders by Source</h3>
                <p className="text-[11px] text-gray-400">Shopify&apos;s order referrer · net sales after discounts and returns</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead><tr className="border-b border-gray-100"><TH>Source</TH><TH right>Orders</TH><TH right>Share</TH><TH right>Net Sales</TH><TH right>Per Order</TH></tr></thead>
                  <tbody>
                    {(data.orderSources || []).slice(0, 14).map((r, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <TD className="font-medium text-gray-800 capitalize">{orderSourceLabel(r.source, r.name)}</TD>
                        <TD right>{n(r.orders)}</TD>
                        <TD right className="text-gray-500">{share(r.orders, totalOrdersBySource)}</TD>
                        <TD right>{$(r.netSales)}</TD>
                        <TD right className="text-gray-600">{r.orders > 0 ? $(r.netSales / r.orders) : '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">{n(totalOrdersBySource)} orders · {$(totalNetBySource)} net. Shopify credits the order to the session that placed it, so a customer who first came from an ad and returned later by typing the address counts as Direct here.</p>
            </Card>
            <div className="grid grid-cols-2 xl:grid-cols-1 gap-4 md:gap-6">
              <Card>
                <h3 className="text-sm font-bold text-gray-800 mb-2">Device</h3>
                {(data.devices || []).map(d => (
                  <div key={d.device} className="flex justify-between text-sm py-1 border-b border-gray-50"><span className="capitalize text-gray-700">{d.device}</span><span className="tabular-nums text-gray-600">{share(d.sessions, totalSessions)}</span></div>
                ))}
              </Card>
              <Card>
                <h3 className="text-sm font-bold text-gray-800 mb-2">Country</h3>
                {(data.countries || []).slice(0, 6).map(c => (
                  <div key={c.country} className="flex justify-between text-sm py-1 border-b border-gray-50"><span className="text-gray-700 truncate pr-2">{c.country}</span><span className="tabular-nums text-gray-600">{share(c.sessions, totalSessions)}</span></div>
                ))}
              </Card>
            </div>
          </div>

          {(data.errors || []).length > 0 && (
            <p className="text-[11px] text-amber-600 mb-4">Some sections could not load: {data.errors!.join(' · ')}</p>
          )}
          <p className="text-[11px] text-gray-400">Source: Shopify sessions report, live. A session is a visit; one visitor can have several. Numbers match Shopify Analytics → Sessions by referrer / UTM / landing page for the same dates.</p>
        </>
      )}
    </div>
  );
}
