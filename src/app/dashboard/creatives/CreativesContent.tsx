'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Timeframe } from '@/src/lib/mockData';
import { cachedJson } from '@/src/lib/clientCache';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';

interface CreativePerformance {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok' | 'Snapchat';
  thumbnailUrl: string | null;
  videoUrl: string | null;
  previewUrl?: string | null;
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

type SortKey = 'spend' | 'roas' | 'ctr' | 'conversions';
type PlatformFilter = 'all' | 'Meta' | 'TikTok' | 'Snapchat';

export default function CreativesContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const [creatives, setCreatives] = useState<CreativePerformance[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'empty' | 'error'>('loading');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [selected, setSelected] = useState<CreativePerformance | null>(null);

  useEffect(() => {
    setStatus('loading');
    // Session-cached: a previously loaded timeframe renders instantly and
    // refreshes quietly in the background (same pattern as the other tabs).
    cachedJson<{ creatives?: CreativePerformance[] }>(
      `/api/windsor/creatives?tf=${tf}`,
      data => {
        const list: CreativePerformance[] = data.creatives || [];
        setCreatives(list);
        setStatus(list.length > 0 ? 'live' : 'empty');
      },
      () => setStatus('error')
    );
  }, [tf]);

  const filtered = creatives
    .filter(c => platformFilter === 'all' || c.platform === platformFilter)
    .sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.revenue, 0);
  const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const totalImpressions = filtered.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.clicks, 0);
  const totalConversions = filtered.reduce((s, c) => s + (c.conversions ?? 0), 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCostPerConv = totalConversions > 0 ? totalSpend / totalConversions : 0;

  return (
    <div>
      <Header title="Creative Analysis" subtitle={`Meta, TikTok & Snapchat creatives · ${TIMEFRAME_LABELS[tf] || tf}`}>
        <TimeframeSelector />
      </Header>

      {/* Summary */}
      {status === 'live' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card accentColor="#818cf8">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Creatives</p>
            <p className="text-xl font-bold text-gray-800">{filtered.length}</p>
          </Card>
          <Card accentColor="#f9a8d4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Total Spend</p>
            <p className="text-xl font-bold text-gray-800">{formatCurrency(totalSpend)}</p>
          </Card>
          <Card accentColor="#c4b5fd">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Attributed Revenue</p>
            <p className="text-xl font-bold text-gray-800">{formatCurrency(totalRevenue)}</p>
          </Card>
          <Card accentColor="#86efac">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Blended ROAS</p>
            <p className="text-xl font-bold" style={{ color: blendedROAS >= 3.5 ? '#22c55e' : '#ef4444' }}>
              {formatROAS(blendedROAS)}
            </p>
          </Card>
        </div>
      )}

      {/* Filters */}
      {status === 'live' && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {(['all', 'Meta', 'TikTok', 'Snapchat'] as PlatformFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                platformFilter === p
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {p === 'all' ? 'All Platforms' : p}
            </button>
          ))}
          <span className="text-xs text-gray-300 mx-1">|</span>
          <span className="text-xs text-gray-400 mr-1">Sort by</span>
          {([
            { key: 'spend', label: 'Spend' },
            { key: 'roas', label: 'ROAS' },
            { key: 'ctr', label: 'CTR' },
            { key: 'conversions', label: 'Conversions' },
          ] as { key: SortKey; label: string }[]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                sortKey === opt.key
                  ? 'bg-purple-100 text-purple-700 border-purple-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {status === 'loading' && (
        <Card>
          <p className="text-sm text-gray-400 text-center py-12">Loading creative data from Windsor…</p>
        </Card>
      )}

      {/* Error / Empty */}
      {(status === 'empty' || status === 'error') && (
        <Card accentColor="#fde68a">
          <div className="text-center py-10">
            <p className="text-2xl mb-2">🎨</p>
            <p className="text-sm font-bold text-gray-700 mb-1">No creative-level data available yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              {status === 'error'
                ? "We couldn't reach Windsor for creative data. Try refreshing in a bit."
                : "Windsor hasn't returned ad-level creative data for this period yet — this can take a sync cycle or two after creatives go live, or may require enabling creative-level fields on your Meta/TikTok connections in Windsor."}
            </p>
          </div>
        </Card>
      )}

      {/* Creative Grid */}
      {status === 'live' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(creative => (
            <div
              key={`${creative.platform}-${creative.id}`}
              onClick={() => setSelected(creative)}
              className="cursor-pointer transition-transform hover:-translate-y-0.5"
            >
            <Card className="overflow-hidden !p-0">
              {/* Thumbnail / placeholder */}
              <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden relative">
                {creative.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={creative.thumbnailUrl}
                    alt={creative.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="w-full h-full items-center justify-center text-gray-300 text-3xl"
                  style={{ display: creative.thumbnailUrl ? 'none' : 'flex' }}
                >
                  🎨
                </div>
                {/* Platform badge overlay */}
                <div className="absolute top-2 left-2">
                  <PlatformBadge platform={creative.platform} />
                </div>
                {/* Open in-dashboard breakdown */}
                <span className="absolute top-2 right-2 bg-white/90 text-gray-600 rounded-lg px-2 py-1 text-xs font-semibold shadow-sm flex items-center gap-1">
                  Analyze
                </span>
              </div>

              <div className="p-4">
                {/* Ad name */}
                <p className="text-sm font-bold text-gray-800 leading-snug line-clamp-2 mb-1">{creative.name}</p>

                {/* Campaign / adset */}
                {creative.campaign && (
                  <p className="text-xs text-gray-400 line-clamp-1 mb-0.5">
                    <span className="font-semibold text-gray-500">Campaign:</span> {creative.campaign}
                  </p>
                )}
                {creative.adset && (
                  <p className="text-xs text-gray-400 line-clamp-1 mb-3">
                    <span className="font-semibold text-gray-500">Ad Set:</span> {creative.adset}
                  </p>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Spend</p>
                    <p className="text-gray-700 font-bold">{formatCurrency(creative.spend)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Revenue</p>
                    <p className="text-gray-700 font-bold">{formatCurrency(creative.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">ROAS</p>
                    <p className="font-bold" style={{ color: creative.roas >= 3.5 ? '#22c55e' : '#ef4444' }}>
                      {formatROAS(creative.roas)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">CTR</p>
                    <p className="text-gray-700 font-bold">{formatPercent(creative.ctr)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Conversions</p>
                    <p className="text-gray-700 font-bold">{(creative.conversions ?? 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Cost / Conv</p>
                    <p className="text-gray-700 font-bold">{creative.costPerConversion ? formatCurrency(creative.costPerConversion) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                    <p className="text-gray-700 font-bold">{creative.clicks.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </Card>
            </div>
          ))}
        </div>
      )}

      {/* Creative detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Preview */}
            <div className={`${!selected.videoUrl && selected.previewUrl ? 'h-[500px]' : 'aspect-video'} bg-gray-100 flex items-center justify-center overflow-hidden relative rounded-t-2xl`}>
              {selected.videoUrl ? (
                <video
                  src={selected.videoUrl}
                  poster={selected.thumbnailUrl ?? undefined}
                  controls
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-gray-900"
                />
              ) : selected.previewUrl ? (
                // Meta's official ad-preview embed — plays the real creative
                // when the raw video file is permission-gated.
                <iframe
                  src={selected.previewUrl}
                  className="w-full h-full border-0 bg-gray-900"
                  allow="autoplay; encrypted-media"
                  scrolling="no"
                  title={selected.name}
                />
              ) : selected.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.thumbnailUrl} alt={selected.name} className="w-full h-full object-contain bg-gray-900" />
              ) : (
                <span className="text-gray-300 text-5xl">🎨</span>
              )}
              <div className="absolute top-3 left-3">
                <PlatformBadge platform={selected.platform} />
              </div>
              <button
                onClick={() => setSelected(null)}
                className="absolute top-3 right-3 bg-white/90 hover:bg-white text-gray-600 hover:text-gray-900 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-6">
              <p className="text-base font-bold text-gray-800 leading-snug mb-1">{selected.name}</p>
              {selected.campaign && (
                <p className="text-xs text-gray-400 mb-0.5">
                  <span className="font-semibold text-gray-500">Campaign:</span> {selected.campaign}
                </p>
              )}
              {selected.adset && (
                <p className="text-xs text-gray-400 mb-4">
                  <span className="font-semibold text-gray-500">Ad Set:</span> {selected.adset}
                </p>
              )}

              {/* Headline metrics vs account average for the period */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {([
                  { label: 'ROAS', value: formatROAS(selected.roas), avg: blendedROAS, actual: selected.roas, higherIsBetter: true },
                  { label: 'CTR', value: formatPercent(selected.ctr), avg: avgCTR, actual: selected.ctr, higherIsBetter: true },
                  { label: 'Cost / Conv', value: selected.costPerConversion ? formatCurrency(selected.costPerConversion) : '—', avg: avgCostPerConv, actual: selected.costPerConversion ?? 0, higherIsBetter: false },
                ]).map(m => {
                  const hasComparison = m.avg > 0 && m.actual > 0;
                  const deltaPct = hasComparison ? ((m.actual - m.avg) / m.avg) * 100 : 0;
                  const good = m.higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;
                  return (
                    <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{m.label}</p>
                      <p className="text-lg font-bold text-gray-800">{m.value}</p>
                      {hasComparison && (
                        <p className="text-[11px] font-semibold" style={{ color: good ? '#22c55e' : '#ef4444' }}>
                          {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(0)}% vs avg
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Full breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs mb-5">
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Spend</p>
                  <p className="text-gray-700 font-bold text-sm">{formatCurrency(selected.spend)}</p>
                  <p className="text-[10px] text-gray-400">{totalSpend > 0 ? `${((selected.spend / totalSpend) * 100).toFixed(1)}% of total` : ''}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Revenue</p>
                  <p className="text-gray-700 font-bold text-sm">{formatCurrency(selected.revenue)}</p>
                  <p className="text-[10px] text-gray-400">{totalRevenue > 0 ? `${((selected.revenue / totalRevenue) * 100).toFixed(1)}% of total` : ''}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Conversions</p>
                  <p className="text-gray-700 font-bold text-sm">{(selected.conversions ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Impressions</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.impressions.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.clicks.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 uppercase font-semibold mb-0.5">CPC</p>
                  <p className="text-gray-700 font-bold text-sm">{selected.clicks > 0 ? formatCurrency(selected.spend / selected.clicks) : '—'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <p className="text-[11px] text-gray-400">Period: {TIMEFRAME_LABELS[tf] || tf}</p>
                {selected.adUrl && (
                  <a
                    href={selected.adUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-lg px-3 py-2 transition-colors"
                  >
                    Open in {selected.platform === 'Meta' ? 'Ads Manager' : selected.platform === 'Snapchat' ? 'Snapchat Ads' : 'TikTok Ads'} ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
