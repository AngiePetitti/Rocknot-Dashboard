'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { TIMEFRAMES } from '@/src/lib/utils';

export default function TimeframeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const compareOn = searchParams.get('compare') === 'true';

  const [showCustom, setShowCustom] = useState(current === 'custom');
  const [from, setFrom] = useState(dateFrom || '');
  const [to, setTo] = useState(dateTo || getTodayStr());
  const [compare, setCompare] = useState(compareOn);
  const panelRef = useRef<HTMLDivElement>(null);

  function getTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function handlePreset(value: string) {
    setShowCustom(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tf', value);
    params.delete('date_from');
    params.delete('date_to');
    // keep compare setting
    if (compare) params.set('compare', 'true');
    else params.delete('compare');
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleCustomApply() {
    if (!from || !to) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tf', 'custom');
    params.set('date_from', from);
    params.set('date_to', to);
    if (compare) params.set('compare', 'true');
    else params.delete('compare');
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleCompareToggle(val: boolean) {
    setCompare(val);
    if (current === 'custom' && from && to) return; // apply on submit
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set('compare', 'true');
    else params.delete('compare');
    router.push(`${pathname}?${params.toString()}`);
  }

  // Calculate what the prior period label would be
  function priorPeriodLabel(): string {
    if (current === 'custom' && from && to) {
      const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
      const priorTo = new Date(new Date(from).getTime() - 86400000).toISOString().split('T')[0];
      const priorFrom = new Date(new Date(from).getTime() - days * 86400000).toISOString().split('T')[0];
      return `${priorFrom} → ${priorTo}`;
    }
    const labels: Record<string, string> = {
      today: 'Yesterday',
      yesterday: '2 days ago',
      '7d': 'Prior 7 days',
      '14d': 'Prior 14 days',
      '30d': 'Prior 30 days',
      last_month: 'Month before',
      '6m': 'Prior 6 months',
      ytd: 'Prior year',
    };
    return labels[current] || 'Prior period';
  }

  return (
    <div className="flex flex-col gap-2 items-start w-full">
      <div className="flex flex-wrap gap-1.5 items-center">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => handlePreset(tf.value)}
            className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
              current === tf.value && !showCustom
                ? 'bg-violet-400 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span className="sm:hidden">{tf.shortLabel}</span>
            <span className="hidden sm:inline">{tf.label}</span>
          </button>
        ))}
        <button
          onClick={() => setShowCustom(v => !v)}
          className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
            current === 'custom' || showCustom
              ? 'bg-violet-400 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Custom
        </button>
      </div>

      {/* Compare toggle — always visible */}
      <div className="flex items-center gap-2 pl-0.5">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <div
            onClick={() => handleCompareToggle(!compare)}
            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${compare ? 'bg-violet-400' : 'bg-gray-200'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${compare ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-gray-500 font-medium">
            Compare to {priorPeriodLabel()}
          </span>
        </label>
      </div>

      {/* Custom date range panel */}
      {showCustom && (
        <div ref={panelRef} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 sm:gap-3 bg-white border border-gray-200 rounded-xl p-3 shadow-md w-full sm:w-auto">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">From</label>
            <input
              type="date"
              value={from}
              max={to || getTodayStr()}
              onChange={e => setFrom(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={getTodayStr()}
              onChange={e => setTo(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <button
            onClick={handleCustomApply}
            disabled={!from || !to}
            className="px-4 py-1.5 bg-violet-400 text-white text-xs font-semibold rounded-lg hover:bg-violet-500 disabled:opacity-40 transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
