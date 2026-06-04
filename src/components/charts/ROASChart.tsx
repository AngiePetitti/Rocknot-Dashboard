'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { PlatformSpend } from '@/src/lib/mockData';

interface ROASChartProps {
  data: PlatformSpend[];
  goalLine?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const roas = payload[0].value;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        <p className="font-bold" style={{ color: roas >= 3.5 ? '#22c55e' : '#ef4444' }}>
          ROAS: {roas.toFixed(2)}x
        </p>
      </div>
    );
  }
  return null;
};

export default function ROASChart({ data, goalLine = 3.5 }: ROASChartProps) {
  const chartData = data.map(d => ({
    platform: d.platform,
    roas: d.roas,
    color: d.color,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barSize={48}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="platform"
          tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => v.toFixed(1) + 'x'}
          domain={[0, 6]}
          width={38}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
        <ReferenceLine
          y={goalLine}
          stroke="#ef4444"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          label={{ value: 'Goal 3.5x', fill: '#ef4444', fontSize: 10, position: 'right' }}
        />
        <Bar dataKey="roas" radius={[6, 6, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.roas >= goalLine ? entry.color : '#fca5a5'}
              opacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
