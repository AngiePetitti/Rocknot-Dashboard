'use client';

import { useSearchParams } from 'next/navigation';
import { customerMetrics, cohortData, repeatCustomerProducts } from '@/src/lib/mockData';
import { formatCurrency, formatPercent } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import TimeframeSelector from '@/src/components/ui/TimeframeSelector';
import CustomerCohort from '@/src/components/charts/CustomerCohort';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function CustomersContent() {
  const searchParams = useSearchParams();

  const buybackData = [
    { order: '1st Order', avg: customerMetrics.firstOrderAvg, fill: '#c4b5fd' },
    { order: '2nd Order', avg: customerMetrics.secondOrderAvg, fill: '#f9a8d4' },
    { order: '3rd+ Order', avg: customerMetrics.thirdPlusOrderAvg, fill: '#86efac' },
  ];

  return (
    <div>
      <Header title="Customer Intelligence" subtitle="LTV, retention, and repeat purchase analysis">
        <TimeframeSelector />
      </Header>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Repeat Purchase Rate"
          value={formatPercent(customerMetrics.repeatPurchaserRate)}
          subtitle={`${customerMetrics.repeatCustomers.toLocaleString()} of ${customerMetrics.totalCustomers.toLocaleString()} customers`}
          accentColor="#c4b5fd"
          trend={{ value: '2.1% vs prior period', positive: true }}
        />
        <MetricCard
          title="Avg Lifetime Value"
          value={formatCurrency(customerMetrics.avgLTV)}
          subtitle="Per customer, all orders"
          accentColor="#f9a8d4"
        />
        <MetricCard
          title="Avg 1st Order Value"
          value={formatCurrency(customerMetrics.firstOrderAvg)}
          subtitle="New customer AOV"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Avg 3rd+ Order Value"
          value={formatCurrency(customerMetrics.thirdPlusOrderAvg)}
          subtitle="Loyal customer AOV"
          accentColor="#86efac"
        />
      </div>

      {/* Buyback Analysis + Repeat Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <Card accentColor="#f9a8d4">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Buyback Analysis</h2>
          <p className="text-xs text-gray-400 mb-4">
            Average order value by purchase number — loyal customers spend more
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={buybackData} barSize={64}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="order"
                tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => '$' + v}
                domain={[0, 120]}
                width={38}
              />
              <Tooltip
                formatter={(v: unknown) => [formatCurrency(Number(v)), 'Avg Order Value']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 12 }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="avg" radius={[8, 8, 0, 0]}>
                {buybackData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 p-3 bg-violet-50 rounded-xl">
            <p className="text-xs text-violet-700 font-medium">
              💡 Repeat customers spend{' '}
              <strong>
                {formatPercent(((customerMetrics.thirdPlusOrderAvg - customerMetrics.firstOrderAvg) / customerMetrics.firstOrderAvg) * 100, 0)} more
              </strong>{' '}
              by their 3rd order. Focus retention campaigns on 2nd purchase conversion.
            </p>
          </div>
        </Card>

        <Card accentColor="#86efac">
          <h2 className="text-sm font-bold text-gray-700 mb-1">What Repeat Customers Buy Most</h2>
          <p className="text-xs text-gray-400 mb-4">Products purchased by repeat buyers</p>
          <div className="space-y-3">
            {repeatCustomerProducts.map((product, i) => (
              <div key={product.name} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{product.name}</span>
                    <span className="text-xs font-semibold text-gray-500">
                      {product.purchaseCount} purchases
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${product.pct}%`,
                        backgroundColor: ['#c4b5fd', '#f9a8d4', '#fde68a', '#86efac', '#93c5fd'][i],
                      }}
                    />
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-600 w-10 text-right">
                  {formatPercent(product.pct)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* LTV Breakdown */}
      <Card accentColor="#c4b5fd" className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">LTV Breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label: 'New Customers (1 order)',
              count: customerMetrics.totalCustomers - customerMetrics.repeatCustomers,
              ltv: customerMetrics.firstOrderAvg,
              color: '#fde68a',
            },
            {
              label: 'Returning (2 orders)',
              count: Math.round(customerMetrics.repeatCustomers * 0.6),
              ltv: customerMetrics.firstOrderAvg + customerMetrics.secondOrderAvg,
              color: '#f9a8d4',
            },
            {
              label: 'Loyal (3+ orders)',
              count: Math.round(customerMetrics.repeatCustomers * 0.4),
              ltv: customerMetrics.avgLTV,
              color: '#86efac',
            },
          ].map(tier => (
            <div
              key={tier.label}
              className="rounded-xl p-4 border"
              style={{ borderColor: tier.color + '66', backgroundColor: tier.color + '15' }}
            >
              <p className="text-xs font-semibold text-gray-500 mb-2">{tier.label}</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(tier.ltv)}</p>
              <p className="text-xs text-gray-400 mt-1">
                {tier.count.toLocaleString()} customers ·{' '}
                {formatPercent((tier.count / customerMetrics.totalCustomers) * 100)} of base
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Cohort Chart */}
      <Card accentColor="#93c5fd">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Customer Cohort Retention</h2>
        <p className="text-xs text-gray-400 mb-5">
          % of customers from each cohort still purchasing in subsequent months
        </p>
        <CustomerCohort data={cohortData} />
        <p className="text-xs text-gray-400 mt-4">
          — = data not yet available for that month
        </p>
      </Card>
    </div>
  );
}
