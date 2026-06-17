'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Timeframe } from '@/src/lib/mockData';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import { AttributionData } from '@/src/app/api/windsor/attribution/route';
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
  Legend,
} from 'recharts';

const RADIAN = Math.PI / 180;
const renderLabel = ({ cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 }: {
  cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; percent?: number;
}) => {
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
  const tfRaw = searchParams.get('tf') || '30d';
  const tf = (tfRaw === 'custom' ? '30d' : tfRaw) as Timeframe;
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [attribution, setAttribution] = useState<AttributionData[]>([]);
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [totalSpend, setTotalSpend] = useState<number>(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    fetch(`/api/windsor/attribution?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.source === 'bigquery_live') {
          setAttribution(data.attribution || []);
          setTotalRevenue(data.totalRevenue ?? 0);
          setTotalSpend(data.totalSpend ?? 0);
          setStatus('ok');
        } else {
          setAttribution([]);
          setTotalRevenue(0);
          setTotalSpend(0);
          setStatus('error');
        }
      })
      .catch(() => {
        setAttribution([]);
        setTotalRevenue(0);
        setTotalSpend(0);
        setStatus('error');
      });
  }, [tfRaw, dateFrom, dateTo]);

  const paidChannels = attribution.filter(a => a.spend > 0);
  const paidRevenue = paidChannels.reduce((s, a) => s + a.revenue, 0);
  const blendedROAS = totalSpend > 0 ? Math.round((paidRevenue / totalSpend) * 100) / 100 : 0;
  const topPlatform = attribution.length
    ? attribution.reduce((a, b) => a.revenue > b.revenue ? a : b)
    : { platform: '—', revenue: 0, orders: 0, spend: 0, roas: 0, costPerOrder: 0, percentage: 0, color: '#94a3b8' };

  const sorted = [...attribution].sort((a, b) => b.revenue - a.revenue);

  const barData = paidChannels.map(a => ({
    platform: a.platform.split('/')[0].trim(),
    revenue: a.revenue,
    spend: a.spend,
    color: a.color,
  }));

  return (
    <div>
      <Header
        title="Platform Attribution"
        subtitle={`Revenue & ad spend by channel · ${TIMEFRAME_LABELS[tf] || tf}`}
      >
        <TimeframeSelector />
      </Header>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          subtitle="All channels combined"
          accentColor="#c4b5fd"
        />
        <MetricCard
          title="Total Ad Spend"
          value={formatCurrency(totalSpend)}
          subtitle="Paid channels only"
          accentColor="#fda4af"
        />
        <MetricCard
          title="Blended ROAS"
          value={blendedROAS > 0 ? `${blendedROAS}x` : '—'}
          subtitle="Paid revenue ÷ total spend"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Top Channel"
          value={topPlatform.platform.split('/')[0].trim()}
          subtitle={`${formatCurrency(topPlatform.revenue)} revenue`}
          accentColor="#86efac"
        />
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠</span>
          <span>Attribution data unavailable — BigQuery query failed or hasn&apos;t synced yet.</span>
        </div>
      )}
      {status === 'ok' && attribution.length === 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠</span>
          <span>No attribution data for this period.</span>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Donut */}
        <Card accentColor="#c4b5fd">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Revenue by Channel</h2>
          <p className="text-xs text-gray-400 mb-3">Total: {formatCurrency(totalRevenue)}</p>
          <div className="relative">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={attribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
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
                <p className="font-bold text-base text-gray-800">{formatCurrency(totalRevenue, true)}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {attribution.map(a => (
              <div key={a.platform} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                <span className="text-xs text-gray-600">{a.platform}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Spend vs Revenue grouped bar */}
        <Card accentColor="#fda4af">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Spend vs Revenue — Paid Channels</h2>
          <p className="text-xs text-gray-400 mb-3">Compare ad cost to attributed revenue</p>
          {barData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-gray-400">No paid channel data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} barSize={28} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="platform"
                  tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}
                  width={44}
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [formatCurrency(Number(v)), String(name) === 'spend' ? 'Ad Spend' : 'Revenue']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                  cursor={{ fill: '#f8fafc' }}
                />
                <Legend
                  formatter={(v) => v === 'spend' ? 'Ad Spend' : 'Revenue'}
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
                <Bar dataKey="spend" radius={[4, 4, 0, 0]} fill="#fda4af" opacity={0.85} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Desktop table */}
      <Card accentColor="#93c5fd" className="hidden md:block">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Platform Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Channel</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Revenue</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Ad Spend</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">ROAS</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Orders</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Cost/Order</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">% Total</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="font-semibold text-gray-700">{p.platform}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-gray-800">{formatCurrency(p.revenue)}</td>
                  <td className="py-3 px-3 text-right text-gray-600">
                    {p.spend > 0 ? formatCurrency(p.spend) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {p.roas > 0 ? (
                      <span className={`font-semibold ${p.roas >= 3 ? 'text-emerald-600' : p.roas >= 1.5 ? 'text-amber-600' : 'text-red-600'}`}>
                        {p.roas}x
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-3 text-right text-gray-600">{p.orders.toLocaleString()}</td>
                  <td className="py-3 px-3 text-right text-gray-600">
                    {p.costPerOrder > 0 ? formatCurrency(p.costPerOrder) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-3 text-right text-gray-600">{formatPercent(p.percentage)}</td>
                  <td className="py-3 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${p.percentage}%`, backgroundColor: p.color }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td className="py-3 pr-4 font-bold text-gray-800">Total</td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">{formatCurrency(totalRevenue)}</td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">{formatCurrency(totalSpend)}</td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">
                  {blendedROAS > 0 ? `${blendedROAS}x` : '—'}
                </td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">
                  {attribution.reduce((s, a) => s + a.orders, 0).toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">
                  {attribution.reduce((s, a) => s + a.orders, 0) > 0
                    ? formatCurrency(totalSpend / attribution.reduce((s, a) => s + a.orders, 0))
                    : '—'}
                </td>
                <td className="py-3 px-3 text-right font-bold text-gray-800">100%</td>
                <td className="py-3 pl-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        <h2 className="text-sm font-bold text-gray-700 px-1">Platform Breakdown</h2>
        {sorted.map(p => (
          <div key={p.platform} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="font-bold text-gray-800 text-sm">{p.platform}</span>
              </div>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{formatPercent(p.percentage)}</span>
            </div>

            {/* Revenue bar */}
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className="h-full rounded-full" style={{ width: `${p.percentage}%`, backgroundColor: p.color }} />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-400 mb-0.5">Revenue</p>
                <p className="font-bold text-gray-800 text-sm">{formatCurrency(p.revenue, true)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-400 mb-0.5">Ad Spend</p>
                <p className="font-semibold text-gray-700 text-sm">{p.spend > 0 ? formatCurrency(p.spend, true) : '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-400 mb-0.5">ROAS</p>
                <p className={`font-bold text-sm ${p.roas >= 3 ? 'text-emerald-600' : p.roas >= 1.5 ? 'text-amber-600' : p.roas > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {p.roas > 0 ? `${p.roas}x` : '—'}
                </p>
              </div>
            </div>

            {(p.orders > 0 || p.costPerOrder > 0) && (
              <div className="grid grid-cols-2 gap-2 text-center mt-2">
                <div className="bg-gray-50 rounded-xl p-2.5">
                  <p className="text-xs text-gray-400 mb-0.5">Orders</p>
                  <p className="font-semibold text-gray-700 text-sm">{p.orders.toLocaleString()}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-2.5">
                  <p className="text-xs text-gray-400 mb-0.5">Cost / Order</p>
                  <p className="font-semibold text-gray-700 text-sm">{p.costPerOrder > 0 ? formatCurrency(p.costPerOrder, true) : '—'}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
