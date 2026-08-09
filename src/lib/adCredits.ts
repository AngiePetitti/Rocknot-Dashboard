// Platform ad credits — promo spend that isn't real cash out, so MER/CAC
// divide by NET spend (gross minus credit consumed). A credit covers the
// platform's cumulative spend between `afterSpend` and `afterSpend + amount`
// (counted from `from`): dollars before the window are real cash, dollars
// inside it are credited, dollars past it are real cash again.
export interface AdCredit {
  platform: 'snapchat' | 'meta' | 'google' | 'tiktok';
  amount: number;
  from: string;
  afterSpend: number;
}

export const AD_CREDITS: AdCredit[] = [
  // Snapchat's $7,500 credit covers the SECOND $7,500 of Snap spend — the
  // first $7,500 was real cash, then the credit kicks in until $15,000
  // cumulative, after which spend is real cash again.
  { platform: 'snapchat', amount: 7500, from: '2026-01-01', afterSpend: 7500 },
];

// How much credit applies to a query range: the overlap between the range's
// cumulative-spend interval [spendBeforeRange, spendBeforeRange + spendInRange]
// and the credit window [afterSpend, afterSpend + amount].
export function creditAppliedInRange(credit: AdCredit, spendBeforeRange: number, spendInRange: number, rangeTo: string): number {
  if (rangeTo < credit.from) return 0;
  const before = Math.max(0, spendBeforeRange);
  const windowStart = credit.afterSpend;
  const windowEnd = credit.afterSpend + credit.amount;
  const applied = Math.min(before + Math.max(0, spendInRange), windowEnd) - Math.max(before, windowStart);
  return Math.round(Math.max(0, applied) * 100) / 100;
}
