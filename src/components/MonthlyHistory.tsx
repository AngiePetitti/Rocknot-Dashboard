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

const shiftYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');

export default function MonthlyHistory({ from, to, targetMer, targetCac, defaultYoY }: { from: string; to: string; targetMer?: number; targetCac?: number; defaultYoY?: boolean }) {
  const months = useMemo(() => monthsInRange(from, to), [from, to]);
  const [rows, setRows] = useState<Record<string, MonthPoint>>({});
  // Year over year: the same calendar month last year (same day span when
  // the current month is partial). Off by default unless the page's compare
  // basis is already "year"; remembered per browser once toggled.
  const [yoy, setYoy] = useState<boolean>(() => { try { const v = localStorage.getItem('monthly_history_yoy'); return v ? v === '1' : Boolean(defaultYoY); } catch { return Boolean(defaultYoY); } });
  const toggleYoy = () => setYoy(v => { const n = !v; try { localStorage.setItem('monthly_history_yoy', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const [lyRows, setLyRows] = useState<Record<string, NonNullable<MonthPoint['ly']>>>({});
  const [lyOther, setLyOther] = useState<Record<string, number>>({});
  useEffect(() => {
    setLyRows({}); setLyOther({});
    if (!yoy) return;
    months.forEach(mo => {
      const f = shiftYear(mo.from), t = shiftYear(mo.to);
      cachedJson<{ metrics?: Record<string, number | undefined> }>(`/api/windsor?tf=custom&date_from=${f}&date_to=${t}`, d => {
        const m = d?.metrics; if (!m) return;
        const spend = m.totalAdSpend ?? 0; const newC = m.newCustomers ?? 0;
        setLyRows(prev => ({ ...prev, [mo.key]: { revenue: m.totalRevenue ?? 0, adSpend: spend, mer: m.mer ?? null, ncac: newC > 0 && spend > 0 ? spend / newC : null, newCustomers: newC } }));
      }, () => {});
      fetch(`/api/expenses?tf=custom&date_from=${f}&date_to=${t}`, { cache: 'no-store' })
        .then(async r => (r.ok ? r.json() : null))
        .then(d => { if (d && !d.error && d.range) setLyOther(prev => ({ ...prev, [mo.key]: Number(d.range.nonAdMarketing) || 0 })); })
        .catch(() => {});
    });
  }, [yoy, months]);
  const [failed, setFailed] = useState(0);
  // Other marketing per month from the budgeting sheet (admin-only endpoint;
  // when it is not available the fully loaded panel simply does not show).
  const [other, setOther] = useState<Record<string, number>>({});
  const [otherOk, setOtherOk] = useState(false);
  useEffect(() => {
    setRows({}); setFailed(0); setOther({}); setOtherOk(false);
    months.forEach(mo => {
      fetch(`/api/expenses?tf=custom&date_from=${mo.from}&date_to=${mo.to}`, { cache: 'no-store' })
        .then(async r => (r.ok ? r.json() : null))
        .then(d => { if (d && !d.error && d.range) { setOther(prev => ({ ...prev, [mo.key]: Number(d.range.nonAdMarketing) || 0 })); setOtherOk(true); } })
        .catch(() => {});
      cachedJson<{ metrics?: Record<string, number | undefined> }>(`/api/windsor?tf=custom&date_from=${mo.from}&date_to=${mo.to}`, d => {
        const m = d?.metrics; if (!m) return;
        const spend = m.totalAdSpend ?? 0; const newC = m.newCustomers ?? 0;
        const label = new Date(`${mo.from}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }) + (mo.partial ? ' MTD' : '');
        setRows(prev => ({ ...prev, [mo.key]: { month: mo.key, label, partial: mo.partial, revenue: m.totalRevenue ?? 0, adSpend: spend, mer: m.mer ?? null, ncac: newC > 0 && spend > 0 ? spend / newC : null, newCustomers: newC } }));
      }, () => setFailed(f => f + 1));
    });
  }, [months]);

  if (months.length < 3) return null;
  const data = (months.map(mo => rows[mo.key]).filter(Boolean) as MonthPoint[]).map(d => {
    const o = other[d.month];
    const fl = o != null && d.newCustomers > 0 ? (d.adSpend + o) / d.newCustomers : null;
    const ly = yoy ? lyRows[d.month] ?? null : null;
    const lyO = lyOther[d.month];
    const lyFl = ly && lyO != null && (ly.newCustomers ?? 0) > 0 ? ((ly.adSpend ?? 0) + lyO) / (ly.newCustomers ?? 1) : null;
    return { ...d, otherMarketing: o ?? null, flCac: fl, ly: ly ? { ...ly, flCac: lyFl } : null };
  });
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
        <div className="flex items-center gap-3">
          {!loading && data.length > 0 && (
            <p className="text-xs text-gray-500 tabular-nums">
              {formatCurrency(totals.revenue)} revenue · {formatCurrency(totals.spend)} ad spend · MER {totals.spend > 0 ? `${(data.reduce((s, d) => s + (d.mer ?? 0) * d.adSpend, 0) / totals.spend).toFixed(2)}x` : '—'}{totals.newC > 0 ? ` · CAC $${Math.round(totals.spend / totals.newC)}` : ''}
            </p>
          )}
          <button type="button" onClick={toggleYoy} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${yoy ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>{yoy ? '✓ vs last year' : 'Compare to last year'}</button>
        </div>
      </div>
      {data.length === 0 ? <p className="text-xs text-gray-400 py-8 text-center">Loading month-by-month history…</p> : <MonthlyHistoryChart data={data} targetMer={targetMer} targetCac={targetCac} showFullyLoaded={otherOk} compareYoY={yoy} />}
      <p className="text-[11px] text-gray-400 mt-3">Each month on the Overview&apos;s own basis: revenue is total sales, MER uses this dashboard&apos;s MER basis, new-customer CAC is ad spend ÷ Shopify first-time buyers{otherOk ? '; fully loaded CAC adds the month\'s other marketing from the budgeting sheet (agency, content, email/SMS, tools, photoshoots, SEO) before dividing' : ''}. The current month is month to date.{yoy ? ' Grey bars are the same calendar month last year (same days for the current month); the line under each chart shows the change.' : ''}</p>
    </Card>
  );
}
