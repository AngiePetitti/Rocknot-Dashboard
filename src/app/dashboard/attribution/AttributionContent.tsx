'use client';

import { useSearchParams } from 'next/navigation';
import { Timeframe, getAttributionForTimeframe, getMetricsForTimeframe } from '@/src/lib/mockData';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

const RADIAN = Math.PI / 180;
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.06) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {(percent * 100).toFixed(0)}%
    </text>
  );
};

export default function AttributionContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const attribution = getAttributionForTimeframe(tf);
  const metrics = getMetricsForTimeframe(tf);
  const totalRevenue = metrics.totalRevenue;

  const topPlatform = attribution.reduce((a, b) => a.revenue > b.revenue ? a : b);
  const paidRevenue = attribution.filter(a => !['Direct / Shopify', 'Email / SMS'].includes(a.platform))
    .reduce((s, a) => s + a.revenue, 0);

  const barData = attribution.map(a => ({
    platform: a.platform.split('/')[0].trim(),
    revenue: a.revenue,
    orders: a.orders,
    color: a.color,
  }));

  return (
    <div>
      <Header
        title="Platform Attribution"
        subtitle={`Revenue by channel · ${TIMEFRAME_LABELS[tf] || tf}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          subtitle="All channels"
          accentColor="#c4b5fd"
        />
        <MetricCard
          title="Top Channel"
          value={topPlatform.platform.split('/')[0].trim()}
          subtitle={formatCurrency(topPlatform.revenue)}
          accentColor="#f9a8d4"
        />
        <MetricCard
          title="Paid Channel Revenue"
          value={formatCurrency(paidRevenue)}
          subtitle={formatPercent((paidRevenue / totalRevenue) * 100) + ' of total'}
          accentColor="#fde68a"
        />
        <MetricCard
          title="Organic / Direct"
          value={formatCurrency(totalRevenue - paidRevenue)}
          subtitle={formatPercent(((totalRevenue - paidRevenue) / totalRevenue) * 100) + ' of total'}
          accentColor="#86efac"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Donut */}
        <Card accentColor="#c4b5fd">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Revenue Breakdown by Channel</h2>
          <p className="text-xs text-gray-400 mb-3">Total: {formatCurrency(totalRevenue)}</p>
          <div className="relative">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={attribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="revenue"
                  nameKey="platform"
                  labelLine={false}
                  label={renderLabel}
                >
                  {attribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [formatCurrency(Number(v)), String(name)]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-xs text-gray-400">Total</p>
                <p className="font-bold text-base text-gray-800">
                  {formatCurrency(totalRevenue, true)}
                </p>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            {attribution.map(a => (
              <div key={a.platform} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-xs text-gray-600">{a.platform}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Bar chart */}
        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Revenue by Platform</h2>
          <p className="text-xs text-gray-400 mb-4">Attributed revenue per channel</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} barSize={36}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="platform"
                tick={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
                width={40}
              />
              <Tooltip
                formatter={(v: unknown) => [formatCurrency(Number(v)), 'Revenue']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Attribution Table */}
      <Card accentColor="#93c5fd">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Platform Comparison Table</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Platform</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Revenue</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Orders</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">% of Total</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Share</th>
              </tr>
            </thead>
            <tbody>
              {attribution
                .sort((a, b) => b.revenue - a.revenue)
                .map(platform => (
                  <tr key={platform.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: platform.color }}
                        />
                        <span className="font-semibold text-gray-700">{platform.platform}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-800">
                      {formatCurrency(platform.revenue)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {platform.orders.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {formatPercent(platform.percentage)}
                    </td>
                    <td className="py-3 pl-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${platform.percentage}%`,
                              backgroundColor: platform.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">{formatPercent(platform.percentage, 0)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td className="py-3 pr-4 font-bold text-gray-800">Total</td>
                <td className="py-3 px-4 text-right font-bold text-gray-800">
                  {formatCurrency(totalRevenue)}
                </td>
                <td className="py-3 px-4 text-right font-bold text-gray-800">
                  {attribution.reduce((s, a) => s + a.orders, 0).toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right font-bold text-gray-800">100%</td>
                <td className="py-3 pl-4" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
