'use client';

import { cachedJson } from '@/src/lib/clientCache';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import {
  LineChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface ReturnedProduct {
  name: string;
  category: string;
  grossSales: number;
  returns: number;
  netSales: number;
  returnRate: number;
}

interface ReturnTrendPoint { date: string; returns: number; }
interface CategoryReturn { category: string; returns: number; grossSales: number; returnRate: number; }

const CATEGORY_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a78bfa', '#60a5fa', '#34d399', '#f472b6'];

export default function ReturnsContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [totalReturns, setTotalReturns] = useState(0);
  const [grossSales, setGrossSales] = useState(0);
  const [netSales, setNetSales] = useState(0);
  const [returnRate, setReturnRate] = useState(0);
  const [trend, setTrend] = useState<ReturnTrendPoint[]>([]);
  const [tsField, setTsField] = useState<string>('day');
  const [products, setProducts] = useState<ReturnedProduct[]>([]);
  const [categories, setCategories] = useState<CategoryReturn[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [productFilter, setProductFilter] = useState<string>('all');

  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    cachedJson<Record<string, unknown> & { source?: string }>(
      `/api/windsor/returns?${params}`,
      (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.source === 'shopify_live') {
          setTotalReturns(data.totalReturns ?? 0);
          setGrossSales(data.grossSales ?? 0);
          setNetSales(data.netSales ?? 0);
          setReturnRate(data.returnRate ?? 0);
          setTrend(data.trend || []);
          setTsField(data.tsField || 'day');
          setProducts(data.topReturnedProducts || []);
          setCategories(data.categoryBreakdown || []);
          setStatus('ok');
        } else {
          setStatus('error');
        }
      },
      () => setStatus('error')
    );
  }, [tfRaw, dateFrom, dateTo]);

  // Unique categories from product list for filter
  const allCategories = Array.from(new Set(products.map(p => p.category))).filter(Boolean);
  const filteredProducts = productFilter === 'all'
    ? products
    : products.filter(p => p.category === productFilter);

  const trendData = trend.map(d => ({
    date: tsField === 'month'
      ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })
      : d.date.slice(5),
    returns: d.returns,
  }));

  const highReturnProducts = products.filter(p => p.returnRate >= 20);

  return (
    <div>
      <Header title="Returns" subtitle={`Return analysis · ${TIMEFRAME_LABELS[tfRaw] || tfRaw}`}>
        <TimeframeSelector />
      </Header>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Returns data unavailable — Shopify query failed.</span>
        </div>
      )}

      {/* High return rate alert */}
      {status === 'ok' && highReturnProducts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
          <p className="text-xs font-bold text-red-700 mb-1.5">
            ⚠️ {highReturnProducts.length} product{highReturnProducts.length !== 1 ? 's' : ''} with 20%+ return rate
          </p>
          <div className="flex flex-wrap gap-2">
            {highReturnProducts.slice(0, 6).map(p => (
              <span key={p.name} className="text-xs bg-white border border-red-200 rounded-full px-2.5 py-0.5 text-red-700 font-medium">
                {p.name} · {formatPercent(p.returnRate)}
              </span>
            ))}
            {highReturnProducts.length > 6 && (
              <span className="text-xs text-red-400">+{highReturnProducts.length - 6} more</span>
            )}
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Return Rate"
          value={formatPercent(returnRate)}
          subtitle="Returns ÷ gross sales"
          accentColor="#fca5a5"
          valueColor={returnRate > 10 ? '#ef4444' : returnRate > 6 ? '#f97316' : '#22c55e'}
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
          subtitle="Before returns & discounts"
          accentColor="#86efac"
        />
        <MetricCard
          title="Net Sales"
          value={formatCurrency(netSales)}
          subtitle="After returns & discounts"
          accentColor="#c4b5fd"
        />
      </div>

      {/* Trend + Category side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Return Trend */}
        <Card accentColor="#fdba74" className="lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Return Trend</h2>
          <p className="text-xs text-gray-400 mb-4">
            {tsField === 'month' ? 'Monthly' : 'Daily'} return value ($)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(trendData.length / 6) - 1)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} width={40} />
              <Tooltip formatter={(v: unknown) => [formatCurrency(Number(v)), 'Returns']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} cursor={{ stroke: '#e2e8f0' }} />
              <Line type="monotone" dataKey="returns" stroke="#f97316" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Returns by Category */}
        <Card accentColor="#fca5a5">
          <h2 className="text-sm font-bold text-gray-700 mb-1">By Category</h2>
          <p className="text-xs text-gray-400 mb-3">Return rate per product type</p>
          {categories.length === 0 ? (
            <p className="text-xs text-gray-400">No category data.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {categories.map((cat, i) => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{cat.category}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{formatCurrency(cat.returns)}</span>
                      <span
                        className="text-xs font-bold w-12 text-right"
                        style={{ color: cat.returnRate >= 20 ? '#ef4444' : cat.returnRate >= 10 ? '#f97316' : '#374151' }}
                      >
                        {formatPercent(cat.returnRate)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(cat.returnRate * 3, 100)}%`,
                        background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Returns by Category bar chart */}
      {categories.length > 0 && (
        <Card accentColor="#a78bfa" className="mb-5">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Return $ by Category</h2>
          <p className="text-xs text-gray-400 mb-4">Dollar value of returns per product type</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: '#374151' }}
                axisLine={false} tickLine={false} width={80} />
              <Tooltip formatter={(v: unknown) => [formatCurrency(Number(v)), 'Returns']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="returns" radius={[0, 6, 6, 0]} barSize={18}>
                {categories.map((_, i) => (
                  <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Product detail table */}
      <Card accentColor="#fde68a">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <h2 className="text-sm font-bold text-gray-700 flex-1">Top Returned Products</h2>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setProductFilter('all')}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={productFilter === 'all' ? { background: '#818cf8', color: '#fff', borderColor: '#818cf8' } : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
              All
            </button>
            {allCategories.map(cat => (
              <button key={cat} onClick={() => setProductFilter(cat)}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={productFilter === cat ? { background: '#818cf8', color: '#fff', borderColor: '#818cf8' } : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <p className="text-xs text-gray-400">No returns for this period.</p>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 md:hidden">
              {filteredProducts.map(p => (
                <div key={p.name} className="border border-gray-100 rounded-xl p-3 bg-white">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                      <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 mt-0.5 inline-block">{p.category}</span>
                    </div>
                    <span className="text-sm font-bold flex-shrink-0"
                      style={{ color: p.returnRate >= 20 ? '#ef4444' : p.returnRate >= 10 ? '#f97316' : '#374151' }}>
                      {formatPercent(p.returnRate)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-2">
                      <p className="text-xs text-gray-400 mb-0.5">Gross</p>
                      <p className="text-xs font-bold text-gray-700">{formatCurrency(p.grossSales)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg py-2">
                      <p className="text-xs text-gray-400 mb-0.5">Returns</p>
                      <p className="text-xs font-bold text-red-600">{formatCurrency(p.returns)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg py-2">
                      <p className="text-xs text-gray-400 mb-0.5">Net</p>
                      <p className="text-xs font-bold" style={{ color: p.netSales < 0 ? '#ef4444' : '#374151' }}>
                        {formatCurrency(p.netSales)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Product</th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Category</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Gross Sales</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Returns ($)</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Net Sales</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">Return Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => (
                    <tr key={p.name} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-gray-800">{p.name}</td>
                      <td className="py-3 pr-4">
                        <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{p.category}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(p.grossSales)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-red-500">{formatCurrency(p.returns)}</td>
                      <td className="py-3 px-4 text-right font-semibold" style={{ color: p.netSales < 0 ? '#ef4444' : '#374151' }}>
                        {formatCurrency(p.netSales)}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <span
                          className="font-bold text-xs px-2 py-0.5 rounded-full"
                          style={{
                            color: p.returnRate >= 20 ? '#dc2626' : p.returnRate >= 10 ? '#ea580c' : '#16a34a',
                            background: p.returnRate >= 20 ? '#fee2e2' : p.returnRate >= 10 ? '#ffedd5' : '#dcfce7',
                          }}
                        >
                          {formatPercent(p.returnRate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
