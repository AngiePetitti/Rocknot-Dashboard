'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Timeframe } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';

interface CreativePerformance {
  id: string;
  name: string;
  platform: 'Meta' | 'TikTok';
  thumbnailUrl: string | null;
  adUrl: string | null;
  campaign: string;
  adset: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
}

type SortKey = 'spend' | 'roas' | 'ctr' | 'impressions';
type PlatformFilter = 'all' | 'Meta' | 'TikTok';

export default function CreativesContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const [creatives, setCreatives] = useState<CreativePerformance[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'empty' | 'error'>('loading');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');

  useEffect(() => {
    setStatus('loading');
    fetch(`/api/windsor/creatives?tf=${tf}`)
      .then(r => r.json())
      .then(data => {
        const list: CreativePerformance[] = data.creatives || [];
        setCreatives(list);
        setStatus(list.length > 0 ? 'live' : 'empty');
      })
      .catch(() => setStatus('error'));
  }, [tf]);

  const filtered = creatives
    .filter(c => platformFilter === 'all' || c.platform === platformFilter)
    .sort((a, b) => b[sortKey] - a[sortKey]);

  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.revenue, 0);
  const blendedROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  return (
    <div>
      <Header title="Creative Analysis" subtitle={`Meta & TikTok creatives · ${TIMEFRAME_LABELS[tf] || tf}`}>
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
          {(['all', 'Meta', 'TikTok'] as PlatformFilter[]).map(p => (
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
            { key: 'impressions', label: 'Impressions' },
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
            <Card key={`${creative.platform}-${creative.id}`} className="overflow-hidden !p-0">
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
                {/* Link to ad manager */}
                {creative.adUrl && (
                  <a
                    href={creative.adUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 bg-white/90 hover:bg-white text-gray-600 hover:text-gray-900 rounded-lg px-2 py-1 text-xs font-semibold shadow-sm transition-colors flex items-center gap-1"
                  >
                    View ↗
                  </a>
                )}
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
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Impressions</p>
                    <p className="text-gray-700 font-bold">{creative.impressions.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 uppercase font-semibold mb-0.5">Clicks</p>
                    <p className="text-gray-700 font-bold">{creative.clicks.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
