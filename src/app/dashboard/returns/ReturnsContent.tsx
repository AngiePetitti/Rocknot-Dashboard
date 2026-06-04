'use client';

import { useSearchParams } from 'next/navigation';
import { returnsByPlatform, returnTrends, topReturnedProducts } from '@/src/lib/mockData';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

export default function ReturnsContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as string;

  const totalReturns = returnsByPlatform.reduce((s, p) => s + p.returns, 0);
  const totalRevenue = returnsByPlatform.reduce((s, p) => s + p.revenue, 0);
  const overallReturnRate = (totalReturns / (totalReturns / 0.042)) * 100;

  const platformBarData = returnsByPlatform.map(p => ({
    platform: p.platform,
    rate: p.returnRate,
    color: p.color,
  }));

  const trendData = returnTrends.slice(-30).map(d => ({
    date: d.date.slice(5),
    returns: d.returns,
    rate: d.returnRate,
  }));

  return (
    <div>
      <Header
        title="Returns"
        subtitle={`Return analysis · ${(TIMEFRAME_LABELS as Record<string, string>)[tf] || tf}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Overall Return Rate"
          value={formatPercent(overallReturnRate)}
          subtitle="All platforms combined"
          accentColor="#f9a8d4"
          valueColor={overallReturnRate > 6 ? '#ef4444' : '#22c55e'}
        />
        <MetricCard
          title="Total Returns"
          value={totalReturns.toLocaleString()}
          subtitle="Units returned"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Highest Return Rate"
          value={formatPercent(Math.max(...returnsByPlatform.map(p => p.returnRate)))}
          subtitle={returnsByPlatform.reduce((h, p) => p.returnRate > h.returnRate ? p : h).platform}
          accentColor="#fca5a5"
          valueColor="#ef4444"
        />
        <MetricCard
          title="Best Platform"
          value={formatPercent(Math.min(...returnsByPlatform.map(p => p.returnRate)))}
          subtitle={returnsByPlatform.reduce((h, p) => p.returnRate < h.returnRate ? p : h).platform}
          accentColor="#86efac"
          valueColor="#22c55e"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Return Rate by Platform */}
        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Return Rate by Platform</h2>
          <p className="text-xs text-gray-400 mb-4">% of orders returned per platform</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={platformBarData} barSize={48}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="platform"
                tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v + '%'}
                domain={[0, 8]}
                width={32}
              />
              <Tooltip
                formatter={(v: unknown) => [formatPercent(Number(v)), 'Return Rate']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
                {platformBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Return Trend */}
        <Card accentColor="#fdba74">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Return Trend (Last 30 Days)</h2>
          <p className="text-xs text-gray-400 mb-4">Daily return volume</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval={6}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                cursor={{ stroke: '#e2e8f0' }}
              />
              <Line
                type="monotone"
                dataKey="returns"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                name="Returns"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Platform Returns Table */}
      <Card accentColor="#c4b5fd" className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Returns by Platform</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Platform</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Returns</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Revenue Base</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Return Rate</th>
              </tr>
            </thead>
            <tbody>
              {returnsByPlatform.map(p => (
                <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <PlatformBadge platform={p.platform} />
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{p.returns}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.revenue)}</td>
                  <td className="py-3 pl-4 text-right">
                    <span
                      className="font-bold text-sm"
                      style={{ color: p.returnRate > 5 ? '#ef4444' : p.returnRate > 3.5 ? '#d97706' : '#22c55e' }}
                    >
                      {formatPercent(p.returnRate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top Returned Products */}
      <Card accentColor="#fde68a">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Top Returned Products</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Product</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Returns</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Return Rate</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Top Reason</th>
              </tr>
            </thead>
            <tbody>
              {topReturnedProducts.map((product, i) => (
                <tr key={product.name} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4 font-medium text-gray-800">{product.name}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{product.returns}</td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className="font-bold"
                      style={{ color: product.returnRate > 10 ? '#ef4444' : '#d97706' }}
                    >
                      {formatPercent(product.returnRate)}
                    </span>
                  </td>
                  <td className="py-3 pl-4">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      {product.topReason}
                    </span>
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
