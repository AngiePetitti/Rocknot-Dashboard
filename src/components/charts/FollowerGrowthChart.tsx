'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { AudiencePoint } from '@/src/lib/organic';

const fmt = (v: number) => Math.round(v).toLocaleString();
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

export interface GrowthSeries { label: string; color: string; series: AudiencePoint[] }

/**
 * Net new followers per day for every platform on one axis. Totals differ by
 * tens of thousands between platforms, so the shared measure is the daily
 * change; each platform's running total sits in the header above the chart.
 */
export default function FollowerGrowthChart({ platforms }: { platforms: GrowthSeries[] }) {
  const data = useMemo(() => {
    const dates = Array.from(new Set(platforms.flatMap(p => p.series.map(pt => pt.date)))).sort();
    return dates.map(date => {
      const row: Record<string, string | number | null> = { date, short: date.slice(5) };
      for (const p of platforms) {
        const pt = p.series.find(x => x.date === date);
        row[p.label] = pt?.newFollowers ?? null;
        row[`${p.label}_total`] = pt?.followers ?? null;
      }
      return row;
    });
  }, [platforms]);
  if (!data.length) return <p className="text-xs text-gray-400">No dated follower rows in this window.</p>;
  const tickInterval = Math.max(0, Math.floor(data.length / 8) - 1);

  const TooltipBox = ({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Record<string, string | number | null> }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        {platforms.map(p => {
          const v = row[p.label]; const t = row[`${p.label}_total`];
          if (v == null && t == null) return null;
          return (
            <p key={p.label} className="text-gray-700">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: p.color }} />
              {p.label}: {v != null ? <span className={Number(v) >= 0 ? 'text-green-600' : 'text-red-500'}>{signed(Number(v))}</span> : '—'}{t != null ? <span className="text-gray-400"> · {fmt(Number(t))} total</span> : ''}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={tickInterval} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46} allowDecimals={false} tickFormatter={v => signed(v)} />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
        {platforms.map(p => (
          <Line key={p.label} type="monotone" dataKey={p.label} name={`${p.label} net new / day`} stroke={p.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
