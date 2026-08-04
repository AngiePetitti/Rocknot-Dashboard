'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Timeframe } from '@/src/lib/mockData';
import { cachedJson } from '@/src/lib/clientCache';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';
import ROASChart from '@/src/components/charts/ROASChart';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from 'recharts';

interface PlatformData {
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions?: number;
  costPerConversion?: number;
  color: string;
}

interface DaySpend {
  date: string;
  meta: number;
  google: number;
  tiktok: number;
  snapchat?: number;
}

interface CreativeRow {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok' | 'Snapchat';
  adUrl: string | null;
  campaign: string;
  adset: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
  conversions?: number;
  costPerConversion?: number;
}

type AdSortKey = 'name' | 'platform' | 'spend' | 'roas' | 'ctr' | 'conversions' | 'costPerConversion' | 'clicks';

interface ReconcilePlatform {
  platform: string;
  dashboardSpend: number;
  referenceSpend: number | null;
  referenceSource: string;
  diff: number | null;
  diffPct: number | null;
  status: 'ok' | 'warn' | 'unavailable';
}
interface ReconcileResult {
  range: { from: string; to: string };
  allOk: boolean;
  platforms: ReconcilePlatform[];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AdsContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const tf = (tfRaw === 'custom' ? '30d' : tfRaw) as Timeframe;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [platforms, setPlatforms] = useState<PlatformData[]>([]);
  const [dailySpend, setDailySpend] = useState<DaySpend[]>([]);
  const [creatives, setCreatives] = useState<CreativeRow[]>([]);
  const [creativesLoading, setCreativesLoading] = useState(true);
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [adSort, setAdSort] = useState<{ key: AdSortKey; dir: 'asc' | 'desc' }>({ key: 'spend', dir: 'desc' });
  const [adPlatformFilter, setAdPlatformFilter] = useState<'All' | CreativeRow['platform']>('All');
  const [showAllAds, setShowAllAds] = useState(false);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const [cac, setCac] = useState<{ newCustomers: number; returningCustomers: number; totalAdSpend: number } | null>(null);

  useEffect(() => {
    setStatus('loading');
    const adsParams = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) adsParams.set('date_from', dateFrom);
    if (dateTo) adsParams.set('date_to', dateTo);

    // Each section loads independently so the page appears as soon as the
    // platform numbers are in — the slower creative analysis fills in after.
    // Previously-loaded views render instantly from the session cache and
    // refresh in the background.
    cachedJson<{ platforms?: PlatformData[]; dailySpend?: DaySpend[] }>(
      `/api/windsor/ads?${adsParams}`,
      adsData => {
        setPlatforms(adsData.platforms || []);
        setDailySpend(adsData.dailySpend || []);
        setStatus('live');
      },
      () => setStatus('error')
    );

    setCreativesLoading(true);
    const hadCreativesCache = cachedJson<{ creatives?: CreativeRow[] }>(
      `/api/windsor/creatives?tf=${tfRaw}`,
      creativesData => {
        setCreatives((creativesData.creatives || []).slice(0, 100));
        setCreativesLoading(false);
      },
      () => setCreativesLoading(false)
    );
    if (hadCreativesCache) setCreativesLoading(false);

    // Customer counts (for CAC) come from the overview endpoint, same timeframe.
    cachedJson<{ metrics?: { newCustomers?: number; returningCustomers?: number; totalAdSpend?: number } }>(
      `/api/windsor?${adsParams}`,
      overviewData => {
        const m = overviewData?.metrics;
        setCac(m && m.newCustomers !== undefined
          ? { newCustomers: m.newCustomers ?? 0, returningCustomers: m.returningCustomers ?? 0, totalAdSpend: m.totalAdSpend ?? 0 }
          : null);
      },
      () => setCac(null)
    );
  }, [tfRaw, dateFrom, dateTo]);

  // Reconciliation self-check runs over its own trailing window of complete
  // days (independent of the selected timeframe), so it loads once on mount.
  useEffect(() => {
    fetch('/api/windsor/reconcile')
      .then(r => r.json())
      .then((data: ReconcileResult) => { if (Array.isArray(data?.platforms)) setReconcile(data); })
      .catch(() => {});
  }, []);

  const totalSpend = platforms.reduce((s, p) => s + p.spend, 0);
  const totalRevenue = platforms.reduce((s, p) => s + p.revenue, 0);
  const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const bestPlatform = platforms.length > 0 ? platforms.reduce((b, p) => p.roas > b.roas ? p : b) : null;

  const sortedCreatives = [...creatives]
    .filter(ad => adPlatformFilter === 'All' || ad.platform === adPlatformFilter)
    .sort((a, b) => {
      const dir = adSort.dir === 'desc' ? -1 : 1;
      if (adSort.key === 'name' || adSort.key === 'platform') {
        return a[adSort.key].localeCompare(b[adSort.key]) * dir;
      }
      return ((a[adSort.key] ?? 0) - (b[adSort.key] ?? 0)) * dir;
    });
  const visibleCreatives = showAllAds ? sortedCreatives : sortedCreatives.slice(0, 15);
  const adPlatforms: Array<'All' | CreativeRow['platform']> =
    ['All', ...Array.from(new Set(creatives.map(c => c.platform)))];
  const PLATFORM_CHIP_COLORS: Record<string, string> = { Meta: '#818cf8', TikTok: '#f472b6', Snapchat: '#eab308' };

  const subtitle = tfRaw === 'custom' && dateFrom && dateTo
    ? `Ad Performance · ${dateFrom} → ${dateTo}`
    : `Ad Performance · ${TIMEFRAME_LABELS[tf] || tf}`;

  // Simple dynamic recommendations based on live ROAS
  const recommendations = platforms
    .filter(p => p.spend > 0)
    .map(p => {
      if (p.roas >= 4) return { platform: p, msg: `Scale budget — ROAS of ${formatROAS(p.roas)} is well above the 3.5x goal.`, type: 'scale' };
      if (p.roas >= 3.5) return { platform: p, msg: `Maintain current spend — ROAS is at ${formatROAS(p.roas)}, right at goal.`, type: 'maintain' };
      if (p.roas >= 2) return { platform: p, msg: `Optimize creatives — ROAS of ${formatROAS(p.roas)} is below goal. Test new ad formats.`, type: 'optimize' };
      return { platform: p, msg: `Review campaigns — ROAS of ${formatROAS(p.roas)} needs immediate attention. Pause low performers.`, type: 'pause' };
    });

  const recColors: Record<string, string> = { scale: '#86efac', maintain: '#93c5fd', optimize: '#fde68a', pause: '#fca5a5' };

  // Compact daily spend chart — show last N days depending on timeframe
  const chartData = dailySpend.map(d => ({
    date: formatDate(d.date),
    Meta: d.meta,
    Google: d.google,
    TikTok: d.tiktok,
    Snapchat: d.snapchat ?? 0,
  }));

  const hasSpend = dailySpend.some(d => d.meta > 0 || d.google > 0 || d.tiktok > 0 || (d.snapchat ?? 0) > 0);

  return (
    <div>
      <Header title="Ad Performance" subtitle={subtitle}>
        <TimeframeSelector />
      </Header>

      {reconcile && (() => {
        const warns = reconcile.platforms.filter(p => p.status === 'warn');
        const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
        if (warns.length === 0) {
          return (
            <div className="mb-4 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              <span>✓</span>
              <span>
                Ad spend reconciled against Meta Ads Manager &amp; Windsor for {reconcile.range.from} → {reconcile.range.to} — all platforms match.
              </span>
            </div>
          );
        }
        return (
          <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="font-semibold mb-1">⚠ Ad spend may be off (checked {reconcile.range.from} → {reconcile.range.to})</p>
            <ul className="space-y-0.5">
              {warns.map(p => (
                <li key={p.platform}>
                  <span className="font-medium">{p.platform}:</span> dashboard {fmt(p.dashboardSpend)} vs {p.referenceSource} {fmt(p.referenceSpend ?? 0)}
                  {p.diff !== null && <> ({p.diff > 0 ? '+' : ''}{fmt(p.diff)}, {p.diffPct}%)</>}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {status === 'loading' && (
        <Card><p className="text-sm text-gray-400 text-center py-12">Loading ad performance data…</p></Card>
      )}

      {status === 'error' && (
        <Card accentColor="#fca5a5">
          <p className="text-sm text-center text-gray-500 py-8">Couldn't load ad data. Try refreshing.</p>
        </Card>
      )}

      {status === 'live' && (
        <>
          {/* Top Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard
              title="Total Ad Spend"
              value={formatCurrency(totalSpend)}
              subtitle="All platforms combined"
              accentColor="#f9a8d4"
            />
            <MetricCard
              title="Ad-Attributed Revenue"
              value={formatCurrency(totalRevenue)}
              subtitle="ROAS × Spend (Meta) + Conv. Value (Google)"
              accentColor="#c4b5fd"
            />
            <MetricCard
              title="Blended ROAS"
              value={formatROAS(blendedROAS)}
              subtitle="Revenue / Spend"
              accentColor="#86efac"
              valueColor={blendedROAS >= 3.5 ? '#22c55e' : '#ef4444'}
            />
            <MetricCard
              title="Best Platform"
              value={bestPlatform ? formatROAS(bestPlatform.roas) : '—'}
              subtitle={bestPlatform?.platform || 'No data'}
              accentColor="#fde68a"
            />
          </div>

          {/* CAC — acquisition cost for the period (hidden on Today: the
              new/returning split hasn't settled mid-day) */}
          {cac && cac.newCustomers > 0 && tfRaw !== 'today' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <MetricCard
                title="New Customer CAC"
                value={cac.newCustomers ? formatCurrency(cac.totalAdSpend / cac.newCustomers) : '—'}
                subtitle={`Ad spend ÷ ${cac.newCustomers} new customers · target $100`}
                accentColor="#c7d2fe"
                valueColor={cac.newCustomers
                  ? (cac.totalAdSpend / cac.newCustomers > 100 ? '#ef4444' : '#22c55e')
                  : undefined}
              />
              <MetricCard
                title="Blended CAC"
                value={cac.newCustomers + cac.returningCustomers > 0
                  ? formatCurrency(cac.totalAdSpend / (cac.newCustomers + cac.returningCustomers))
                  : '—'}
                subtitle={`Ad spend ÷ ${cac.newCustomers + cac.returningCustomers} all buyers`}
                accentColor="#bbf7d0"
              />
            </div>
          )}

          {/* Platform cards */}
          <div className={`grid gap-4 mb-6 ${platforms.length === 1 ? 'grid-cols-1 max-w-sm' : platforms.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {platforms.map(p => (
              <Card key={p.platform} accentColor={p.color}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="font-bold text-gray-800 text-sm">{p.platform}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Spend</p>
                    <p className="font-bold text-gray-800">{formatCurrency(p.spend)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">ROAS</p>
                    {p.revenue > 0 ? (
                      <p className="font-bold" style={{ color: p.roas >= 3.5 ? '#22c55e' : '#ef4444' }}>{formatROAS(p.roas)}</p>
                    ) : (
                      <p className="font-bold text-gray-400" title="No purchase value reported for this platform">—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Conversions</p>
                    <p className="font-bold text-gray-800">{(p.conversions ?? 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Cost / Conv</p>
                    <p className="font-bold text-gray-800">{p.costPerConversion ? formatCurrency(p.costPerConversion) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                    <p className="font-bold text-gray-800">{p.clicks.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Revenue</p>
                    <p className="font-bold text-gray-800">{p.revenue > 0 ? formatCurrency(p.revenue) : <span className="text-gray-400" title="No purchase value reported for this platform">—</span>}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
            <Card accentColor="#c4b5fd">
              <h2 className="text-sm font-bold text-gray-700 mb-1">ROAS by Platform</h2>
              <p className="text-xs text-gray-400 mb-4">Red dashed line = 3.5x goal</p>
              <ROASChart data={platforms} goalLine={3.5} />
            </Card>

            <Card accentColor="#f9a8d4">
              <h2 className="text-sm font-bold text-gray-700 mb-1">Spend by Platform</h2>
              <p className="text-xs text-gray-400 mb-4">Total: {formatCurrency(totalSpend)}</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={platforms.map(p => ({ platform: p.platform, spend: p.spend, color: p.color }))} barSize={48}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="platform" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} width={40} />
                  <Tooltip formatter={(v: unknown) => [formatCurrency(Number(v)), 'Spend']} contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="spend" radius={[6, 6, 0, 0]}>
                    {platforms.map((p, i) => <Cell key={i} fill={p.color} opacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Daily Spend Trend */}
          {hasSpend && chartData.length > 1 && (
            <Card accentColor="#93c5fd" className="mb-6">
              <h2 className="text-sm font-bold text-gray-700 mb-1">Daily Spend Trend</h2>
              <p className="text-xs text-gray-400 mb-4">Spend per platform over the selected period</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} width={40} />
                  <Tooltip formatter={(v: unknown) => [formatCurrency(Number(v)), '']} contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {platforms.some(p => p.platform === 'Meta') && <Line type="monotone" dataKey="Meta" stroke="#818cf8" strokeWidth={2} dot={false} />}
                  {platforms.some(p => p.platform === 'Google') && <Line type="monotone" dataKey="Google" stroke="#34d399" strokeWidth={2} dot={false} />}
                  {platforms.some(p => p.platform === 'TikTok') && <Line type="monotone" dataKey="TikTok" stroke="#f472b6" strokeWidth={2} dot={false} />}
                  {platforms.some(p => p.platform === 'Snapchat') && <Line type="monotone" dataKey="Snapchat" stroke="#eab308" strokeWidth={2} dot={false} />}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Card accentColor="#fde68a" className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">💡</span>
                <h2 className="text-sm font-bold text-gray-700">Spend Recommendations</h2>
                <span className="text-xs bg-yellow-100 text-yellow-700 font-semibold px-2 py-0.5 rounded-full">Based on live ROAS</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {recommendations.map(rec => (
                  <div key={rec.platform.platform} className="rounded-xl p-4 border" style={{ borderColor: rec.platform.color + '33', backgroundColor: rec.platform.color + '08' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rec.platform.color }} />
                      <span className="text-xs font-bold text-gray-700">{rec.platform.platform}</span>
                      <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full text-gray-700" style={{ backgroundColor: recColors[rec.type] }}>
                        {rec.type === 'scale' ? '🚀 Scale' : rec.type === 'maintain' ? '✅ On track' : rec.type === 'optimize' ? '⚠️ Optimize' : '🛑 Review'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{rec.msg}</p>
                    <p className="text-xs text-gray-400 mt-1">Spend: {formatCurrency(rec.platform.spend)} · ROAS: {formatROAS(rec.platform.roas)}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top Ads Table */}
          {creativesLoading && creatives.length === 0 && (
            <Card accentColor="#86efac">
              <h2 className="text-sm font-bold text-gray-700 mb-4">Top Performing Ads</h2>
              <div className="animate-pulse space-y-2.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-3 bg-gray-100 rounded flex-1" />
                    <div className="h-3 bg-gray-100 rounded w-16" />
                    <div className="h-3 bg-gray-100 rounded w-12" />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Loading per-ad creative data — this is the slowest feed…</p>
            </Card>
          )}
          {creatives.length > 0 && (
            <Card accentColor="#86efac">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-sm font-bold text-gray-700">Top Performing Ads</h2>
                {/* Platform filter chips — tap to focus on one platform */}
                <div className="flex items-center gap-1.5 ml-auto">
                  {adPlatforms.map(p => {
                    const count = p === 'All' ? creatives.length : creatives.filter(c => c.platform === p).length;
                    const active = adPlatformFilter === p;
                    return (
                      <button
                        key={p}
                        onClick={() => { setAdPlatformFilter(p); setShowAllAds(false); }}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }`}
                      >
                        {p !== 'All' && (
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_CHIP_COLORS[p] }} />
                        )}
                        {p}
                        <span className={active ? 'text-purple-200' : 'text-gray-400'}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {([
                        { key: 'name', label: 'Ad Name' },
                        { key: 'platform', label: 'Platform' },
                        { key: 'spend', label: 'Spend' },
                        { key: 'roas', label: 'ROAS' },
                        { key: 'ctr', label: 'CTR' },
                        { key: 'conversions', label: 'Conv' },
                        { key: 'costPerConversion', label: 'Cost / Conv' },
                        { key: 'clicks', label: 'Clicks' },
                      ] as { key: AdSortKey; label: string }[]).map(h => (
                        <th key={h.key} className={`pb-2 px-3 whitespace-nowrap w-px ${h.key === 'name' ? 'text-left pl-0' : 'text-center'}`}>
                          <button
                            onClick={() => setAdSort(s => ({ key: h.key, dir: s.key === h.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                            className={`text-xs font-semibold uppercase transition-colors ${
                              adSort.key === h.key ? 'text-purple-600' : 'text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            {h.label}
                            {adSort.key === h.key && <span className="ml-1">{adSort.dir === 'desc' ? '↓' : '↑'}</span>}
                          </button>
                        </th>
                      ))}
                      <th className="pb-2 w-px" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCreatives.map(ad => (
                      <tr key={`${ad.platform}-${ad.id}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 pr-3">
                          <span className="font-medium text-gray-800 line-clamp-1 block">{ad.name}</span>
                          {ad.campaign && <span className="text-[10px] text-gray-400 line-clamp-1 block">{ad.campaign}</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap"><PlatformBadge platform={ad.platform} /></td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap text-gray-600">{formatCurrency(ad.spend)}</td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {ad.revenue > 0 ? (
                            <span className="font-bold" style={{ color: ad.roas >= 3.5 ? '#22c55e' : '#ef4444' }}>
                              {formatROAS(ad.roas)}
                            </span>
                          ) : (
                            <span className="font-bold text-gray-400" title="No purchase value reported">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap text-gray-600">{formatPercent(ad.ctr)}</td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap text-gray-600">{(ad.conversions ?? 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap text-gray-600">{ad.costPerConversion ? formatCurrency(ad.costPerConversion) : '—'}</td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap text-gray-600">{ad.clicks.toLocaleString()}</td>
                        <td className="py-2.5 pl-3 whitespace-nowrap">
                          {ad.adUrl && (
                            <a href={ad.adUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs font-semibold text-purple-500 hover:text-purple-700">
                              View ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedCreatives.length > 15 && (
                <button
                  onClick={() => setShowAllAds(a => !a)}
                  className="mt-3 w-full text-xs text-purple-500 hover:text-purple-700 font-semibold py-1.5 rounded-lg border border-purple-100 hover:border-purple-200 transition-colors bg-purple-50 hover:bg-purple-100"
                >
                  {showAllAds ? '↑ Show top 15' : `↓ Show all ${sortedCreatives.length} ads`}
                </button>
              )}
            </Card>
          )}

          {creatives.length === 0 && (
            <Card accentColor="#fde68a">
              <p className="text-sm text-center text-gray-500 py-6">No ad-level creative data available for this period yet.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
