'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Timeframe, getMetricsForTimeframe, getRevenueForTimeframe, getPlatformSpendForTimeframe, DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import MetricCard from '@/src/components/ui/MetricCard';
import Card from '@/src/components/ui/Card';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import RevenueChart from '@/src/components/charts/RevenueChart';
import SpendDonut from '@/src/components/charts/SpendDonut';

const MER_GOAL = 3.5;

interface LiveMetrics {
  totalRevenue: number;
  totalOrders: number;
  totalAdSpend: number;
  aov: number;
  mer: number;
  returns: number;
  metaSpend?: number;
  googleSpend?: number;
  newCustomers?: number;
  returningCustomers?: number;
  newCustomerRevenue?: number;
  returningCustomerRevenue?: number;
  pctNew?: number;
  pctReturning?: number;
}

export default function OverviewContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const staticMetrics = getMetricsForTimeframe(tf);
  const staticRevenueData = getRevenueForTimeframe(tf);
  const platformSpend = getPlatformSpendForTimeframe(tf);

  const [metrics, setMetrics] = useState<LiveMetrics>({ ...staticMetrics, returns: 0 });
  const [revenueData, setRevenueData] = useState<DailyRevenue[]>(staticRevenueData);
  const [liveSource, setLiveSource] = useState<string>('loading');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    setMetrics({ returns: 0, ...staticMetrics });
    setRevenueData(staticRevenueData);
    setLiveSource('loading');

    fetch(`/api/windsor?tf=${tf}`)
      .then(r => r.json())
      .then(data => {
        if (data.metrics) setMetrics({ returns: 0, ...data.metrics });
        if (data.revenueData?.length) setRevenueData(data.revenueData);
        setLiveSource(data.source || 'unknown');
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => {
        setLiveSource('mock_fallback');
        setLastUpdated(new Date().toLocaleTimeString());
      });
  }, [tf]);

  const merColor = metrics.mer >= MER_GOAL ? '#22c55e' : '#ef4444';
  const merLabel = metrics.mer >= MER_GOAL ? '✓ Above Goal' : '✗ Below Goal';
  const isLive = liveSource === 'windsor_live';

  return (
    <div>
      <Header
        title="MER Dashboard"
        subtitle={`Overview · ${TIMEFRAME_LABELS[tf] || tf}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400' : liveSource === 'loading' ? 'bg-yellow-400' : 'bg-gray-300'}`}
        />
        <span className="text-xs text-gray-400">
          {liveSource === 'loading'
            ? 'Loading Windsor data...'
            : isLive
            ? `Live · Windsor.ai · Updated ${lastUpdated}`
            : `Estimated data · ${lastUpdated}`}
        </span>
        <button
          onClick={() => {
            setLiveSource('loading');
            fetch(`/api/windsor?tf=${tf}`)
              .then(r => r.json())
              .then(data => {
                if (data.metrics) setMetrics({ returns: 0, ...data.metrics });
                if (data.revenueData?.length) setRevenueData(data.revenueData);
                setLiveSource(data.source || 'unknown');
                setLastUpdated(new Date().toLocaleTimeString());
              })
              .catch(() => setLiveSource('mock_fallback'));
          }}
          className="text-xs text-purple-500 hover:text-purple-700 font-medium ml-1"
        >
          ↻ Refresh
        </button>
      </div>

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
          <div className="flex flex-wrap gap-6 sm:gap-8">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Revenue</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Ad Spend</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(metrics.totalAdSpend)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Orders</p>
              <p className="text-2xl font-bold text-gray-800">{metrics.totalOrders.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">AOV</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(metrics.aov)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Shopify Net Sales"
          value={formatCurrency(metrics.totalRevenue)}
          subtitle={`${metrics.totalOrders} orders`}
          accentColor="#c4b5fd"
          trend={{ value: '12.4% vs prior period', positive: true }}
        />
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(metrics.totalAdSpend)}
          subtitle={metrics.metaSpend ? `Meta ${formatCurrency(metrics.metaSpend)} · Google ${formatCurrency(metrics.googleSpend ?? 0)}` : 'Meta + Google'}
          accentColor="#f9a8d4"
          trend={{ value: '8.1% vs prior period', positive: false }}
        />
        <MetricCard
          title="Avg Order Value"
          value={formatCurrency(metrics.aov)}
          subtitle="Per transaction"
          accentColor="#fde68a"
          trend={{ value: '3.2% vs prior period', positive: true }}
        />
        <MetricCard
          title="Blended MER"
          value={formatROAS(metrics.mer)}
          subtitle="Across all platforms"
          accentColor={metrics.mer >= MER_GOAL ? '#86efac' : '#fca5a5'}
          valueColor={merColor}
          trend={{
            value: metrics.mer >= MER_GOAL ? 'Above 3.5x goal' : 'Below 3.5x goal',
            positive: metrics.mer >= MER_GOAL,
          }}
        />
      </div>

      {/* New vs Returning Customer Cards */}
      {metrics.newCustomers !== undefined && metrics.newCustomers > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          <SpendDonut data={platformSpend} />
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
              {platformSpend.map((p) => (
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
