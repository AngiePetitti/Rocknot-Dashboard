'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';

export interface MonthPoint { month: string; label: string; partial: boolean; revenue: number; adSpend: number; mer: number | null; ncac: number | null; newCustomers: number }

const fmtK = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K` : `$${Math.round(v)}`);

// Four small single-series bar charts (one axis each; value labels on every bar
// so the numbers read on a phone). Colours: revenue violet, spend pink, MER
// indigo, CAC green — each panel is titled, so colour never carries meaning alone.
function Panel({ title, data, dataKey, color, fmt, goal, goalLabel }: { title: string; data: MonthPoint[]; dataKey: keyof MonthPoint; color: string; fmt: (v: number) => string; goal?: number | null; goalLabel?: string }) {
  const rows = data.map(d => ({ ...d, v: d[dataKey] == null ? null : Number(d[dataKey]) }));
  const hasAny = rows.some(r => r.v != null && r.v > 0);
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{title}{goal != null && goalLabel ? <span className="text-gray-400 font-normal normal-case"> · {goalLabel}</span> : null}</p>
      {!hasAny ? <p className="text-xs text-gray-400 py-6">No data for these months.</p> : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 6, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide domain={[0, (m: number) => m * 1.15]} />
              <Tooltip formatter={(v: unknown) => [v == null ? '—' : fmt(Number(v)), title]} labelFormatter={(l: unknown) => String(l)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="v" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="v" position="top" formatter={(v: unknown) => (v == null ? '' : fmt(Number(v)))} style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function MonthlyHistoryChart({ data, targetMer, targetCac }: { data: MonthPoint[]; targetMer?: number; targetCac?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
      <Panel title="Revenue" data={data} dataKey="revenue" color="#8b5cf6" fmt={fmtK} />
      <Panel title="Ad spend" data={data} dataKey="adSpend" color="#f9a8d4" fmt={fmtK} />
      <Panel title="MER" data={data} dataKey="mer" color="#818cf8" fmt={v => `${v.toFixed(2)}x`} goal={targetMer} goalLabel={targetMer ? `goal ${targetMer}x` : undefined} />
      <Panel title="New-customer CAC" data={data} dataKey="ncac" color="#86efac" fmt={v => `$${Math.round(v)}`} goal={targetCac} goalLabel={targetCac ? `target $${targetCac}` : undefined} />
    </div>
  );
}
