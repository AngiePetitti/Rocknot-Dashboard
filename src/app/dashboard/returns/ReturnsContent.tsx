'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ReturnedProduct {
  name: string;
  returns: number;
}

interface ReturnTrendPoint {
  date: string;
  returns: number;
}

export default function ReturnsContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [totalReturns, setTotalReturns] = useState<number>(0);
  const [grossSales, setGrossSales] = useState<number>(0);
  const [returnRate, setReturnRate] = useState<number>(0);
  const [trend, setTrend] = useState<ReturnTrendPoint[]>([]);
  const [topReturnedProducts, setTopReturnedProducts] = useState<ReturnedProduct[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    fetch(`/api/windsor/returns?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.source === 'shopify_live') {
          setTotalReturns(data.totalReturns ?? 0);
          setGrossSales(data.grossSales ?? 0);
          setReturnRate(data.returnRate ?? 0);
          setTrend(data.trend || []);
          setTopReturnedProducts(data.topReturnedProducts || []);
          setStatus('ok');
        } else {
          setTotalReturns(0);
          setGrossSales(0);
          setReturnRate(0);
          setTrend([]);
          setTopReturnedProducts([]);
          setStatus('error');
        }
      })
      .catch(() => {
        setTotalReturns(0);
        setGrossSales(0);
        setReturnRate(0);
        setTrend([]);
        setTopReturnedProducts([]);
        setStatus('error');
      });
  }, [tfRaw, dateFrom, dateTo]);

  const trendData = trend.map(d => ({
    date: d.date.slice(5),
    returns: d.returns,
  }));

  return (
    <div>
      <Header
        title="Returns"
        subtitle={`Return analysis · ${TIMEFRAME_LABELS[tfRaw] || tfRaw}`}
      >
        <TimeframeSelector />
      </Header>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Returns data is unavailable — Shopify query failed or hasn&apos;t synced yet.</span>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Return Rate"
          value={formatPercent(returnRate)}
          subtitle="Returns as % of gross sales"
          accentColor="#f9a8d4"
          valueColor={returnRate > 6 ? '#ef4444' : '#22c55e'}
        />
        <MetricCard
          title="Total Returns"
          value={formatCurrency(totalReturns)}
          subtitle="Dollar value returned"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Gross Sales"
          value={formatCurrency(grossSales)}
          subtitle="Before returns"
          accentColor="#86efac"
        />
        <MetricCard
          title="Top Returned Product"
          value={topReturnedProducts[0] ? topReturnedProducts[0].name.split(' ').slice(0, 2).join(' ') : '—'}
          subtitle={topReturnedProducts[0] ? formatCurrency(topReturnedProducts[0].returns) : '—'}
          accentColor="#fca5a5"
        />
      </div>

      {/* Return Trend */}
      <Card accentColor="#fdba74" className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Return Trend</h2>
        <p className="text-xs text-gray-400 mb-4">Daily return value ($)</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(trendData.length / 6) - 1)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => '$' + v}
              width={40}
            />
            <Tooltip
              formatter={(v: unknown) => [formatCurrency(Number(v)), 'Returns']}
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

      {/* Top Returned Products */}
      <Card accentColor="#fde68a">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Top Returned Products</h2>
        {topReturnedProducts.length === 0 ? (
          <p className="text-xs text-gray-400">No returns for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Product</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Returns ($)</th>
                </tr>
              </thead>
              <tbody>
                {topReturnedProducts.map(product => (
                  <tr key={product.name} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4 font-medium text-gray-800">{product.name}</td>
                    <td className="py-3 pl-4 text-right font-semibold text-gray-700">
                      {formatCurrency(product.returns)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
