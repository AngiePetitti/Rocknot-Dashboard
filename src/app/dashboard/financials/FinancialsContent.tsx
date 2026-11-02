'use client';

import { useEffect, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface Totals {
  income: number; cogs: number; grossProfit: number; expenses: number;
  totalExpenses: number; otherIncome: number; otherExpenses: number;
  incomeTax: number; netOperatingIncome: number; netIncome: number;
}
interface MonthRow { month: string; income: number; shopifySales?: number; cogs: number; expenses: number; net: number }
interface FinResponse {
  source?: string;
  error?: string;
  range?: { from: string; to: string };
  rowCount?: number;
  accountUsed?: string;
  accountsSeen?: string[];
  totals?: Totals;
  monthly?: MonthRow[];
  lineItems?: Array<{ account: string; amount: number; section: string; isSummary?: boolean }> | null;
  categorized?: Array<{ account: string; amount: number; bucket: string; overridden: boolean }> | null;
  buckets?: Record<string, number> | null;
  fullyLoadedMer?: number | null;
  revenueBooked?: number;
  qbDirect?: boolean;
  qbError?: string | null;
}

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString()}`;

const RANGES = [
  { key: 'mtd', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'qtd', label: 'This Quarter' },
  { key: 'ytd', label: 'YTD' },
];

function rangeDates(key: string): { from: string; to: string } {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [y, m] = today.split('-').map(Number);
  if (key === 'mtd') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === 'last_month') {
    const first = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
    const last = new Date(y, m - 1, 0).toLocaleDateString('en-CA');
    return { from: first, to: last };
  }
  if (key === 'qtd') {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${y}-${String(qStartMonth).padStart(2, '0')}-01`, to: today };
  }
  return { from: `${y}-01-01`, to: today };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
};

export default function FinancialsContent() {
  const [range, setRange] = useState('mtd');
  const [savingAcct, setSavingAcct] = useState<string | null>(null);
  const [data, setData] = useState<FinResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function setBucket(account: string, bucket: string) {
    setSavingAcct(account);
    try {
      await fetch('/api/financials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, bucket }),
      });
      // Re-pull so bucket totals and fully-loaded MER recompute server-side.
      const { from, to } = rangeDates(range);
      const d = await fetch(`/api/financials?date_from=${from}&date_to=${to}`, { cache: 'no-store' }).then(r => r.json());
      setData(d);
    } finally {
      setSavingAcct(null);
    }
  }

  useEffect(() => {
    setLoading(true);
    const { from, to } = rangeDates(range);
    fetch(`/api/financials?date_from=${from}&date_to=${to}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(e => setData({ source: 'error', error: String(e) }))
      .finally(() => setLoading(false));
  }, [range]);

  const t = data?.totals;
  const lineItems: Array<{ label: string; value: number }> = t ? [
    { label: 'Income', value: t.income },
    { label: 'Cost of Goods Sold', value: -t.cogs },
    { label: 'Gross Profit', value: t.grossProfit },
    { label: 'Operating Expenses', value: -t.expenses },
    { label: 'Net Operating Income', value: t.netOperatingIncome },
    { label: 'Other Income', value: t.otherIncome },
    { label: 'Other Expenses', value: -t.otherExpenses },
    { label: 'Income Tax', value: -t.incomeTax },
  ].filter(li => li.value !== 0 || ['Income', 'Cost of Goods Sold', 'Gross Profit', 'Operating Expenses'].includes(li.label)) : [];

  return (
    <div>
      <Header title="Financials" subtitle="P&L from QuickBooks · admin only" />

      <div className="flex flex-wrap gap-1.5 mb-4">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              range === r.key ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && <Card><p className="text-sm text-gray-400 text-center py-10">Loading QuickBooks P&L…</p></Card>}

      {!loading && data?.source === 'error' && (
        <Card accentColor="#fca5a5">
          <p className="text-sm font-semibold text-gray-700 mb-2">Couldn&apos;t read the QuickBooks P&L from Windsor</p>
          <p className="text-xs text-gray-500">{data.error}</p>
        </Card>
      )}

      {!loading && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <MetricCard title="Income" value={fmt(t.income)} subtitle="QuickBooks revenue" accentColor="#86efac" />
            <MetricCard title="Gross Profit" value={fmt(t.grossProfit)} subtitle={t.income > 0 ? `${((t.grossProfit / t.income) * 100).toFixed(1)}% gross margin` : 'Income − COGS'} accentColor="#fde68a" />
            <MetricCard title="Expenses" value={fmt(t.expenses)} subtitle="Operating expenses" accentColor="#fca5a5" />
            <MetricCard
              title="Net Income"
              value={fmt(t.netIncome)}
              subtitle={t.income > 0 ? `${((t.netIncome / t.income) * 100).toFixed(1)}% net margin` : ''}
              accentColor="#a5b4fc"
              valueColor={t.netIncome >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>

          {data?.buckets && data?.categorized && (
            <Card className="mb-4" accentColor="#c4b5fd">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-gray-700">📊 Expense Groups &amp; Fully-Loaded MER</h2>
                  <p className="text-xs text-gray-400">Every expense account grouped — change a group and the totals recalc. Overrides are remembered.</p>
                </div>
                {data.fullyLoadedMer != null && (
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-semibold text-gray-400">Fully-Loaded MER</p>
                    <p className={`text-2xl font-bold ${data.fullyLoadedMer >= 3 ? 'text-green-600' : 'text-amber-600'}`}>{data.fullyLoadedMer.toFixed(2)}x</p>
                    <p className="text-[10px] text-gray-400">booked revenue {fmt(data.revenueBooked ?? 0)} ÷ ALL marketing {fmt(data.buckets.marketing)}</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                {(['marketing', 'payroll', 'software', 'fulfillment', 'other'] as const).map(b => (
                  <div key={b} className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-[10px] uppercase font-semibold text-gray-400">{b === 'payroll' ? 'Payroll & Labor' : b}</p>
                    <p className="text-sm font-bold text-gray-800">{fmt(data.buckets![b] || 0)}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col max-h-96 overflow-y-auto">
                {[...data.categorized].sort((a, b) => a.bucket.localeCompare(b.bucket) || b.amount - a.amount).map(c => (
                  <div key={c.account} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50">
                    <span className="min-w-0 break-words flex-1 text-gray-600">{c.account}</span>
                    <span className="font-semibold whitespace-nowrap text-gray-800">{fmt(c.amount)}</span>
                    <select
                      value={c.bucket}
                      disabled={savingAcct === c.account}
                      onChange={e => setBucket(c.account, e.target.value)}
                      className={`text-[11px] border rounded-lg px-1.5 py-1 bg-white ${c.overridden ? 'border-violet-300 text-violet-700' : 'border-gray-200 text-gray-500'}`}
                    >
                      <option value="marketing">Marketing</option>
                      <option value="payroll">Payroll & Labor</option>
                      <option value="software">Software</option>
                      <option value="fulfillment">Fulfillment</option>
                      <option value="other">Other</option>
                      {c.overridden && <option value="auto">↺ auto</option>}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Fully-Loaded MER = QuickBooks booked revenue ÷ everything grouped as Marketing (platform ad spend as billed, agency fees, influencers, marketing tools). The Overview&apos;s Paid-Media MER divides by platform ad spend only — this number is the true cost of growth.
              </p>
            </Card>
          )}

          <Card className="mb-4" accentColor="#86efac">
            <h2 className="text-sm font-bold text-gray-700 mb-3">🧾 Profit &amp; Loss</h2>
            <div className="flex flex-col">
              {lineItems.map(li => (
                <div key={li.label} className={`flex items-center justify-between text-sm py-2 border-b border-gray-50 ${li.label === 'Gross Profit' || li.label === 'Net Operating Income' ? 'font-semibold' : ''}`}>
                  <span className="text-gray-600">{li.label}</span>
                  <span className={`font-semibold whitespace-nowrap ${li.value < 0 ? 'text-red-600' : 'text-gray-800'}`}>{fmt(li.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm py-2.5 font-bold">
                <span className="text-gray-800">Net Income</span>
                <span className={t.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}>{fmt(t.netIncome)}</span>
              </div>
            </div>
          </Card>

          {(data?.lineItems?.length ?? 0) > 0 && (
            <Card className="mb-4" accentColor="#fde68a">
              <h2 className="text-sm font-bold text-gray-700 mb-1">📒 P&L Line Items</h2>
              <p className="text-xs text-gray-400 mb-3">Straight from QuickBooks — every account, in statement order</p>
              <div className="flex flex-col">
                {data!.lineItems!.map((li, i) => (
                  <div key={`${li.account}-${i}`} className={`flex items-center justify-between text-sm py-1.5 border-b border-gray-50 ${li.isSummary ? 'font-bold bg-gray-50 -mx-2 px-2 rounded' : ''}`}>
                    <span className={`min-w-0 break-words pr-3 ${li.isSummary ? 'text-gray-800' : 'text-gray-600'}`}>{li.account}</span>
                    <span className={`font-semibold whitespace-nowrap ${li.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>{fmt(li.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!data?.lineItems && (
            <Card className="mb-4" accentColor="#fde68a">
              <p className="text-xs font-semibold text-gray-600 mb-1">Full line items need a direct QuickBooks connection (Windsor only carries summary totals).</p>
              {data?.qbError
                ? <p className="text-[11px] text-red-500">QuickBooks error: {data.qbError}</p>
                : <p className="text-[11px] text-gray-400">One-time setup: open <span className="font-mono">/api/debug/qb-oauth</span> while logged in and follow the two steps — after that, this card becomes the full account-by-account P&L.</p>}
            </Card>
          )}

          {(data?.monthly?.length ?? 0) > 1 && (
            <Card className="mb-4" accentColor="#a5b4fc">
              <h2 className="text-sm font-bold text-gray-700 mb-1">📅 Monthly Breakdown</h2>
              <p className="text-xs text-gray-400 mb-3">Gap = QuickBooks income − Shopify total sales. Small gaps are normal (fees, timing); big amber gaps usually mean bookkeeping hasn't caught up for that month.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2">Month</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">QB Income</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Shopify Sales</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Gap</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">COGS</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Expenses</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.monthly!.map(m => (
                      <tr key={m.month} className="border-b border-gray-50">
                        <td className="py-2 text-gray-700 font-medium">{monthLabel(m.month)}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{fmt(m.income)}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{m.shopifySales ? fmt(m.shopifySales) : '—'}</td>
                        <td className={`py-2 px-3 text-right text-xs font-semibold ${m.shopifySales && Math.abs(m.income - m.shopifySales) / m.shopifySales > 0.15 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {m.shopifySales ? fmt(m.income - m.shopifySales) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600">{fmt(m.cogs)}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{fmt(m.expenses)}</td>
                        <td className={`py-2 pl-3 text-right font-semibold ${m.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <p className="text-[11px] text-gray-300">
            QuickBooks via Windsor · account: {data?.accountUsed || 'unknown'}{(data?.accountsSeen?.length ?? 0) > 1 ? ` (of ${data!.accountsSeen!.length} on the connection — others excluded)` : ''} · {data?.range?.from} → {data?.range?.to}
            {data?.rowCount === 0 ? ' · no rows returned for this range yet (QuickBooks syncs may lag a day)' : ''}
          </p>
        </>
      )}
    </div>
  );
}
