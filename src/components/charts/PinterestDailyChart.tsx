'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PinterestDayPoint } from '@/src/lib/organic';

export type PinMetric = 'impressions' | 'engagements' | 'pinsCreated';
const LABEL: Record<PinMetric, string> = { impressions: 'Impressions', engagements: 'Engagements', pinsCreated: 'Pins created' };
const fmt = (v: number) => Math.round(v).toLocaleString();

/** One measure per chart (impressions, engagements or pins created), day by day. */
export default function PinterestDailyChart({ days, metric }: { days: PinterestDayPoint[]; metric: PinMetric }) {
  const data = days.map(d => ({ date: d.date, short: d.date.slice(5), value: d[metric], saves: d.saves, pinClicks: d.pinClicks, outboundClicks: d.outboundClicks }));
  const tickInterval = Math.max(0, Math.floor(data.length / 8) - 1);
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
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={tickInterval} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} allowDecimals={false} tickFormatter={v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v))} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="value" name={LABEL[metric]} fill="#e11d48" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
