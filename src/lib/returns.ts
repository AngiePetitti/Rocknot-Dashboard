import { shopifyql } from '@/src/lib/shopifyql';
import { shopifyConfigured } from '@/src/lib/shopifyAuth';
import { salesWhere } from '@/src/lib/client';
import { shiftMonths, addDays } from '@/src/lib/timeframes';

// ── Return rate, next to paid MER ────────────────────────────────────────────
// Paid MER is measured on net sales (after returns) on purpose: that is the
// money the business kept, and it is the same basis as fully loaded MER. The
// agency does not fully control returns, so instead of changing the formula
// the return rate is shown as its own line with a trailing baseline. A spike
// then reads as "returns rose", not as a quietly worse MER.
//
// Rate = refunded sales ÷ gross sales (Shopify's own definition). Shopify books
// a return in the period it is PROCESSED, so the most recent period's rate
// rises for a few weeks as returns land.

export interface ReturnsMonth { month: string; gross: number; returns: number; orders: number; ratePct: number | null }

export interface ReturnsSummary {
  range: { from: string; to: string; gross: number; returns: number; orders: number; ratePct: number | null };
  /** The full calendar months before the period's start month (up to six). */
  baseline: { from: string; to: string; gross: number; returns: number; ratePct: number | null; months: number };
  months: ReturnsMonth[];
  /** Percentage points above (+) or below (−) the baseline. */
  deltaPts: number | null;
  status: 'normal' | 'elevated' | 'high' | null;
  note: string;
}

const num = (v: unknown) => { const n = parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0; };
const pct = (returns: number, gross: number) => (gross > 0 ? Math.round((returns / gross) * 1000) / 10 : null);

export function returnsConfigured(): boolean { return shopifyConfigured(); }

export function returnsStatus(ratePct: number | null, basePct: number | null): { deltaPts: number | null; status: ReturnsSummary['status'] } {
  if (ratePct == null || basePct == null) return { deltaPts: null, status: null };
  const deltaPts = Math.round((ratePct - basePct) * 10) / 10;
  const rel = basePct > 0 ? ratePct / basePct : 1;
  const status: ReturnsSummary['status'] = deltaPts >= 3 || rel >= 1.5 ? 'high' : deltaPts >= 1.5 || rel >= 1.25 ? 'elevated' : 'normal';
  return { deltaPts, status };
}

export async function fetchReturnsSummary(from: string, to: string): Promise<ReturnsSummary> {
  const where = salesWhere();
  const startMonth = `${from.slice(0, 7)}-01`;
  const baseFrom = shiftMonths(startMonth, 6);
  const baseTo = addDays(startMonth, -1);
  const [rangeRows, monthRows] = await Promise.all([
    shopifyql(`FROM sales SHOW orders, gross_sales, returns ${where} SINCE ${from} UNTIL ${to}`, { timeoutMs: 15000 }),
    shopifyql(`FROM sales SHOW orders, gross_sales, returns ${where} TIMESERIES month SINCE ${baseFrom} UNTIL ${to}`, { timeoutMs: 20000 }),
  ]);
  const r = rangeRows[0] || {};
  const gross = num(r.gross_sales), returns = Math.abs(num(r.returns)), orders = Math.round(num(r.orders));
  const months: ReturnsMonth[] = monthRows
    .map(m => {
      const g = num(m.gross_sales), rt = Math.abs(num(m.returns));
      return { month: String(m.month || m.day || '').slice(0, 7), gross: g, returns: rt, orders: Math.round(num(m.orders)), ratePct: pct(rt, g) };
    })
    .filter(m => m.month)
    .sort((a, b) => a.month.localeCompare(b.month));
  const baseMonths = months.filter(m => m.month < startMonth.slice(0, 7) && m.gross > 0);
  const bGross = baseMonths.reduce((s, m) => s + m.gross, 0);
  const bRet = baseMonths.reduce((s, m) => s + m.returns, 0);
  const ratePct = pct(returns, gross), basePct = pct(bRet, bGross);
  const { deltaPts, status } = returnsStatus(ratePct, basePct);
  return {
    range: { from, to, gross, returns, orders, ratePct },
    baseline: { from: baseMonths[0]?.month ? `${baseMonths[0].month}-01` : baseFrom, to: baseTo, gross: bGross, returns: bRet, ratePct: basePct, months: baseMonths.length },
    months,
    deltaPts,
    status,
    note: 'Refunded sales ÷ gross sales. Shopify counts a return in the period it is processed, so the latest weeks rise as returns come in. Paid MER stays on net sales; this line is how a returns problem is seen as returns.',
  };
}

export function returnsText(s: ReturnsSummary): string {
  const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const head = `RETURN RATE (${s.range.from} → ${s.range.to}): ${s.range.ratePct != null ? `${s.range.ratePct}%` : 'n/a'} of gross sales (${$(s.range.returns)} refunded of ${$(s.range.gross)} gross, ${s.range.orders} orders)`;
  const base = s.baseline.ratePct != null
    ? `Baseline (${s.baseline.months} full months before the period, ${s.baseline.from.slice(0, 7)} → ${s.baseline.to.slice(0, 7)}): ${s.baseline.ratePct}% · ${s.deltaPts != null ? `${s.deltaPts >= 0 ? '+' : ''}${s.deltaPts} pts` : ''} · ${s.status ?? ''}`
    : 'Baseline: not enough history yet.';
  const monthly = s.months.map(m => `${m.month}: ${m.ratePct != null ? `${m.ratePct}%` : 'n/a'} (${$(m.returns)} of ${$(m.gross)})`).join('\n');
  return `${head}\n${base}\nBy month:\n${monthly}\n${s.note}`;
}
