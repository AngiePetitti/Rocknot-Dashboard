'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';
import { DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency } from '@/src/lib/utils';

interface RevenueChartProps {
  data: DailyRevenue[];
  /** MER goal drawn as a dashed line on the MER panel. */
  merGoal?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color }} className="font-medium">
            {entry.name}: {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function RevenueChart({ data, merGoal }: RevenueChartProps) {
  const chartData = data.map(d => ({
    date: d.date.slice(5), // MM-DD
    Revenue: d.revenue,
    'Ad Spend': d.adSpend,
  }));

  // MER on its own panel (dollars and a ratio never share an axis). Daily for
  // short ranges; a 7-day rolling MER for anything longer than a month, since
  // single days swing with refund days and weekend spend.
  const rolling = data.length > 31;
  const win = rolling ? 7 : 1;
  const merData = data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - win + 1), i + 1);
    const sales = slice.reduce((s, x) => s + ((x as { netSales?: number }).netSales ?? x.revenue), 0);
    const spend = slice.reduce((s, x) => s + x.adSpend, 0);
    return { date: d.date.slice(5), MER: spend > 0 ? Math.round((sales / spend) * 100) / 100 : null };
  });
  const hasMer = merData.some(m => m.MER != null);

  // Show fewer labels if lots of data
  const tickInterval = Math.max(0, Math.floor(data.length / 6) - 1);

  return (
    <div>
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#c4b5fd" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#c4b5fd" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f9a8d4" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f9a8d4" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          interval={tickInterval}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
          width={42}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="Revenue"
          stroke="#a78bfa"
          strokeWidth={2}
          fill="url(#colorRevenue)"
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="Ad Spend"
          stroke="#f472b6"
          strokeWidth={2}
          fill="url(#colorSpend)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
    {hasMer && (
      <div className="mt-2">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">MER{rolling ? ' · 7-day rolling' : ' · daily'}{merGoal ? <span className="text-gray-400 font-normal normal-case"> · dashed line = goal {merGoal}x</span> : null}</p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={merData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={tickInterval} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v).toFixed(0)}x`} width={42} domain={[0, (m: number) => Math.max(m, merGoal || 0) * 1.1]} />
            <Tooltip formatter={(v: unknown) => [v == null ? '—' : `${Number(v).toFixed(2)}x`, rolling ? 'MER (7-day)' : 'MER']} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
            {merGoal ? <ReferenceLine y={merGoal} stroke="#94a3b8" strokeDasharray="4 4" /> : null}
            <Line type="monotone" dataKey="MER" stroke="#818cf8" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )}
    </div>
  );
}
