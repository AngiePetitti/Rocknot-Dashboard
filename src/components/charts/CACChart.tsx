'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency } from '@/src/lib/utils';

interface CACChartProps {
  data: DailyRevenue[];
  target?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color }} className="font-medium">
            {entry.name}: {entry.value === null ? '—' : formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Per-day CAC: New CAC = ad spend / new customers, Blended CAC = ad spend / all
// buyers. Days with no acquired/served customers show a gap (null) rather than a
// misleading spike or zero.
export default function CACChart({ data, target }: CACChartProps) {
  const chartData = data.map(d => {
    const newCust = d.newCustomers ?? 0;
    const totalCust = d.totalCustomers ?? 0;
    return {
      date: d.date.slice(5), // MM-DD
      'New CAC': newCust > 0 ? Math.round((d.adSpend / newCust) * 100) / 100 : null,
      'Blended CAC': totalCust > 0 ? Math.round((d.adSpend / totalCust) * 100) / 100 : null,
    };
  });

  const tickInterval = Math.max(0, Math.floor(data.length / 6) - 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
          tickFormatter={(v) => '$' + v}
          width={42}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {target && target > 0 && (
          <ReferenceLine
            y={target}
            stroke="#ef4444"
            strokeDasharray="5 4"
            label={{ value: `Target $${target}`, position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }}
          />
        )}
        <Line
          type="monotone"
          dataKey="New CAC"
          stroke="#6366f1"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="Blended CAC"
          stroke="#34d399"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
