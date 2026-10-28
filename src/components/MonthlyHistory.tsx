'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/src/components/ui/Card';
import { cachedJson } from '@/src/lib/clientCache';
import { formatCurrency } from '@/src/lib/utils';
import MonthlyHistoryChart, { type MonthPoint } from '@/src/components/charts/MonthlyHistoryChart';

/**
 * Month-by-month history for long ranges (3 months and up): revenue, ad
 * spend, MER and new-customer CAC per calendar month. Full months inside the
 * range plus the current month to date; a leading partial month is skipped
 * and said so.
 */
export function monthsInRange(from: string, to: string): Array<{ key: string; from: string; to: string; partial: boolean }> {
  const out: Array<{ key: string; from: string; to: string; partial: boolean }> = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const isCurrent = y === ty && m === tm;
    const startsInside = first >= from;
    if (startsInside) out.push({ key: first.slice(0, 7), from: first, to: isCurrent && to < last ? to : last, partial: isCurrent && to < last });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export default function MonthlyHistory({ from, to, targetMer, targetCac }: { from: string; to: string; targetMer?: number; targetCac?: number }) {
  const months = useMemo(() => monthsInRange(from, to), [from, to]);
  const [rows, setRows] = useState<Record<string, MonthPoint>>({});
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    setRows({}); setFailed(0);
    months.forEach(mo => {
      cachedJson<{ metrics?: Record<string, number | undefined> }>(`/api/windsor?tf=custom&date_from=${mo.from}&date_to=${mo.to}`, d => {
        const m = d?.metrics; if (!m) return;
        const spend = m.totalAdSpend ?? 0; const newC = m.newCustomers ?? 0;
        const label = new Date(`${mo.from}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }) + (mo.partial ? ' MTD' : '');
        setRows(prev => ({ ...prev, [mo.key]: { month: mo.key, label, partial: mo.partial, revenue: m.totalRevenue ?? 0, adSpend: spend, mer: m.mer ?? null, ncac: newC > 0 && spend > 0 ? spend / newC : null, newCustomers: newC } }));
      }, () => setFailed(f => f + 1));
    });
  }, [months]);

  if (months.length < 3) return null;
  const data = months.map(mo => rows[mo.key]).filter(Boolean) as MonthPoint[];
  const loading = data.length + failed < months.length;
  const skippedStart = from.slice(8) !== '01';
  const totals = data.reduce((s, d) => ({ revenue: s.revenue + d.revenue, spend: s.spend + d.adSpend, newC: s.newC + d.newCustomers }), { revenue: 0, spend: 0, newC: 0 });
  return (
    <Card accentColor="#c4b5fd" className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-700">Month by month</h2>
          <p className="text-xs text-gray-400">
            {data.length ? `${data[0].label} – ${data[data.length - 1].label}` : 'Loading…'}{skippedStart ? ` · the range starts on ${from}, so the first partial month is left out` : ''}{loading ? ' · loading…' : ''}
          </p>
        </div>
        {!loading && data.length > 0 && (
          <p className="text-xs text-gray-500 tabular-nums">
            {formatCurrency(totals.revenue)} revenue · {formatCurrency(totals.spend)} ad spend · MER {totals.spend > 0 ? `${(data.reduce((s, d) => s + (d.mer ?? 0) * d.adSpend, 0) / totals.spend).toFixed(2)}x` : '—'}{totals.newC > 0 ? ` · CAC $${Math.round(totals.spend / totals.newC)}` : ''}
          </p>
        )}
      </div>
      {data.length === 0 ? <p className="text-xs text-gray-400 py-8 text-center">Loading month-by-month history…</p> : <MonthlyHistoryChart data={data} targetMer={targetMer} targetCac={targetCac} />}
      <p className="text-[11px] text-gray-400 mt-3">Each month on the Overview&apos;s own basis: revenue is total sales, MER uses this dashboard&apos;s MER basis, new-customer CAC is ad spend ÷ Shopify first-time buyers. The current month is month to date.</p>
    </Card>
  );
}
