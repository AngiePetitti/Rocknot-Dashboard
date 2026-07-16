export function formatCurrency(value: number, compact = false): string {
  if (compact && value >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'k';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return value.toFixed(decimals) + '%';
}

export function formatROAS(value: number): string {
  return value.toFixed(2) + 'x';
}

export function formatMultiplier(value: number): string {
  return value.toFixed(2) + 'x';
}

export const TIMEFRAME_LABELS: Record<string, string> = {
  today: 'Today (Live)',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '14d': 'Last 14 Days',
  '30d': 'Last 30 Days',
  mtd: 'Month to Date',
  last_month: 'Last Month',
  '6m': 'Last 6 Months',
  ytd: 'Year to Date',
};

// Shorter labels for mobile buttons
export const TIMEFRAME_SHORT_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': '7 Days',
  '14d': '14 Days',
  '30d': '30 Days',
  mtd: 'MTD',
  last_month: 'Last Mo.',
  '6m': '6 Months',
  ytd: 'YTD',
};

export const TIMEFRAMES = Object.entries(TIMEFRAME_LABELS).map(([value, label]) => ({
  value,
  label,
  shortLabel: TIMEFRAME_SHORT_LABELS[value] || label,
}));

// Month-to-date range: 1st of the current month through YESTERDAY (today is
// partial). On the 1st there are no complete days yet, so it falls back to
// just the 1st. Date strings are YYYY-MM-DD in store (PST) time.
export function mtdRange(todayStr: string, yesterdayStr: string): { from: string; to: string } {
  const first = `${todayStr.slice(0, 7)}-01`;
  return { from: first, to: yesterdayStr >= first ? yesterdayStr : first };
}

export function getStockStatus(daysRemaining: number): 'critical' | 'warning' | 'ok' {
  if (daysRemaining < 7) return 'critical';
  if (daysRemaining <= 14) return 'warning';
  return 'ok';
}
