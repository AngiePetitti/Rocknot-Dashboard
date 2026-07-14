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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// New CAC = ad spend / new customers, Blended CAC = ad spend / all buyers.
// Long ranges (YTD, 6 months) aggregate to MONTHLY CAC — spend and customers
// summed per calendar month — so month-over-month movement is readable instead
// of a noisy daily line. Short ranges stay daily. Empty buckets show a gap
// (null) rather than a misleading spike or zero.
export default function CACChart({ data, target }: CACChartProps) {
  const monthly = data.length > 45;

  let chartData: Array<{ date: string; 'New CAC': number | null; 'Blended CAC': number | null }>;
  if (monthly) {
    const byMonth = new Map<string, { spend: number; newCust: number; totalCust: number }>();
    for (const d of data) {
      const key = d.date.slice(0, 7); // YYYY-MM
      const b = byMonth.get(key) || { spend: 0, newCust: 0, totalCust: 0 };
      b.spend += d.adSpend;
      b.newCust += d.newCustomers ?? 0;
      b.totalCust += d.totalCustomers ?? 0;
      byMonth.set(key, b);
    }
    chartData = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => ({
        date: MONTH_LABELS[parseInt(key.slice(5)) - 1],
        'New CAC': b.newCust > 0 ? Math.round((b.spend / b.newCust) * 100) / 100 : null,
        'Blended CAC': b.totalCust > 0 ? Math.round((b.spend / b.totalCust) * 100) / 100 : null,
      }));
  } else {
    chartData = data.map(d => {
      const newCust = d.newCustomers ?? 0;
      const totalCust = d.totalCustomers ?? 0;
      return {
        date: d.date.slice(5), // MM-DD
        'New CAC': newCust > 0 ? Math.round((d.adSpend / newCust) * 100) / 100 : null,
        'Blended CAC': totalCust > 0 ? Math.round((d.adSpend / totalCust) * 100) / 100 : null,
      };
    });
  }

  const tickInterval = monthly ? 0 : Math.max(0, Math.floor(data.length / 6) - 1);

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
          dot={monthly ? { r: 3 } : false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="Blended CAC"
          stroke="#34d399"
          strokeWidth={2}
          dot={monthly ? { r: 3 } : false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
