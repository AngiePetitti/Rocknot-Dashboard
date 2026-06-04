'use client';

import { useSearchParams } from 'next/navigation';
import { Timeframe, getPlatformSpendForTimeframe, topAds, aiRecommendations } from '@/src/lib/mockData';
import { formatCurrency, formatROAS, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import PlatformBadge from '@/src/components/ui/PlatformBadge';
import ROASChart from '@/src/components/charts/ROASChart';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const TAG_COLORS: Record<string, string> = {
  'Strong creative': '#c4b5fd',
  'High CTR': '#86efac',
  'Low CPM': '#93c5fd',
  'UGC': '#fde68a',
  'Trending audio': '#f9a8d4',
  'Brand intent': '#fdba74',
  'Retargeting': '#c4b5fd',
  'High ROAS': '#86efac',
  'Warm audience': '#93c5fd',
  'Product demo': '#fde68a',
  'Broad audience': '#e2e8f0',
  'Brand awareness': '#f9a8d4',
  'Upper funnel': '#fdba74',
  'Shopping intent': '#86efac',
  'Lookalike': '#c4b5fd',
  'New audience': '#93c5fd',
  'Scaling': '#fde68a',
};

export default function AdsContent() {
  const searchParams = useSearchParams();
  const tf = (searchParams.get('tf') || '30d') as Timeframe;

  const platformSpend = getPlatformSpendForTimeframe(tf);
  const totalSpend = platformSpend.reduce((s, p) => s + p.spend, 0);
  const totalRevenue = platformSpend.reduce((s, p) => s + p.revenue, 0);
  const avgROAS = totalRevenue / totalSpend;

  const spendChartData = platformSpend.map(p => ({
    platform: p.platform,
    spend: p.spend,
    color: p.color,
  }));

  return (
    <div>
      <Header title="Ad Performance" subtitle={`Spend & ROAS · ${TIMEFRAME_LABELS[tf] || tf}`}>
        <TimeframeSelector />
      </Header>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(totalSpend)}
          subtitle="All platforms combined"
          accentColor="#f9a8d4"
        />
        <MetricCard
          title="Total Revenue (Ads)"
          value={formatCurrency(totalRevenue)}
          subtitle="Attributed to paid"
          accentColor="#c4b5fd"
        />
        <MetricCard
          title="Blended ROAS"
          value={formatROAS(avgROAS)}
          subtitle="Revenue / Spend"
          accentColor="#86efac"
          valueColor={avgROAS >= 3.5 ? '#22c55e' : '#ef4444'}
        />
        <MetricCard
          title="Best Platform ROAS"
          value={formatROAS(Math.max(...platformSpend.map(p => p.roas)))}
          subtitle={platformSpend.reduce((best, p) => p.roas > best.roas ? p : best).platform}
          accentColor="#fde68a"
        />
      </div>

      {/* ROAS + Spend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <Card accentColor="#c4b5fd">
          <h2 className="text-sm font-bold text-gray-700 mb-1">ROAS by Platform</h2>
          <p className="text-xs text-gray-400 mb-4">Red dashed line = 3.5x goal</p>
          <ROASChart data={platformSpend} goalLine={3.5} />
        </Card>

        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Spend by Platform</h2>
          <p className="text-xs text-gray-400 mb-4">Total: {formatCurrency(totalSpend)}</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={spendChartData} barSize={48}>
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
                tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
                width={40}
              />
              <Tooltip
                formatter={(v: unknown) => [formatCurrency(Number(v)), 'Spend']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="spend" radius={[6, 6, 0, 0]}>
                {spendChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* AI Recommendations */}
      <Card accentColor="#fde68a" className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-bold text-gray-700">AI-Powered Spend Recommendations</h2>
          <span className="text-xs bg-yellow-100 text-yellow-700 font-semibold px-2 py-0.5 rounded-full">
            Based on last 30 days
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {aiRecommendations.map((rec) => (
            <div
              key={rec.platform}
              className="rounded-xl p-4 border"
              style={{ borderColor: rec.color + '33', backgroundColor: rec.color + '08' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: rec.color }}
                />
                <span className="text-xs font-bold text-gray-700">{rec.platform}</span>
              </div>
              <p className="text-sm font-bold text-gray-800 mb-1">💡 {rec.recommendation}</p>
              <p className="text-xs text-gray-500 mb-2">{rec.reason}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {rec.impact}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    rec.confidence === 'High'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {rec.confidence} confidence
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Best Performing Ads Table */}
      <Card accentColor="#86efac">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Best Performing Ads</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-100">
                {['Ad Name', 'Platform', 'Spend', 'Revenue', 'ROAS', 'CTR', 'Impressions', "Why it's working"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topAds.map((ad) => (
                <tr key={ad.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <span className="font-medium text-gray-800">{ad.name}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <PlatformBadge platform={ad.platform} />
                  </td>
                  <td className="py-3 pr-4 text-gray-600">{formatCurrency(ad.spend)}</td>
                  <td className="py-3 pr-4 text-gray-600">{formatCurrency(ad.revenue)}</td>
                  <td className="py-3 pr-4">
                    <span
                      className="font-bold"
                      style={{ color: ad.roas >= 3.5 ? '#22c55e' : '#ef4444' }}
                    >
                      {formatROAS(ad.roas)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-600">{formatPercent(ad.ctr)}</td>
                  <td className="py-3 pr-4 text-gray-600">
                    {(ad.impressions / 1000).toFixed(0)}k
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {ad.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-gray-700"
                          style={{ backgroundColor: TAG_COLORS[tag] || '#e2e8f0' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
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
