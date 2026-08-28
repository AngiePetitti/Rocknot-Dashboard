import React from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  accentColor: string;
  trend?: { value: string; positive: boolean };
  comparison?: { current: number; prior: number; label?: string };
  large?: boolean;
  valueColor?: string;
}

function calcDelta(current: number, prior: number): { pct: number; positive: boolean } | null {
  if (!prior || prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 1000) / 10;
  return { pct, positive: pct >= 0 };
}

export default function MetricCard({
  title,
  value,
  subtitle,
  accentColor,
  trend,
  comparison,
  large = false,
  valueColor,
}: MetricCardProps) {
  const delta = comparison ? calcDelta(comparison.current, comparison.prior) : null;

  return (
    <div
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-1"
      style={{ borderTopColor: accentColor, borderTopWidth: 3 }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      <p
        className={`font-bold leading-none ${large ? 'text-4xl' : 'text-2xl'}`}
        style={valueColor ? { color: valueColor } : { color: '#1e293b' }}
      >
        {value}
      </p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}

      {/* Comparison delta — shown when compare mode is on */}
      {delta !== null && (
        <span className={`text-xs font-semibold mt-1 ${delta.positive ? 'text-green-500' : 'text-red-500'}`}>
          {delta.positive ? '▲' : '▼'} {Math.abs(delta.pct)}% {comparison?.label || 'vs prior period'}
        </span>
      )}

      {/* Static trend — shown when comparison is off */}
      {!delta && trend && (
        <span className={`text-xs font-semibold mt-1 ${trend.positive ? 'text-green-500' : 'text-red-500'}`}>
          {trend.positive ? '▲' : '▼'} {trend.value}
        </span>
      )}
    </div>
  );
}
