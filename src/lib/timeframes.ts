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
