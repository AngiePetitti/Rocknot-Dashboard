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
} from 'recharts';
import { DailyRevenue } from '@/src/lib/mockData';
import { formatCurrency } from '@/src/lib/utils';

interface RevenueChartProps {
  data: DailyRevenue[];
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

export default function RevenueChart({ data }: RevenueChartProps) {
  const chartData = data.map(d => ({
    date: d.date.slice(5), // MM-DD
    Revenue: d.revenue,
    'Ad Spend': d.adSpend,
  }));

  // Show fewer labels if lots of data
  const tickInterval = Math.max(0, Math.floor(data.length / 6) - 1);

  return (
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
  );
}
