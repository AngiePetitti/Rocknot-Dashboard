// Platform ad credits — promo spend that isn't real cash out, so MER/CAC
// divide by NET spend (gross minus credit consumed). A credit applies to the
// platform's first `amount` dollars of spend starting on `from`; it depletes
// as spend accumulates.
export interface AdCredit { platform: 'snapchat' | 'meta' | 'google' | 'tiktok'; amount: number; from: string }

export const AD_CREDITS: AdCredit[] = [
  // Snapchat gave Rocknot a $7,500 ad credit covering the FIRST $7,500 ever
  // spent on Snap ads — `from` predates the account so all spend counts
  // against it from day one.
  { platform: 'snapchat', amount: 7500, from: '2026-01-01' },
];

// How much credit applies to a query range, given the platform's spend inside
// the range and its cumulative spend between the credit start and the range
// start (which already consumed part of the credit).
export function creditAppliedInRange(credit: AdCredit, spendBeforeRange: number, spendInRange: number, rangeTo: string): number {
  if (rangeTo < credit.from) return 0;
  const remaining = Math.max(0, credit.amount - Math.max(0, spendBeforeRange));
  return Math.round(Math.min(remaining, Math.max(0, spendInRange)) * 100) / 100;
}
