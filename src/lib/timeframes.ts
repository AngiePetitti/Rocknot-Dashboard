import { Timeframe } from '@/src/lib/mockData';
import { mtdRange } from '@/src/lib/utils';

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function todayPst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** The date range a dashboard timeframe covers (same rules as /api/windsor). */
export function timeframeRange(tf: Timeframe | 'custom', dateFrom?: string | null, dateTo?: string | null): { from: string; to: string } {
  const todayStr = todayPst();
  const yesterdayStr = addDays(todayStr, -1);
  if (tf === 'custom' && dateFrom && dateTo) return { from: dateFrom, to: dateTo };
  if (tf === 'today') return { from: todayStr, to: todayStr };
  if (tf === 'yesterday') return { from: yesterdayStr, to: yesterdayStr };
  if (tf === '7d') return { from: addDays(todayStr, -7), to: todayStr };
  if (tf === '14d') return { from: addDays(todayStr, -14), to: todayStr };
  if (tf === '30d') return { from: addDays(todayStr, -30), to: todayStr };
  if (tf === 'mtd') return mtdRange(todayStr, yesterdayStr);
  if (tf === '6m') return { from: addDays(todayStr, -180), to: todayStr };
  if (tf === 'ytd') return { from: `${todayStr.split('-')[0]}-01-01`, to: todayStr };
  if (tf === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    return {
      from: new Date(y, m - 2, 1).toLocaleDateString('en-CA'),
      to: new Date(y, m - 1, 0).toLocaleDateString('en-CA'),
    };
  }
  return { from: addDays(todayStr, -30), to: todayStr };
}

// ── Comparison basis ──────────────────────────────────────────────────────
// 'prior' = the period right before (same length); 'month' = the same dates
// one month earlier; 'year' = the same dates one year earlier.
export type CompareMode = 'prior' | 'month' | 'year';

export function parseCompareMode(v: string | null | undefined): CompareMode {
  return v === 'month' || v === 'year' ? v : 'prior';
}

export const COMPARE_LABELS: Record<CompareMode, string> = { prior: 'prior period', month: 'same period last month', year: 'same period last year' };

/** Shift a YYYY-MM-DD back by whole months, clamping the day to the target month's length. */
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1 - months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)).toLocaleDateString('en-CA');
}

/**
 * The comparison range for a current range. 'prior' keeps the dashboard's
 * existing rules (month-to-date and last month compare to the month before,
 * aligned to the same day; everything else to the equal-length window just
 * before). 'month' and 'year' shift the exact dates back.
 */
export function priorRangeFor(mode: CompareMode, tf: Timeframe | 'custom', from: string, to: string): { from: string; to: string; label: string } {
  if (mode === 'year') { const f = shiftMonths(from, 12), t = shiftMonths(to, 12); return { from: f, to: t, label: `${f} – ${t}` }; }
  if (mode === 'month') { const f = shiftMonths(from, 1), t = shiftMonths(to, 1); return { from: f, to: t < f ? f : t, label: `${f} – ${t}` }; }
  if (tf === 'last_month' || tf === 'mtd') {
    const [y, m] = from.split('-').map(Number);
    const pFrom = new Date(y, m - 2, 1).toLocaleDateString('en-CA');
    const pTo = tf === 'mtd' ? new Date(y, m - 2, Number(to.slice(8, 10))).toLocaleDateString('en-CA') : new Date(y, m - 1, 0).toLocaleDateString('en-CA');
    const t = pTo < pFrom ? pFrom : pTo;
    return { from: pFrom, to: t, label: `${pFrom} – ${t}` };
  }
  if (tf === 'ytd') { const f = shiftMonths(from, 12), t = shiftMonths(to, 12); return { from: f, to: t, label: `${f} – ${t}` }; }
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const f = addDays(from, -days), t = addDays(from, -1);
  return { from: f, to: t, label: `${f} – ${t}` };
}
