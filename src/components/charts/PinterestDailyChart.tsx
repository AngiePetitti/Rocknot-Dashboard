'use client';

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import type { PinterestDayPoint } from '@/src/lib/organic';

export type PinMetric = 'impressions' | 'engagements' | 'pinsCreated';
const LABEL: Record<PinMetric, string> = { impressions: 'Impressions', engagements: 'Engagements', pinsCreated: 'Pins created' };
const fmt = (v: number) => Math.round(v).toLocaleString();
const compact = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

/** One measure per chart (impressions, engagements or pins created), day by day. */
export default function PinterestDailyChart({ days, metric }: { days: PinterestDayPoint[]; metric: PinMetric }) {
  const data = days.map(d => ({ date: d.date, short: d.date.slice(5), value: d[metric], saves: d.saves, pinClicks: d.pinClicks, outboundClicks: d.outboundClicks }));
  const [showTable, setShowTable] = useState(false);
  // Phones have no hover: short ranges get a value on every bar; longer ones a table toggle.
  const labelBars = data.length <= 16;
  const TooltipBox = ({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: (typeof data)[number] }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const r = payload[0].payload;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        <p className="text-gray-700">{LABEL[metric]}: <b>{fmt(r.value)}</b></p>
        {metric === 'engagements' && <p className="text-gray-400">{fmt(r.saves)} saves · {fmt(r.pinClicks)} pin clicks · {fmt(r.outboundClicks)} outbound</p>}
      </div>
    );
  };
  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={v => compact(Number(v))} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="value" name={LABEL[metric]} fill="#e11d48" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {labelBars && <LabelList dataKey="value" position="top" formatter={(v: unknown) => (Number(v) > 0 ? compact(Number(v)) : '')} style={{ fontSize: 9, fill: '#64748b' }} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between mt-1">
        <p className="text-[11px] text-gray-400">{labelBars ? 'Tap a bar for the breakdown.' : 'Tap a bar for its number.'}</p>
        <button type="button" onClick={() => setShowTable(v => !v)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">{showTable ? 'Hide daily numbers' : 'Show daily numbers'}</button>
      </div>
      {showTable && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-100 text-[10px] text-gray-400 uppercase"><th className="text-left pb-1">Day</th><th className="text-right pb-1">Impressions</th><th className="text-right pb-1">Engagements</th><th className="text-right pb-1">Saves</th><th className="text-right pb-1">Pin clicks</th><th className="text-right pb-1">Outbound</th><th className="text-right pb-1">Pins created</th></tr></thead>
            <tbody>{days.map(d => (
              <tr key={d.date} className="border-b border-gray-50"><td className="py-1 text-gray-600">{d.date}</td><td className="py-1 text-right tabular-nums">{fmt(d.impressions)}</td><td className="py-1 text-right tabular-nums">{fmt(d.engagements)}</td><td className="py-1 text-right tabular-nums text-gray-500">{fmt(d.saves)}</td><td className="py-1 text-right tabular-nums text-gray-500">{fmt(d.pinClicks)}</td><td className="py-1 text-right tabular-nums text-gray-500">{fmt(d.outboundClicks)}</td><td className="py-1 text-right tabular-nums text-gray-500">{fmt(d.pinsCreated)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
