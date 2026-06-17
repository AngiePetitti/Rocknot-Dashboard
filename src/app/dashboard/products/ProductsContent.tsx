'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent, TIMEFRAME_LABELS } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
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

const PRODUCT_COLORS = ['#c4b5fd', '#f9a8d4', '#fde68a', '#86efac', '#93c5fd', '#fdba74', '#ddd6fe', '#fce7f3', '#fef9c3', '#dcfce7'];

interface ProductSales {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  percentOfTotal: number;
}

export default function ProductsContent() {
  const searchParams = useSearchParams();
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [products, setProducts] = useState<ProductSales[]>([]);
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [totalUnits, setTotalUnits] = useState<number>(0);
  const [totalGrossProfit, setTotalGrossProfit] = useState<number>(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    fetch(`/api/windsor/products?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.source === 'shopify_live') {
          setProducts(data.products || []);
          setTotalRevenue(data.totalRevenue ?? 0);
          setTotalUnits(data.totalUnits ?? 0);
          setTotalGrossProfit(data.totalGrossProfit ?? 0);
          setStatus('ok');
        } else {
          setProducts([]);
          setTotalRevenue(0);
          setTotalUnits(0);
          setTotalGrossProfit(0);
          setStatus('error');
        }
      })
      .catch(() => {
        setProducts([]);
        setTotalRevenue(0);
        setTotalUnits(0);
        setStatus('error');
      });
  }, [tfRaw, dateFrom, dateTo]);

  const topProduct = products[0];

  const barData = products.slice(0, 8).map((p, i) => ({
    name: p.name.slice(0, 20),
    revenue: p.revenue,
    color: PRODUCT_COLORS[i],
  }));

  return (
    <div>
      <Header title="Top Products" subtitle={`Sales performance · ${TIMEFRAME_LABELS[tfRaw] || tfRaw}`}>
        <TimeframeSelector />
      </Header>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Product sales data is unavailable — Shopify query failed or hasn&apos;t synced yet.</span>
        </div>
      )}
      {status === 'ok' && products.length === 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-amber-700">
          <span>⚠️</span>
          <span>No product sales for this period.</span>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          subtitle="Net sales · all products"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Units Sold"
          value={totalUnits.toLocaleString()}
          subtitle="Across all products"
          accentColor="#86efac"
        />
        <MetricCard
          title="Gross Profit"
          value={totalGrossProfit > 0 ? formatCurrency(totalGrossProfit) : '—'}
          subtitle={
            totalGrossProfit > 0 && totalRevenue > 0
              ? `${formatPercent(Math.round((totalGrossProfit / totalRevenue) * 1000) / 10)} blended margin`
              : 'After product cost (COGS)'
          }
          accentColor="#c4b5fd"
        />
        <MetricCard
          title="Top Product"
          value={topProduct ? topProduct.name.split(' ').slice(0, 2).join(' ') : '—'}
          subtitle={topProduct ? `${formatCurrency(topProduct.revenue)} · ${formatPercent(topProduct.percentOfTotal)}` : '—'}
          accentColor="#f9a8d4"
        />
      </div>

      {/* Bar Chart */}
      <Card accentColor="#fde68a" className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Revenue by Product</h2>
        <p className="text-xs text-gray-400 mb-4">Top 8 products</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: '#374151', fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              width={130}
            />
            <Tooltip
              formatter={(v: unknown) => [formatCurrency(Number(v)), 'Revenue']}
              contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
              cursor={{ fill: '#f8fafc' }}
            />
            <Bar dataKey="revenue" radius={[0, 6, 6, 0]} barSize={22}>
              {barData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Products Table */}
      <Card accentColor="#86efac">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Top Sellers Table</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Rank</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Product</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Category</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Units Sold</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Revenue</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Gross Profit</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-4">Gross Margin</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-4">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, i) => (
                <tr key={product.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: PRODUCT_COLORS[i] || '#e2e8f0', color: '#374151' }}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-medium text-gray-800">{product.name}</td>
                  <td className="py-3 pr-4">
                    <span className="text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                      {product.category}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{product.unitsSold.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-800">{formatCurrency(product.revenue)}</td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-800">
                    {product.grossProfit > 0 ? formatCurrency(product.grossProfit) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {product.grossProfit > 0 ? (
                      <span
                        className="font-semibold"
                        style={{ color: product.grossMargin >= 50 ? '#22c55e' : product.grossMargin >= 30 ? '#374151' : '#ef4444' }}
                      >
                        {formatPercent(product.grossMargin)}
                      </span>
                    ) : (
                      <span className="text-gray-400" title="No cost-per-item set for this product">—</span>
                    )}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${product.percentOfTotal}%`,
                            backgroundColor: PRODUCT_COLORS[i] || '#e2e8f0',
                          }}
                        />
                      </div>
                      <span className="text-gray-600 w-12 text-right">
                        {formatPercent(product.percentOfTotal)}
                      </span>
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
