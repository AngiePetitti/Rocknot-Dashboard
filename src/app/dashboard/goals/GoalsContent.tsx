'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { cachedJson } from '@/src/lib/clientCache';
import { formatCurrency } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';

interface MonthGoal { month: string; revenueGoal: number; adBudget: number; pinned?: boolean }
interface MonthActual { revenue: number; adSpend: number }

const TARGET_MER = 3.5; // net-sales MER target; ad budgets are derived from this when auto-planning

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pstToday(): { y: number; m: number; d: number } {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).split('-').map(Number);
  return { y, m, d };
}

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Aggregate a daily revenueData series into per-month totals. Excludes
// today's PARTIAL day so the current month holds complete days only —
// otherwise the month-end pace projection counts today's revenue without
// counting today as an elapsed day and lands way above the Overview's
// forecast for the same month.
function byMonth(daily: { date: string; revenue: number; adSpend: number }[]): Record<string, MonthActual> {
  const t = pstToday();
  const todayStr = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const out: Record<string, MonthActual> = {};
  for (const r of daily) {
    const k = (r.date || '').slice(0, 7);
    if (!k || r.date >= todayStr) continue;
    if (!out[k]) out[k] = { revenue: 0, adSpend: 0 };
    out[k].revenue += r.revenue || 0;
    out[k].adSpend += r.adSpend || 0;
  }
  return out;
}

export default function GoalsContent() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { y: year, m: curMonth, d: today } = pstToday();

  const [goals, setGoals] = useState<Record<string, MonthGoal>>({});
  const [target, setTarget] = useState<number>(4_000_000);
  const [targetTouched, setTargetTouched] = useState(false);
  const [actuals, setActuals] = useState<Record<string, MonthActual>>({});
  const [lastYear, setLastYear] = useState<Record<string, MonthActual>>({});
  const [aov, setAov] = useState<number>(0);
  const [stockRetail, setStockRetail] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [monthNotes, setMonthNotes] = useState<Record<string, { text: string; updatedAt: string; author?: string }>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // ── Load everything (session-cached like the other tabs) ──
  useEffect(() => {
    fetch('/api/goals', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.goals)) {
          const map: Record<string, MonthGoal> = {};
          for (const g of d.goals) map[g.month] = g;
          setGoals(map);
          // The explicitly saved annual target wins; fall back to the sum of
          // the saved monthly plan.
          if (typeof d.target === 'number' && d.target > 0) {
            setTarget(d.target); setTargetTouched(true);
          } else {
            const yearTotal = d.goals
              .filter((g: MonthGoal) => g.month.startsWith(String(year)))
              .reduce((s: number, g: MonthGoal) => s + g.revenueGoal, 0);
            if (yearTotal > 0) { setTarget(yearTotal); setTargetTouched(true); }
          }
        }
      })
      .catch(() => {});

    cachedJson<{ source?: string; metrics?: { aov?: number }; revenueData?: { date: string; revenue: number; adSpend: number }[] }>(
      `/api/windsor?tf=ytd`,
      d => {
        if (d.source === 'windsor_live' || d.source === 'bigquery_live') {
          setActuals(byMonth(d.revenueData || []));
          if (d.metrics?.aov) setAov(d.metrics.aov);
        }
      }
    );
    cachedJson<{ source?: string; revenueData?: { date: string; revenue: number; adSpend: number }[] }>(
      `/api/windsor?tf=custom&date_from=${year - 1}-01-01&date_to=${year - 1}-12-31`,
      d => {
        if (d.source === 'windsor_live' || d.source === 'bigquery_live') setLastYear(byMonth(d.revenueData || []));
      }
    );
    fetch('/api/notes/months', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d?.notes) setMonthNotes(d.notes); })
      .catch(() => {});
    cachedJson<{ source?: string; finance?: { totalRetailValue?: number } }>(
      '/api/windsor/inventory',
      d => { if (d.source === 'shopify_live') setStockRetail(d.finance?.totalRetailValue ?? null); }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1)), [year]);

  // Month-end forecast for the current month at MTD pace.
  const currentForecast = useMemo(() => {
    const k = monthKey(year, curMonth);
    const mtd = actuals[k];
    const daysElapsed = today - 1;
    if (!mtd || daysElapsed < 3) return null;
    const daysInMonth = new Date(year, curMonth, 0).getDate();
    return {
      revenue: (mtd.revenue / daysElapsed) * daysInMonth,
      adSpend: (mtd.adSpend / daysElapsed) * daysInMonth,
    };
  }, [actuals, year, curMonth, today]);

  // ── Auto-plan: distribute what's left of the annual target across the
  //    remaining months, weighted by last year's seasonality ──
  function autoPlan() {
    const completed = months.filter((_, i) => i + 1 < curMonth);
    const done = completed.reduce((s, k) => s + (actuals[k]?.revenue || 0), 0);
    const remainingMonths = months.filter((_, i) => i + 1 >= curMonth);

    // Months you edited by hand are pinned — auto-plan works AROUND them:
    // their goals are subtracted from the target and only the unpinned
    // months get redistributed.
    const pinnedMonths = remainingMonths.filter(k => goals[k]?.pinned);
    const openMonths = remainingMonths.filter(k => !goals[k]?.pinned);
    const pinnedSum = pinnedMonths.reduce((s, k) => s + (goals[k]?.revenueGoal || 0), 0);
    const remaining = Math.max(0, target - done - pinnedSum);

    // Seasonality weights from last year's same months (fallback: even split).
    const weights = openMonths.map(k => {
      const lyKey = `${year - 1}${k.slice(4)}`;
      return lastYear[lyKey]?.revenue || 0;
    });
    const weightSum = weights.reduce((s, w) => s + w, 0);

    const next = { ...goals };
    openMonths.forEach((k, i) => {
      const share = weightSum > 0 ? weights[i] / weightSum : 1 / (openMonths.length || 1);
      const goal = Math.round((remaining * share) / 1000) * 1000;
      next[k] = { month: k, revenueGoal: goal, adBudget: Math.round(goal / TARGET_MER / 100) * 100, pinned: false };
    });
    setGoals(next);
    setDirty(true);
  }

  function togglePin(k: string) {
    setGoals(prev => {
      const base = prev[k] ?? { month: k, revenueGoal: 0, adBudget: 0 };
      return { ...prev, [k]: { ...base, pinned: !base.pinned } };
    });
    setDirty(true);
  }

  function updateGoal(k: string, field: 'revenueGoal' | 'adBudget', value: number) {
    setGoals(prev => {
      const base = prev[k] ?? { month: k, revenueGoal: 0, adBudget: 0 };
      // Hand-edited months pin themselves so auto-plan won't overwrite them.
      return { ...prev, [k]: { ...base, [field]: value, pinned: true } };
    });
    setDirty(true);
    // Editing a month's revenue goal re-balances the other (unpinned) months
    // automatically once typing settles — no need to tap Auto-plan.
    if (field === 'revenueGoal') setRebalancePending(p => p + 1);
  }

  const [rebalancePending, setRebalancePending] = useState(0);
  useEffect(() => {
    if (!rebalancePending) return;
    const t = setTimeout(() => {
      setRebalancePending(0);
      autoPlan();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebalancePending, goals, target]);

  // Auto-save: any edit (target, month values, pins, auto-plan) persists on
  // its own ~1.5s after the last change — the Save button stays as an
  // immediate manual trigger but is never required.
  useEffect(() => {
    if (!dirty || saving) return;
    const t = setTimeout(() => { save(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, goals, target, saving]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: Object.values(goals), target }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Save failed');
      setSavedAt(new Date());
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveMonthNote(k: string) {
    const text = (noteDrafts[k] ?? monthNotes[k]?.text ?? '').trim();
    setNoteSaving(k);
    try {
      const res = await fetch('/api/notes/months', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: k, text }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Save failed');
      setMonthNotes(d.notes || {});
      setNoteDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Note save failed');
    } finally {
      setNoteSaving(null);
    }
  }

  // ── Rollups ──
  const ytdActual = months.filter((_, i) => i + 1 < curMonth).reduce((s, k) => s + (actuals[k]?.revenue || 0), 0)
    + (actuals[monthKey(year, curMonth)]?.revenue || 0);

  // Trend estimate for future months with no goal yet: last year's same month,
  // scaled by this year's YoY growth over the completed months.
  const yoyRatio = useMemo(() => {
    let thisY = 0, lastY = 0;
    for (let n = 1; n < curMonth; n++) {
      thisY += actuals[monthKey(year, n)]?.revenue || 0;
      lastY += lastYear[monthKey(year - 1, n)]?.revenue || 0;
    }
    return lastY > 0 ? thisY / lastY : 1;
  }, [actuals, lastYear, year, curMonth]);

  const avgMonthActual = (() => {
    const done = months.filter((_, i) => i + 1 < curMonth).map(k => actuals[k]?.revenue || 0).filter(v => v > 0);
    return done.length ? done.reduce((s, v) => s + v, 0) / done.length : 0;
  })();

  function trendEstimate(k: string): number {
    const ly = lastYear[`${year - 1}${k.slice(4)}`]?.revenue || 0;
    return ly > 0 ? ly * yoyRatio : avgMonthActual;
  }

  // Two distinct year-end numbers:
  // ON-TREND — what actually happens if the current trajectory holds
  // (actuals + this month's pace + YoY-scaled seasonality; goals ignored).
  const trendTotal = months.reduce((s, k, i) => {
    const n = i + 1;
    if (n < curMonth) return s + (actuals[k]?.revenue || 0);
    if (n === curMonth) return s + Math.max(currentForecast?.revenue || 0, 0);
    return s + trendEstimate(k);
  }, 0);
  // THE PLAN — where the year lands if every remaining goal is hit
  // (months without a goal fall back to trend).
  const plannedTotal = months.reduce((s, k, i) => {
    const n = i + 1;
    if (n < curMonth) return s + (actuals[k]?.revenue || 0);
    if (n === curMonth) return s + Math.max(currentForecast?.revenue || 0, 0);
    return s + (goals[k]?.revenueGoal || trendEstimate(k));
  }, 0);
  const goalTotal = months.reduce((s, k) => s + (goals[k]?.revenueGoal || 0), 0);
  const budgetTotal = months.reduce((s, k) => s + (goals[k]?.adBudget || 0), 0);

  // Inventory needs: next 60 days of goals vs stock on hand (at retail).
  const next60Goal = (() => {
    const cur = goals[monthKey(year, curMonth)]?.revenueGoal || 0;
    const curDone = actuals[monthKey(year, curMonth)]?.revenue || 0;
    const nextK = curMonth < 12 ? monthKey(year, curMonth + 1) : monthKey(year + 1, 1);
    return Math.max(0, cur - curDone) + (goals[nextK]?.revenueGoal || 0);
  })();
  const coverage = stockRetail !== null && next60Goal > 0 ? (stockRetail / next60Goal) * 100 : null;

  return (
    <div>
      <Header title="Goals" subtitle={`${year} revenue plan · ad budgets · inventory needs`}>
        {isAdmin && (
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? 'Saving…' : dirty ? 'Save plan' : savedAt ? '✓ Saved' : 'Save plan'}
          </button>
        )}
      </Header>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      {/* ── Annual target + auto-plan ── */}
      <Card accentColor="#c4b5fd" className="mb-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Annual revenue target</p>
            {isAdmin ? (
              <div className="flex items-center gap-1">
                <span className="text-2xl font-bold text-gray-400">$</span>
                <input
                  type="number"
                  value={target || ''}
                  onChange={e => { setTarget(Number(e.target.value) || 0); setTargetTouched(true); }}
                  className="text-2xl font-bold text-gray-800 w-40 border-b-2 border-violet-200 focus:border-violet-500 focus:outline-none bg-transparent"
                />
              </div>
            ) : (
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(target)}</p>
            )}
            {!targetTouched && <p className="text-[11px] text-gray-400 mt-1">Default — set your real target and auto-plan.</p>}
          </div>
          {isAdmin && (
            <button
              onClick={autoPlan}
              className="px-4 py-2.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 text-sm font-semibold rounded-xl transition-colors"
            >
              ✨ Auto-plan remaining months
            </button>
          )}
          <p className="text-[11px] text-gray-400 sm:ml-auto sm:max-w-[260px]">
            Splits what&apos;s left of the target across {MONTH_NAMES[curMonth - 1]}–December, weighted by last year&apos;s
            seasonality. Months you edit by hand get 📌 pinned — run auto-plan again and the other months
            re-balance around them so the total still hits the target. Ad budgets assume {TARGET_MER}x MER.
          </p>
        </div>
      </Card>

      {/* ── Rollup cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">YTD Actual</p>
          <p className="text-xl font-bold text-gray-800 mt-0.5">{formatCurrency(ytdActual, true)}</p>
          <p className="text-xs text-gray-400">{target > 0 ? `${((ytdActual / target) * 100).toFixed(0)}% of target` : ''}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">On-Trend Year-End</p>
          <p className="text-xl font-bold mt-0.5" style={{ color: trendTotal >= target ? '#16a34a' : '#dc2626' }}>{formatCurrency(trendTotal, true)}</p>
          <p className="text-xs text-gray-400">if this year&apos;s trajectory just continues</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Stretch to Goal</p>
          <p className="text-xl font-bold mt-0.5" style={{ color: plannedTotal - trendTotal > 0 ? '#d97706' : '#16a34a' }}>
            {plannedTotal - trendTotal > 0 ? `+${formatCurrency(plannedTotal - trendTotal, true)}` : '—'}
          </p>
          <p className="text-xs text-gray-400">
            {plannedTotal - trendTotal > 0 ? 'extra revenue the plan needs beyond trend' : 'plan is at or below trend'}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Planned Ad Budget</p>
          <p className="text-xl font-bold text-gray-800 mt-0.5">{formatCurrency(budgetTotal, true)}</p>
          <p className="text-xs text-gray-400">{goalTotal > 0 && budgetTotal > 0 ? `implies ${(goalTotal / budgetTotal).toFixed(1)}x MER` : ''}</p>
        </div>
      </div>

      {/* ── Inventory needs ── */}
      {coverage !== null && (
        <Card accentColor={coverage >= 100 ? '#86efac' : '#fca5a5'} className="mb-5">
          <div className="flex items-start gap-3">
            <span className="text-xl">📦</span>
            <div>
              <h2 className="text-sm font-bold text-gray-700 mb-0.5">Inventory vs the next 60 days of goals</h2>
              <p className="text-sm text-gray-600">
                Stock on hand is worth <strong>{formatCurrency(stockRetail!)}</strong> at retail — that covers{' '}
                <strong style={{ color: coverage >= 100 ? '#16a34a' : '#dc2626' }}>{coverage.toFixed(0)}%</strong> of the{' '}
                <strong>{formatCurrency(next60Goal)}</strong> you&apos;re targeting through the end of next month
                {aov > 0 && <> (≈ <strong>{Math.ceil(next60Goal / aov).toLocaleString()}</strong> orders at your {formatCurrency(aov)} AOV)</>}.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {coverage >= 100
                  ? 'Enough stock to hit the goal if it all sells — check the Inventory tab for which fast sellers are out anyway.'
                  : 'Not enough stock on the shelf to hit these goals even if everything sells — reorder now. The Inventory tab shows what to restock first.'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Monthly plan table ── */}
      <Card accentColor="#93c5fd">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Month-by-month plan</h2>
        <p className="text-xs text-gray-400 mb-4">
          Past months show actuals. {MONTH_NAMES[curMonth - 1]} compares its month-end forecast to goal. Future months are the plan{isAdmin ? ' — tap a number to edit, then Save' : ''}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100">
                {['Month', 'Actual / Forecast', 'Revenue Goal', 'vs Goal', 'Ad Budget', 'Actual Spend', 'Units Needed'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((k, i) => {
                const n = i + 1;
                const isPast = n < curMonth;
                const isCurrent = n === curMonth;
                const a = actuals[k];
                const g = goals[k];
                const shown = isPast ? a?.revenue : isCurrent ? currentForecast?.revenue : undefined;
                const pct = g?.revenueGoal && shown !== undefined ? (shown / g.revenueGoal) * 100 : null;
                const units = g?.revenueGoal && aov > 0 ? Math.ceil(g.revenueGoal / aov) : null;
                return (
                  <tr key={k} className={`border-b border-gray-50 ${isCurrent ? 'bg-blue-50/40' : ''}`}>
                    <td className="py-2.5 pr-4 font-semibold text-gray-800 whitespace-nowrap">
                      {MONTH_NAMES[i].slice(0, 3)}
                      {isCurrent && <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold">now</span>}
                      {monthNotes[k]?.text && (
                        <button
                          onClick={() => setNoteOpen(prev => ({ ...prev, [k]: true }))}
                          title={monthNotes[k].text}
                          className="ml-1.5 text-xs opacity-70 hover:opacity-100"
                        >
                          📝
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">
                      {shown !== undefined ? (
                        <>{formatCurrency(shown)}{isCurrent && <span className="text-[10px] text-gray-400 ml-1">proj.</span>}</>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {isAdmin && !isPast ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            value={g?.revenueGoal || ''}
                            placeholder="0"
                            onChange={e => updateGoal(k, 'revenueGoal', Number(e.target.value) || 0)}
                            className={`w-28 px-2 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 ${g?.pinned ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200'}`}
                          />
                          <button
                            onClick={() => togglePin(k)}
                            title={g?.pinned ? 'Pinned — auto-plan keeps this number. Tap to unpin.' : 'Not pinned — auto-plan may change this. Tap to pin.'}
                            className={`text-sm ${g?.pinned ? '' : 'opacity-25'}`}
                          >
                            📌
                          </button>
                        </span>
                      ) : (
                        g?.revenueGoal ? formatCurrency(g.revenueGoal) : <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {pct !== null ? (
                        <span className="text-xs font-bold" style={{ color: pct >= 100 ? '#16a34a' : pct >= 85 ? '#d97706' : '#dc2626' }}>
                          {pct.toFixed(0)}%
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {isAdmin && !isPast ? (
                        <input
                          type="number"
                          value={g?.adBudget || ''}
                          placeholder="0"
                          onChange={e => updateGoal(k, 'adBudget', Number(e.target.value) || 0)}
                          className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                        />
                      ) : (
                        g?.adBudget ? formatCurrency(g.adBudget) : <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">
                      {a?.adSpend ? formatCurrency(isCurrent && currentForecast ? currentForecast.adSpend : a.adSpend) : <span className="text-gray-300">—</span>}
                      {isCurrent && a?.adSpend ? <span className="text-[10px] text-gray-400 ml-1">proj.</span> : null}
                    </td>
                    <td className="py-2.5 text-gray-500 whitespace-nowrap">
                      {units ? `~${units.toLocaleString()}` : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Units Needed ≈ revenue goal ÷ current AOV ({aov > 0 ? formatCurrency(aov) : '—'}). Goals are shared — everyone sees them; admins edit.
        </p>
      </Card>

      {/* ── Monthly performance log ── */}
      <Card accentColor="#fcd34d" className="mt-5">
        <h2 className="text-sm font-bold text-gray-700 mb-1">📝 Monthly performance log</h2>
        <p className="text-xs text-gray-400 mb-4">
          Record what happened each month — launches, stockouts, promos, ad account issues, PR moments — so when
          revenue moves up or down you always know why. Notes are shared with the whole team and Cleo reads them
          when explaining performance.
        </p>
        <div className="space-y-2">
          {Array.from({ length: 14 }, (_, i) => {
            const d = new Date(year, curMonth - 1 - i, 1);
            const k = monthKey(d.getFullYear(), d.getMonth() + 1);
            const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
            const saved = monthNotes[k];
            const draft = noteDrafts[k];
            const isOpen = noteOpen[k] ?? (i === 0 || draft !== undefined);
            const a = actuals[k] || lastYear[k];
            const editing = draft !== undefined;
            return (
              <div key={k} className={`border rounded-xl ${saved?.text ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
                <button
                  onClick={() => setNoteOpen(prev => ({ ...prev, [k]: !isOpen }))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold text-gray-700">{label}</span>
                  {a?.revenue ? <span className="text-[11px] text-gray-400">{formatCurrency(a.revenue, true)}</span> : null}
                  {saved?.text && !isOpen && (
                    <span className="text-xs text-gray-500 truncate flex-1">{saved.text}</span>
                  )}
                  <span className="ml-auto text-xs text-gray-300">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    <textarea
                      value={draft ?? saved?.text ?? ''}
                      onChange={e => setNoteDrafts(prev => ({ ...prev, [k]: e.target.value }))}
                      placeholder="What happened this month? Launches, stockouts, promos, creative wins, ad issues…"
                      rows={3}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                    />
                    <div className="flex items-center gap-3 mt-1.5">
                      {editing && (
                        <button
                          onClick={() => saveMonthNote(k)}
                          disabled={noteSaving === k}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                        >
                          {noteSaving === k ? 'Saving…' : 'Save note'}
                        </button>
                      )}
                      {editing && (
                        <button
                          onClick={() => setNoteDrafts(prev => { const n = { ...prev }; delete n[k]; return n; })}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      )}
                      {saved && !editing && (
                        <span className="text-[11px] text-gray-400">
                          Updated {new Date(saved.updatedAt).toLocaleDateString()}{saved.author ? ` by ${saved.author}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
