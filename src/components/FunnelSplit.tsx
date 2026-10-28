'use client';

import { useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';
import { formatCurrency } from '@/src/lib/utils';
import type { FunnelData, Stage } from '@/src/lib/funnel';

// Stage colours: violet → indigo → pink read as one sequence top-to-bottom;
// unclassified is neutral grey. Each is paired with a label everywhere.
const STAGES: Array<{ key: Stage; label: string; short: string; color: string }> = [
  { key: 'tof', label: 'Top of funnel', short: 'Top', color: '#8b5cf6' },
  { key: 'mof', label: 'Middle of funnel', short: 'Middle', color: '#818cf8' },
  { key: 'bof', label: 'Bottom of funnel', short: 'Bottom', color: '#f9a8d4' },
  { key: 'other', label: 'Unclassified', short: 'Unclassified', color: '#d1d5db' },
];

/** Budget by funnel stage per platform (Ad Performance tab). */
export default function FunnelSplit({ tf, dateFrom, dateTo }: { tf: string; dateFrom?: string; dateTo?: string }) {
  const [data, setData] = useState<FunnelData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setFailed(null);
    const p = new URLSearchParams({ tf });
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    fetch(`/api/windsor/funnel?${p}`, { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.error) setFailed(String(d.error)); else setData(d); }).catch(e => setFailed(String(e)));
  }, [tf, dateFrom, dateTo]);

  if (failed) return <Card className="mb-6"><p className="text-xs text-gray-400">Budget by funnel stage unavailable: {failed}</p></Card>;
  if (!data) return <Card className="mb-6"><p className="text-xs text-gray-400">Loading budget by funnel stage…</p></Card>;
  const rows = data.platforms.filter(p => p.spend > 0);
  if (!rows.length) return null;
  const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);
  const unclassified = rows.reduce((s, p) => s + p.campaigns.filter(c => c.stage === 'other').length, 0);

  const Bar = ({ stages, total }: { stages: Record<Stage, number>; total: number }) => (
    <div className="flex h-5 w-full rounded-md overflow-hidden bg-gray-100 gap-[2px]">
      {STAGES.map(s => {
        const w = pct(stages[s.key], total);
        if (w <= 0) return null;
        return (
          <div key={s.key} title={`${s.label}: ${formatCurrency(stages[s.key])} (${w.toFixed(0)}%)`} style={{ width: `${w}%`, backgroundColor: s.color }} className="flex items-center justify-center min-w-0">
            {w >= 12 && <span className="text-[10px] font-bold text-gray-800/80 truncate px-1">{w.toFixed(0)}%</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-gray-700">Budget by funnel stage</h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
          {STAGES.filter(s => s.key !== 'other' || data.totals.stages.other > 0).map(s => (
            <span key={s.key} className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>
          ))}
        </div>
      </div>

      {/* All platforms */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between text-xs mb-1">
          <span className="font-semibold text-gray-700">All platforms</span>
          <span className="text-gray-500 tabular-nums">{formatCurrency(data.totals.spend)}</span>
        </div>
        <Bar stages={data.totals.stages} total={data.totals.spend} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {STAGES.filter(s => s.key !== 'other').map(s => (
            <div key={s.key} className="min-w-0">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{s.short}</p>
              <p className="text-base font-bold tabular-nums" style={{ color: '#1e293b' }}>{formatCurrency(data.totals.stages[s.key])} <span className="text-xs text-gray-400 font-semibold">{pct(data.totals.stages[s.key], data.totals.spend).toFixed(0)}%</span></p>
            </div>
          ))}
        </div>
      </div>

      {/* Per platform */}
      <div className="divide-y divide-gray-100">
        {rows.map(p => (
          <div key={p.key} className="py-3">
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="font-semibold text-gray-700">{p.platform}</span>
              <span className="text-gray-500 tabular-nums">{formatCurrency(p.spend)}</span>
            </div>
            <Bar stages={p.stages} total={p.spend} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-gray-500 tabular-nums">
              {STAGES.filter(s => p.stages[s.key] > 0).map(s => (
                <span key={s.key}><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ backgroundColor: s.color }} />{s.short} {formatCurrency(p.stages[s.key])} ({pct(p.stages[s.key], p.spend).toFixed(0)}%)</span>
              ))}
              <button type="button" onClick={() => setOpen(open === p.key ? null : p.key)} className="text-violet-600 font-semibold ml-auto">{open === p.key ? 'Hide campaigns' : `${p.campaigns.length} campaigns ▸`}</button>
            </div>
            {open === p.key && (
              <table className="w-full text-xs mt-2">
                <thead><tr className="text-[10px] text-gray-400 uppercase tracking-wider"><th className="text-left font-semibold py-1">Campaign</th><th className="text-left font-semibold py-1">Stage</th><th className="text-right font-semibold py-1">Spend</th></tr></thead>
                <tbody>
                  {p.campaigns.map(c => {
                    const s = STAGES.find(x => x.key === c.stage)!;
                    return (
                      <tr key={c.name} className="border-t border-gray-50">
                        <td className="py-1 pr-2 text-gray-700 break-words">{c.name}</td>
                        <td className="py-1 pr-2 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ backgroundColor: s.color }} />{s.short}<span className="text-gray-400"> · {c.reason}</span></td>
                        <td className="py-1 text-right tabular-nums text-gray-700">{formatCurrency(c.spend)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {p.error && <p className="text-[11px] text-amber-600 mt-1">Campaign data for {p.platform} could not be loaded: {p.error}</p>}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">
        Stage is read from campaign and ad-set names: retargeting, brand, shopping and catalog words count as bottom of funnel; consideration, engagement and traffic as middle; prospecting, cold, broad, lookalike and awareness as top. Google also uses the campaign type.
        {unclassified > 0 && <> <span className="text-gray-500 font-semibold">{unclassified} campaign{unclassified === 1 ? '' : 's'} had no funnel word</span> and sit in Unclassified — open the platform to see them.</>}
      </p>
    </Card>
  );
}
