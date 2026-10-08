'use client';

import { useMemo } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { AudiencePoint } from '@/src/lib/organic';

const fmt = (v: number) => Math.round(v).toLocaleString();
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

/**
 * One platform's follower trend over the range — a single measure per chart
 * (the running total when the feed reports one, else daily net new
 * followers as bars), so each platform reads on its own axis.
 */
export default function FollowerGrowthChart({ label, color, series }: { label: string; color: string; series: AudiencePoint[] }) {
  const hasTotal = series.some(p => p.followers != null);
  const hasDaily = series.some(p => p.newFollowers != null);
  const data = useMemo(() => series.map(p => ({
    date: p.date, short: p.date.slice(5),
    Followers: p.followers, 'Net new': p.newFollowers,
  })), [series]);
  const tickInterval = Math.max(0, Math.floor(data.length / 6) - 1);
  const totals = data.map(d => d.Followers).filter((v): v is number => v != null);
  // Follower totals move by a handful a day; a zero-based axis flattens the
  // line, so the total chart floats its axis around the observed band.
  const domain: [number | string, number | string] = totals.length
    ? [Math.max(0, Math.floor(Math.min(...totals) - (Math.max(...totals) - Math.min(...totals)) * 0.25 - 1)), Math.ceil(Math.max(...totals) + (Math.max(...totals) - Math.min(...totals)) * 0.25 + 1)]
    : ['auto', 'auto'];

  if (!hasTotal && !hasDaily) return <p className="text-xs text-gray-400">No dated follower rows from {label} in this period.</p>;

  const TooltipBox = ({ active, payload, label: l }: { active?: boolean; payload?: Array<{ dataKey: string; value: number | null; payload: { Followers: number | null; 'Net new': number | null } }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{l}</p>
        {row.Followers != null && <p className="text-gray-700"><span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: color }} />{fmt(row.Followers)} followers</p>}
        {row['Net new'] != null && <p className={row['Net new'] >= 0 ? 'text-green-600' : 'text-red-500'}>{signed(row['Net new'])} that day</p>}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={tickInterval} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46}
          domain={hasTotal ? domain : ['auto', 'auto']} allowDecimals={false}
          tickFormatter={v => (hasTotal ? fmt(v) : signed(v))} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
        {hasTotal ? (
          <Line type="monotone" dataKey="Followers" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
        ) : (
          <>
            <ReferenceLine y={0} stroke="#cbd5e1" />
            <Bar dataKey="Net new" fill={color} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
