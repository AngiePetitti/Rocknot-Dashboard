'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface QBRow { [key: string]: string | number | null | undefined }
interface FinResponse {
  source?: string;
  error?: string;
  fieldsUsed?: string[];
  range?: { from: string; to: string };
  rows?: QBRow[];
  attempts?: Array<{ fields: string; error: string }>;
  discoveredFields?: string[];
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Classify a QuickBooks account_type into P&L sections.
function sectionOf(accountType: string): 'income' | 'cogs' | 'expense' | 'other' {
  const t = accountType.toLowerCase();
  if (t.includes('cost of goods')) return 'cogs';
  if (t.includes('income') || t.includes('revenue')) return 'income';
  if (t.includes('expense')) return 'expense';
  return 'other';
}

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

  // Build the P&L from whatever row shape came back: prefer account_type
  // grouping; amounts from the first numeric-looking amount field.
  const pl = useMemo(() => {
    const rows = data?.rows || [];
    if (!rows.length) return null;
    const keys = Object.keys(rows[0] || {});
    const amountKey = keys.find(k => /amount|balance|total/i.test(k));
    const nameKey = keys.find(k => /account.*name|name/i.test(k)) || 'account_name';
    const typeKey = keys.find(k => /account_type|type/i.test(k));
    if (!amountKey) return null;

    const bySection: Record<'income' | 'cogs' | 'expense' | 'other', Map<string, number>> = {
      income: new Map(), cogs: new Map(), expense: new Map(), other: new Map(),
    };
    for (const r of rows) {
      const amt = Number(r[amountKey] || 0);
      if (!amt) continue;
      const name = String(r[nameKey] ?? 'Unknown');
      const section = typeKey ? sectionOf(String(r[typeKey] ?? '')) : 'other';
      const m = bySection[section];
      m.set(name, (m.get(name) ?? 0) + amt);
    }
    const sum = (m: Map<string, number>) => Array.from(m.values()).reduce((s, v) => s + v, 0);
    const income = sum(bySection.income);
    const cogs = Math.abs(sum(bySection.cogs));
    const expense = Math.abs(sum(bySection.expense));
    const other = sum(bySection.other);
    return {
      bySection, income, cogs, expense, other,
      grossProfit: income - cogs,
      netIncome: income - cogs - expense,
      grouped: Boolean(typeKey),
    };
  }, [data]);

  const sectionRows = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

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

      {loading && <Card><p className="text-sm text-gray-400 text-center py-10">Loading QuickBooks data…</p></Card>}

      {!loading && data?.source === 'error' && (
        <Card accentColor="#fca5a5">
          <p className="text-sm font-semibold text-gray-700 mb-2">Couldn&apos;t read QuickBooks from Windsor yet</p>
          <p className="text-xs text-gray-500 mb-3">{data.error}</p>
          {(data.attempts?.length ?? 0) > 0 && (
            <div className="text-[11px] text-gray-400 space-y-1">
              {data.attempts!.map((a, i) => (
                <p key={i}><span className="font-mono">{a.fields}</span> → {a.error}</p>
              ))}
            </div>
          )}
          {(data.discoveredFields?.length ?? 0) > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-500 mb-1">Fields found on Windsor's QuickBooks reference page:</p>
              <p className="text-[11px] text-gray-400 font-mono break-words">{data.discoveredFields!.join(', ')}</p>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-3">Screenshot this and send it to Claude — the connector errors above name the fields it expects.</p>
        </Card>
      )}

      {!loading && pl && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <MetricCard title="Income" value={fmt(pl.income)} subtitle="QuickBooks revenue accounts" accentColor="#86efac" />
            <MetricCard title="COGS" value={fmt(pl.cogs)} subtitle="Cost of goods sold" accentColor="#fdba74" />
            <MetricCard title="Expenses" value={fmt(pl.expense)} subtitle="Operating expenses" accentColor="#fca5a5" />
            <MetricCard
              title="Net Income"
              value={fmt(pl.netIncome)}
              subtitle={pl.income > 0 ? `${((pl.netIncome / pl.income) * 100).toFixed(1)}% margin` : ''}
              accentColor="#a5b4fc"
              valueColor={pl.netIncome >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>

          {(['income', 'cogs', 'expense'] as const).map(section => {
            const rows = sectionRows(pl.bySection[section]);
            if (!rows.length) return null;
            const titles = { income: '💵 Income', cogs: '📦 Cost of Goods Sold', expense: '🧾 Expenses' };
            return (
              <Card key={section} className="mb-4">
                <h2 className="text-sm font-bold text-gray-700 mb-3">{titles[section]}</h2>
                <div className="flex flex-col gap-1">
                  {rows.map(([name, amt]) => (
                    <div key={name} className="flex items-center justify-between text-sm border-b border-gray-50 py-1.5">
                      <span className="text-gray-600 min-w-0 break-words pr-3">{name}</span>
                      <span className="font-semibold text-gray-800 whitespace-nowrap">{fmt(Math.abs(amt))}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          {!pl.grouped && (
            <p className="text-[11px] text-gray-400">
              Note: the connector didn&apos;t return account types, so items aren&apos;t split into income/COGS/expense yet — send Claude a screenshot and the grouping gets wired to the real fields.
            </p>
          )}
          <p className="text-[11px] text-gray-300 mt-2">Fields: {data?.fieldsUsed?.join(', ')} · {data?.range?.from} → {data?.range?.to} · via Windsor QuickBooks</p>
        </>
      )}
    </div>
  );
}
