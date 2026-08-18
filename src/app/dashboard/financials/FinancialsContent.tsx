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
interface MonthRow { month: string; income: number; cogs: number; expenses: number; net: number }
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
  const [data, setData] = useState<FinResponse | null>(null);
  const [loading, setLoading] = useState(true);

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
              <h2 className="text-sm font-bold text-gray-700 mb-3">📅 Monthly Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2">Month</th>
                      <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3">Income</th>
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
