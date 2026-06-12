'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Timeframe, PlatformSpend, DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import MetricCard from '@/src/components/ui/MetricCard';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import RevenueChart from '@/src/components/charts/RevenueChart';
import SpendDonut from '@/src/components/charts/SpendDonut';

const MER_GOAL = 3.5;

const EMPTY_METRICS: LiveMetrics = {
  totalRevenue: 0,
  totalOrders: 0,
  totalAdSpend: 0,
  aov: 0,
  mer: 0,
  returns: 0,
};

interface LiveMetrics {
  totalRevenue: number;
  totalOrders: number;
  totalAdSpend: number;
  aov: number;
  mer: number;
  returns: number;
  metaSpend?: number;
  googleSpend?: number;
  tiktokSpend?: number;
  metaRevenue?: number;
  googleRevenue?: number;
  tiktokRevenue?: number;
  newCustomers?: number;
  returningCustomers?: number;
  newCustomerRevenue?: number;
  returningCustomerRevenue?: number;
  pctNew?: number;
  pctReturning?: number;
}

interface PriorPeriod {
  totalRevenue: number;
  totalAdSpend: number;
  totalOrders: number;
  aov: number;
  mer: number;
  metaSpend: number;
  googleSpend: number;
}

export default function OverviewContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const isCustom = tfRaw === 'custom';
  const tf = (isCustom ? '30d' : tfRaw) as Timeframe;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';

  const [metrics, setMetrics] = useState<LiveMetrics>(EMPTY_METRICS);
  const [revenueData, setRevenueData] = useState<DailyRevenue[]>([]);
  const [priorPeriod, setPriorPeriod] = useState<PriorPeriod | null>(null);
  const [priorLabel, setPriorLabel] = useState<string>('');
  const [livePlatformSpend, setLivePlatformSpend] = useState<PlatformSpend[] | null>(null);
  const [liveSource, setLiveSource] = useState<string>('loading');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [dataLag, setDataLag] = useState<boolean>(false);
  const [latestAvailableDate, setLatestAvailableDate] = useState<string | null>(null);
  const [shopifyDataLag, setShopifyDataLag] = useState<boolean>(false);
  const [shopifyLatestDate, setShopifyLatestDate] = useState<string | null>(null);
  const [revenueSource, setRevenueSource] = useState<'shopify' | 'none' | null>(null);

  function buildLivePlatformSpend(m: LiveMetrics): PlatformSpend[] | null {
    if (!m.metaSpend && !m.googleSpend && !m.tiktokSpend) return null;
    const platforms: PlatformSpend[] = [];
    const push = (platform: string, spend: number, revenue: number, color: string) => {
      if (spend <= 0) return;
      platforms.push({
        platform,
        spend,
        revenue,
        roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
        ctr: 0,
        impressions: 0,
        color,
      });
    };
    push('Meta', m.metaSpend ?? 0, m.metaRevenue ?? 0, '#818cf8');
    push('Google', m.googleSpend ?? 0, m.googleRevenue ?? 0, '#34d399');
    push('TikTok', m.tiktokSpend ?? 0, m.tiktokRevenue ?? 0, '#f472b6');
    return platforms.length > 0 ? platforms : null;
  }

  useEffect(() => {
    setMetrics(EMPTY_METRICS);
    setRevenueData([]);
    setPriorPeriod(null);
    setLivePlatformSpend(null);
    setDataLag(false);
    setLatestAvailableDate(null);
    setShopifyDataLag(false);
    setShopifyLatestDate(null);
    setRevenueSource(null);
    setLiveSource('loading');

    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (compareOn) params.set('compare', 'true');

    fetch(`/api/windsor?${params}`)
      .then(r => r.json())
      .then(data => {
        const source = data.source || 'unknown';
        if (source !== 'windsor_live' && source !== 'bigquery_live') {
          setMetrics(EMPTY_METRICS);
          setRevenueData([]);
          setLivePlatformSpend(null);
          setLiveSource('error');
          setLastUpdated(new Date().toLocaleTimeString());
          return;
        }
        const m: LiveMetrics = { returns: 0, ...data.metrics };
        setMetrics(m);
        setRevenueData(data.revenueData || []);
        if (data.priorPeriod) { setPriorPeriod(data.priorPeriod); setPriorLabel(data.priorLabel || ''); }
        setLivePlatformSpend(buildLivePlatformSpend(m));
        setDataLag(!!data.dataLag);
        setLatestAvailableDate(data.latestAvailableDate || null);
        setShopifyDataLag(!!data.shopifyDataLag);
        setShopifyLatestDate(data.shopifyLatestDate || null);
        setRevenueSource(data.revenueSource || null);
        setLiveSource(source);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => {
        setMetrics(EMPTY_METRICS);
        setRevenueData([]);
        setLivePlatformSpend(null);
        setDataLag(false);
        setLiveSource('error');
        setLastUpdated(new Date().toLocaleTimeString());
      });
  }, [tfRaw, dateFrom, dateTo, compareOn]);

  const merColor = metrics.mer >= MER_GOAL ? '#22c55e' : '#ef4444';
  const merLabel = metrics.mer >= MER_GOAL ? '✓ Above Goal' : '✗ Below Goal';
  const isLive = liveSource === 'windsor_live' || liveSource === 'bigquery_live';

  return (
    <div>
      <Header
        title="MER Dashboard"
        subtitle={isCustom && dateFrom && dateTo
          ? `Overview · ${dateFrom} → ${dateTo}${compareOn && priorLabel ? ` vs ${priorLabel}` : ''}`
          : `Overview · ${TIMEFRAME_LABELS[tf] || tf}${compareOn && priorLabel ? ` vs prior period` : ''}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400' : liveSource === 'loading' ? 'bg-yellow-400' : 'bg-red-400'}`}
        />
        <span className="text-xs text-gray-400">
          {liveSource === 'loading'
            ? 'Loading Windsor data...'
            : isLive
            ? `Live · Windsor.ai · Updated ${lastUpdated}`
            : `Data unavailable · ${lastUpdated}`}
        </span>
        <button
          onClick={() => {
            setLiveSource('loading');
            const p = new URLSearchParams({ tf: tfRaw });
            if (dateFrom) p.set('date_from', dateFrom);
            if (dateTo) p.set('date_to', dateTo);
            if (compareOn) p.set('compare', 'true');
            fetch(`/api/windsor?${p}`)
              .then(r => r.json())
              .then(data => {
                const source = data.source || 'unknown';
                if (source !== 'windsor_live' && source !== 'bigquery_live') {
                  setMetrics(EMPTY_METRICS);
                  setRevenueData([]);
                  setLivePlatformSpend(null);
                  setLiveSource('error');
                  setLastUpdated(new Date().toLocaleTimeString());
                  return;
                }
                const m: LiveMetrics = { returns: 0, ...data.metrics };
                setMetrics(m);
                setRevenueData(data.revenueData || []);
                if (data.priorPeriod) { setPriorPeriod(data.priorPeriod); setPriorLabel(data.priorLabel || ''); }
                setLivePlatformSpend(buildLivePlatformSpend(m));
                setRevenueSource(data.revenueSource || null);
                setLiveSource(source);
                setLastUpdated(new Date().toLocaleTimeString());
              })
              .catch(() => {
                setMetrics(EMPTY_METRICS);
                setRevenueData([]);
                setLivePlatformSpend(null);
                setLiveSource('error');
                setLastUpdated(new Date().toLocaleTimeString());
              });
          }}
          className="text-xs text-purple-500 hover:text-purple-700 font-medium ml-1"
        >
          ↻ Refresh
        </button>
      </div>

      {liveSource === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Overview data is unavailable — BigQuery query failed or hasn&apos;t synced yet.</span>
        </div>
      )}

      {/* Data lag notice */}
      {dataLag && latestAvailableDate && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠️</span>
          <span>
            Windsor hasn&apos;t synced {tf === 'today' ? "today's" : "yesterday's"} data yet — showing most recent available:{' '}
            <strong>{latestAvailableDate}</strong>. Windsor typically syncs ad platform data within 24–48 hours.
          </span>
        </div>
      )}

      {shopifyDataLag && shopifyLatestDate && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠️</span>
          <span>
            Shopify data hasn&apos;t synced for {tf === 'today' ? "today" : "yesterday"} yet — showing revenue/orders from the most recent available day:{' '}
            <strong>{shopifyLatestDate}</strong>. Ad spend above reflects the actual selected period.
          </span>
        </div>
      )}

      {revenueSource === 'none' && isLive && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-blue-700">
          <span>ℹ️</span>
          <span>
            Shopify hasn&apos;t synced revenue for this period yet — revenue and orders will show as 0 until Shopify syncs. Platform-attributed revenue is shown in the platform table below.
          </span>
        </div>
      )}

      {/* MER Hero */}
      <div className="mb-6">
        <Card accentColor="#c4b5fd" className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              MER — Marketing Efficiency Ratio
            </p>
            <div className="flex items-end gap-3">
              <span
                className="text-6xl font-black"
                style={{ color: merColor }}
              >
                {formatROAS(metrics.mer)}
              </span>
              <div className="pb-2">
                <span
                  className="text-sm font-bold px-2 py-1 rounded-lg"
                  style={{
                    backgroundColor: metrics.mer >= MER_GOAL ? '#dcfce7' : '#fee2e2',
                    color: merColor,
                  }}
                >
                  {merLabel}
                </span>
                <p className="text-xs text-gray-400 mt-1">Goal: {MER_GOAL}x</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              Total Revenue ÷ Total Ad Spend ={' '}
              <span className="font-semibold text-gray-600">
                {formatCurrency(metrics.totalRevenue)} ÷ {formatCurrency(metrics.totalAdSpend)}
              </span>
            </p>
          </div>
          <div className="hidden sm:block w-px h-20 bg-gray-100" />
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-4 sm:gap-8">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Revenue</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Ad Spend</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalAdSpend)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Orders</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{metrics.totalOrders.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">AOV</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-800">{formatCurrency(metrics.aov)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Shopify Total Sales"
          value={formatCurrency(metrics.totalRevenue)}
          subtitle={`${metrics.totalOrders} orders`}
          accentColor="#c4b5fd"
          comparison={priorPeriod ? { current: metrics.totalRevenue, prior: priorPeriod.totalRevenue } : undefined}
          trend={!priorPeriod ? { value: 'vs prior period', positive: true } : undefined}
        />
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(metrics.totalAdSpend)}
          subtitle={metrics.metaSpend ? `Meta ${formatCurrency(metrics.metaSpend)} · Google ${formatCurrency(metrics.googleSpend ?? 0)}` : 'Meta + Google'}
          accentColor="#f9a8d4"
          comparison={priorPeriod ? { current: metrics.totalAdSpend, prior: priorPeriod.totalAdSpend } : undefined}
        />
        <MetricCard
          title="Avg Order Value"
          value={formatCurrency(metrics.aov)}
          subtitle="Per transaction"
          accentColor="#fde68a"
          comparison={priorPeriod ? { current: metrics.aov, prior: priorPeriod.aov } : undefined}
        />
        <MetricCard
          title="Blended MER"
          value={formatROAS(metrics.mer)}
          subtitle="Across all platforms"
          accentColor={metrics.mer >= MER_GOAL ? '#86efac' : '#fca5a5'}
          valueColor={merColor}
          comparison={priorPeriod ? { current: metrics.mer, prior: priorPeriod.mer } : undefined}
          trend={!priorPeriod ? {
            value: metrics.mer >= MER_GOAL ? 'Above 3.5x goal' : 'Below 3.5x goal',
            positive: metrics.mer >= MER_GOAL,
          } : undefined}
        />
      </div>

      {/* New vs Returning Customer Cards — hidden on Today: the customer
          match hasn't settled mid-day and would misreport the split */}
      {metrics.newCustomers !== undefined && metrics.newCustomers > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {tfRaw !== 'today' && (
            <>
              <MetricCard
                title="New Customers"
                value={String(metrics.newCustomers)}
                subtitle={`${metrics.pctNew?.toFixed(1) ?? 0}% of orders`}
                accentColor="#a5f3fc"
                trend={{ value: formatCurrency(metrics.newCustomerRevenue ?? 0) + ' revenue', positive: true }}
              />
              <MetricCard
                title="Returning Customers"
                value={String(metrics.returningCustomers ?? 0)}
                subtitle={`${metrics.pctReturning?.toFixed(1) ?? 0}% of orders`}
                accentColor="#bbf7d0"
                trend={{ value: formatCurrency(metrics.returningCustomerRevenue ?? 0) + ' revenue', positive: true }}
              />
            </>
          )}
          <MetricCard
            title="Meta Spend"
            value={formatCurrency(metrics.metaSpend ?? 0)}
            subtitle={`${metrics.metaSpend && metrics.totalAdSpend ? ((metrics.metaSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
            accentColor="#c7d2fe"
          />
          <MetricCard
            title="Google Spend"
            value={formatCurrency(metrics.googleSpend ?? 0)}
            subtitle={`${metrics.googleSpend && metrics.totalAdSpend ? ((metrics.googleSpend / metrics.totalAdSpend) * 100).toFixed(0) : 0}% of total spend`}
            accentColor="#fef08a"
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <Card accentColor="#c4b5fd" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-700">Revenue & Ad Spend Trend</h2>
              <p className="text-xs text-gray-400">Purple = Revenue · Pink = Ad Spend</p>
            </div>
          </div>
          <RevenueChart data={revenueData} />
        </Card>

        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Ad Spend by Platform</h2>
          <p className="text-xs text-gray-400 mb-3">
            Total: {formatCurrency(metrics.totalAdSpend)}
          </p>
          <SpendDonut data={livePlatformSpend ?? []} />
        </Card>
      </div>

      {/* Platform Performance Table */}
      <Card accentColor="#86efac">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Platform Performance Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Platform</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Spend</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Revenue</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">ROAS</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">CTR</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Impressions</th>
              </tr>
            </thead>
            <tbody>
              {(livePlatformSpend ?? []).map((p) => (
                <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold text-gray-700">{p.platform}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.spend)}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.revenue)}</td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className="font-bold"
                      style={{ color: p.roas >= MER_GOAL ? '#22c55e' : '#ef4444' }}
                    >
                      {formatROAS(p.roas)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatPercent(p.ctr)}</td>
                  <td className="py-3 pl-4 text-right text-gray-600">
                    {(p.impressions / 1000).toFixed(0)}k
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
