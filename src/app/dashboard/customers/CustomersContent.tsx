'use client';

import { cachedJson } from '@/src/lib/clientCache';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CustomerMetrics, CohortData } from '@/src/lib/mockData';
import { formatCurrency, formatPercent } from '@/src/lib/utils';

const EMPTY_METRICS: CustomerMetrics = {
  repeatPurchaserRate: 0,
  avgLTV: 0,
  firstOrderAvg: 0,
  secondOrderAvg: 0,
  thirdPlusOrderAvg: 0,
  totalCustomers: 0,
  repeatCustomers: 0,
  activeCustomers: 0,
  oneOrderCount: 0,
  twoOrderCount: 0,
  threePlusCount: 0,
  ltvOneOrder: 0,
  ltvTwoOrders: 0,
  ltvThreePlus: 0,
};
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
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const [customerMetrics, setCustomerMetrics] = useState<CustomerMetrics>(EMPTY_METRICS);
  const [cohortData, setCohortData] = useState<CohortData[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [payback, setPayback] = useState<{ month: string; size: number; cac: number | null; revPerCustomer: number[]; ltvToDate: number }[]>([]);
  const [paybackError, setPaybackError] = useState<string | null>(null);

  // Contribution margin before ad spend, from the booked P&L months
  // (COGS + non-ad overhead). Falls back to 0.70 if the basis endpoint is
  // unavailable (non-admins).
  const [contrib, setContrib] = useState(0.7);

  useEffect(() => {
    cachedJson<{ source?: string; cohorts?: typeof payback; error?: string }>(
      '/api/windsor/payback',
      d => {
        if (d.source === 'bigquery_live' && Array.isArray(d.cohorts)) setPayback(d.cohorts);
        else setPaybackError(d.error || 'unavailable');
      },
      () => setPaybackError('request failed')
    );
    fetch('/api/financials/basis?tf=30d')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const cogs = Number(d?.cogsPct), opex = Number(d?.nonAdOpexPct);
        if (Number.isFinite(cogs) && Number.isFinite(opex) && cogs + opex > 0 && cogs + opex < 90) {
          setContrib(Math.round((1 - (cogs + opex) / 100) * 100) / 100);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ tf: tfRaw });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    cachedJson<Record<string, unknown> & { source?: string }>(
      `/api/windsor/customers?${params}`,
      (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.source === 'bigquery_live' && data.customerMetrics) {
          setCustomerMetrics(data.customerMetrics);
          setCohortData(data.cohortData || []);
          setStatus('ok');
        } else {
          setCustomerMetrics(EMPTY_METRICS);
          setCohortData([]);
          setStatus('error');
        }
      },
      () => {
        setCustomerMetrics(EMPTY_METRICS);
        setCohortData([]);
        setStatus('error');
      }
    );
  }, [tfRaw, dateFrom, dateTo]);

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

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Customer data is unavailable — BigQuery query failed or hasn&apos;t synced yet.</span>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Returning Customer Rate"
          value={formatPercent(customerMetrics.repeatPurchaserRate)}
          subtitle={`${customerMetrics.repeatCustomers.toLocaleString()} of ${customerMetrics.totalCustomers.toLocaleString()} customers (Shopify)`}
          accentColor="#c4b5fd"
        />
        <MetricCard
          title="Avg Lifetime Value"
          value={formatCurrency(customerMetrics.avgLTV)}
          subtitle="Per customer · all-time spend"
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

      {/* Buyback Analysis */}
      <div className="grid grid-cols-1 gap-5 mb-6">
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
                domain={[0, 'auto']}
                width={44}
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
                {customerMetrics.firstOrderAvg > 0
                  ? formatPercent(((customerMetrics.thirdPlusOrderAvg - customerMetrics.firstOrderAvg) / customerMetrics.firstOrderAvg) * 100, 0)
                  : '—'} more
              </strong>{' '}
              by their 3rd order. Focus retention campaigns on 2nd purchase conversion.
            </p>
          </div>
        </Card>
      </div>

      {/* LTV Breakdown */}
      <Card accentColor="#c4b5fd" className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1">LTV Breakdown</h2>
        <p className="text-xs text-gray-400 mb-4">
          Customers who ordered in this period, grouped by lifetime order count · value = avg total spend across all orders ever
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label: 'One-time (1 order)',
              count: customerMetrics.oneOrderCount,
              ltv: customerMetrics.ltvOneOrder,
              color: '#fde68a',
            },
            {
              label: 'Returning (2 orders)',
              count: customerMetrics.twoOrderCount,
              ltv: customerMetrics.ltvTwoOrders,
              color: '#f9a8d4',
            },
            {
              label: 'Loyal (3+ orders)',
              count: customerMetrics.threePlusCount,
              ltv: customerMetrics.ltvThreePlus,
              color: '#86efac',
            },
          ].map(tier => (
            <div
              key={tier.label}
              className="rounded-xl p-4 border"
              style={{ borderColor: tier.color + '66', backgroundColor: tier.color + '15' }}
            >
              <p className="text-xs font-semibold text-gray-500 mb-2">{tier.label}</p>
              <p className="text-2xl font-bold text-gray-800">{tier.ltv > 0 ? formatCurrency(tier.ltv) : '—'}</p>
              <p className="text-xs text-gray-400 mt-1">
                {tier.count.toLocaleString()} customers ·{' '}
                {customerMetrics.activeCustomers > 0
                  ? formatPercent((tier.count / customerMetrics.activeCustomers) * 100)
                  : '—'} of base
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

      {/* ── Payback & LTV ── */}
      <Card accentColor="#86efac" className="mt-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1">💸 Payback &amp; LTV by acquisition month</h2>
        <p className="text-xs text-gray-400 mb-4">
          Every customer, grouped by first-purchase month. CAC = that month&apos;s total ad spend ÷ new customers.
          Payback = when the cohort&apos;s cumulative net sales × {Math.round(contrib * 100)}% contribution margin
          (from your booked P&amp;L) covers CAC. LTV grows as cohorts age — young cohorts aren&apos;t done yet.
        </p>
        {paybackError && <p className="text-xs text-red-500 mb-2">Payback data unavailable — {paybackError}</p>}
        {payback.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Cohort', 'New Customers', 'CAC', '1st-Month Rev / Cust.', 'LTV to Date / Cust.', 'Contribution vs CAC', 'Paid Back'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...payback].reverse().map(c => {
                  const label = new Date(c.month + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
                  const m0 = c.revPerCustomer[0] ?? 0;
                  const multiple = c.cac ? (c.ltvToDate * contrib) / c.cac : null;
                  // First month offset where cumulative contribution covers CAC.
                  let paidBack: string = '—';
                  if (c.cac) {
                    const idx = c.revPerCustomer.findIndex(r => r * contrib >= c.cac!);
                    paidBack = idx === 0 ? '1st order' : idx > 0 ? `month ${idx + 1}` : 'not yet';
                  }
                  return (
                    <tr key={c.month} className="border-b border-gray-50">
                      <td className="py-2 pr-4 font-semibold text-gray-800 whitespace-nowrap">{label}</td>
                      <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{c.size.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{c.cac ? formatCurrency(c.cac) : '—'}</td>
                      <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{formatCurrency(m0)}</td>
                      <td className="py-2 pr-4 font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(c.ltvToDate)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {multiple !== null ? (
                          <span className="text-xs font-bold" style={{ color: multiple >= 1 ? '#16a34a' : '#dc2626' }}>
                            {multiple.toFixed(1)}x
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <span className={`text-xs font-bold ${paidBack === '1st order' ? 'text-green-600' : paidBack === 'not yet' ? 'text-red-600' : 'text-amber-600'}`}>
                          {paidBack}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {payback.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-3">
            Revenue is net sales. The current month&apos;s cohort and CAC are partial. &quot;Contribution vs CAC&quot; above 1.0x means
            the cohort has already returned more profit-before-ads than it cost to acquire.
          </p>
        )}
      </Card>
    </div>
  );
}
