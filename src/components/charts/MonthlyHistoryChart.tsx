'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Legend } from 'recharts';

export interface MonthPoint { month: string; label: string; partial: boolean; revenue: number; adSpend: number; mer: number | null; ncac: number | null; newCustomers: number; otherMarketing?: number | null; flCac?: number | null; /** Same month last year (same day span for a partial month). */ ly?: Partial<Pick<MonthPoint, 'revenue' | 'adSpend' | 'mer' | 'ncac' | 'flCac' | 'newCustomers'>> | null }

const fmtK = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K` : `$${Math.round(v)}`);

// Four small single-series bar charts (one axis each; value labels on every bar
// so the numbers read on a phone). Colours: revenue violet, spend pink, MER
// indigo, CAC green — each panel is titled, so colour never carries meaning alone.
function Panel({ title, data, dataKey, color, fmt, goal, goalLabel, compareYoY, lowerIsBetter }: { title: string; data: MonthPoint[]; dataKey: 'revenue' | 'adSpend' | 'mer' | 'ncac' | 'flCac'; color: string; fmt: (v: number) => string; goal?: number | null; goalLabel?: string; compareYoY?: boolean; lowerIsBetter?: boolean }) {
  const rows = data.map(d => ({ ...d, v: d[dataKey] == null ? null : Number(d[dataKey]), ly: compareYoY && d.ly && d.ly[dataKey] != null ? Number(d.ly[dataKey]) : null }));
  const hasAny = rows.some(r => r.v != null && r.v > 0);
  const hasLy = compareYoY && rows.some(r => r.ly != null && r.ly > 0);
  const deltas = hasLy ? rows.filter(r => r.v != null && r.ly != null && r.ly > 0).map(r => ({ label: r.label, pct: ((r.v! - r.ly!) / r.ly!) * 100 })) : [];
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{title}{goal != null && goalLabel ? <span className="text-gray-400 font-normal normal-case"> · {goalLabel}</span> : null}</p>
      {!hasAny ? <p className="text-xs text-gray-400 py-6">No data for these months.</p> : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 6, left: 0, bottom: 0 }} barCategoryGap={hasLy ? '22%' : '28%'} barGap={2}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide domain={[0, (m: number) => m * 1.15]} />
              <Tooltip formatter={(v: unknown, name: unknown) => [v == null ? '—' : fmt(Number(v)), String(name)]} labelFormatter={(l: unknown) => String(l)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {hasLy && <Legend verticalAlign="top" height={18} iconSize={8} wrapperStyle={{ fontSize: 10 }} />}
              <Bar dataKey="v" name="This year" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="v" position="top" formatter={(v: unknown) => (v == null ? '' : fmt(Number(v)))} style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }} />
              </Bar>
              {hasLy && (
                <Bar dataKey="ly" name="Last year" fill="#d1d5db" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="ly" position="top" formatter={(v: unknown) => (v == null ? '' : fmt(Number(v)))} style={{ fontSize: 9, fill: '#9ca3af' }} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {deltas.length > 0 && (
        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
          vs last year: {deltas.map((d, i) => {
            const good = lowerIsBetter ? d.pct <= 0 : d.pct >= 0;
            return <span key={d.label}>{i > 0 ? ' · ' : ''}{d.label} <span className={`font-semibold ${good ? 'text-green-600' : 'text-red-500'}`}>{d.pct >= 0 ? '+' : ''}{d.pct.toFixed(0)}%</span></span>;
          })}
        </p>
      )}
    </div>
  );
}

export default function MonthlyHistoryChart({ data, targetMer, targetCac, showFullyLoaded, compareYoY }: { data: MonthPoint[]; targetMer?: number; targetCac?: number; showFullyLoaded?: boolean; compareYoY?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
      <Panel title="Revenue" data={data} dataKey="revenue" color="#8b5cf6" fmt={fmtK} compareYoY={compareYoY} />
      <Panel title="Ad spend" data={data} dataKey="adSpend" color="#f9a8d4" fmt={fmtK} compareYoY={compareYoY} lowerIsBetter />
      <Panel title="MER" data={data} dataKey="mer" color="#818cf8" fmt={v => `${v.toFixed(2)}x`} goal={targetMer} goalLabel={targetMer ? `goal ${targetMer}x` : undefined} compareYoY={compareYoY} />
      <Panel title="New-customer CAC" data={data} dataKey="ncac" color="#86efac" fmt={v => `$${Math.round(v)}`} goal={targetCac} goalLabel={targetCac ? `target $${targetCac}` : undefined} compareYoY={compareYoY} lowerIsBetter />
      {showFullyLoaded && (
        <Panel title="Fully loaded CAC" data={data} dataKey="flCac" color="#fde68a" fmt={v => `$${Math.round(v)}`} goal={1} goalLabel="ad spend + other marketing ÷ new customers" compareYoY={compareYoY} lowerIsBetter />
      )}
    </div>
  );
}
