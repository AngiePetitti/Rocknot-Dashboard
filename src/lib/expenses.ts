// Marketing expenses from the team's budgeting Google Sheet (profile
// finance.expensesSheet): one row per expense line, one column per month.
// Read as CSV through the sheet's link-share (no credentials), cached an hour.
//
// The sheet is the only source for marketing costs that never touch the ad
// platforms (agency, content, photoshoots, email tooling, SEO…). Ad platform
// spend itself stays LIVE from the dashboard; the sheet's Google/Meta/Pinterest
// rows are shown for comparison only, never added on top.

import { getClient } from '@/src/lib/client';

export interface ExpenseLine {
  label: string;
  section: 'paid' | 'organic';
  /** True for the ad-platform rows the dashboard already tracks live (Google, Meta, Pinterest, paid tests). */
  adPlatform: boolean;
  /** Amount per month, 'YYYY-MM' → dollars. */
  byMonth: Record<string, number>;
}

export interface ExpenseMonth {
  month: string;
  budget: number | null;
  /** Sheet's ad-platform lines (Google + Meta + Pinterest + paid Test). */
  sheetAdSpend: number;
  /** Everything else marketing: agency, influencer/PR, paid tools, email/SMS, platforms, content, photoshoot, SEO, organic tests. */
  nonAdMarketing: number;
  totalMarketing: number;
  salesGoal: number | null;
  actualSales: number | null;
  priorYearSales: number | null;
  priorYearMarketing: number | null;
  newCustomers: number | null;
  /** 'plan' for months after the current one (budget figures until actuals are entered). */
  basis: 'actual' | 'current' | 'plan';
}

export interface ExpenseSheet {
  title: string;
  year: number;
  lines: ExpenseLine[];
  months: ExpenseMonth[];
  fetchedAt: string;
}

export interface RangeExpenses {
  from: string; to: string;
  /** Prorated by days: each month's figure × days of the month inside the range ÷ days in the month. */
  nonAdMarketing: number;
  sheetAdSpend: number;
  totalMarketing: number;
  budget: number;
  lines: Array<{ label: string; section: 'paid' | 'organic'; adPlatform: boolean; amount: number }>;
  monthsCovered: Array<{ month: string; days: number; daysInMonth: number; basis: ExpenseMonth['basis'] }>;
  /** True when part of the range is this month or later (sheet holds plan numbers there). */
  includesPlan: boolean;
}

const num = (v: string) => {
  const t = v.replace(/[$,\s]/g, '');
  if (!t || t === '-' || /^#/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = parseFloat(t.replace(/[()\-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

/** Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const AD_PLATFORM_RE = /^(google|meta|facebook|pinterest|tiktok|snapchat|test)\b/;
const SKIP_RE = /budget|total|spent|goal|sales|difference|to goal|customers|^cac|^mer|^%|^roi|forecast|etsy|nordstrom|inventory|quarterly|over\/under/;

export function expensesConfigured(): boolean { return Boolean(getClient().finance.expensesSheet); }

let cache: { t: number; sheet: ExpenseSheet } | null = null;
const TTL = 60 * 60 * 1000;

export async function fetchExpenseSheet(force = false): Promise<ExpenseSheet> {
  const cfg = getClient().finance.expensesSheet;
  if (!cfg) throw new Error('No marketing expenses sheet on this client profile');
  if (!force && cache && Date.now() - cache.t < TTL) return cache.sheet;
  const url = `https://docs.google.com/spreadsheets/d/${cfg.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.tab)}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Expenses sheet returned HTTP ${res.status} — is it still shared as "anyone with the link can view"?`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error('Expenses sheet returned a sign-in page instead of data — re-share it as "anyone with the link can view"');
  const sheet = parseExpenseSheet(text, cfg.year, cfg.tab);
  cache = { t: Date.now(), sheet };
  return sheet;
}

export function parseExpenseSheet(csv: string, year: number, title: string): ExpenseSheet {
  const rows = parseCsv(csv);
  // Header row: the one whose cells name the months.
  const hdrIdx = rows.findIndex(r => r.filter(c => MONTHS.includes(norm(c).slice(0, 3))).length >= 6);
  if (hdrIdx < 0) throw new Error('Expenses sheet: no month header row found (expected Jan … Dec across the top)');
  const hdr = rows[hdrIdx];
  const monthCol: Record<string, number> = {};
  hdr.forEach((c, i) => { const k = MONTHS.indexOf(norm(c).slice(0, 3)); if (k >= 0 && !(`${k}` in Object.values(monthCol).map(String))) monthCol[`${year}-${String(k + 1).padStart(2, '0')}`] = i; });
  const months = Object.keys(monthCol).sort();
  const rowVals = (r: string[]) => Object.fromEntries(months.map(m => [m, num(r[monthCol[m]] ?? '') ?? 0])) as Record<string, number>;
  const find = (re: RegExp) => rows.slice(hdrIdx + 1).find(r => re.test(norm(r[0] || '')));

  const lines: ExpenseLine[] = [];
  let section: 'paid' | 'organic' = 'paid';
  for (const r of rows.slice(hdrIdx + 1)) {
    const label = (r[0] || '').trim(); const n = norm(label);
    if (!label) continue;
    if (/^total organic/.test(n)) break;                 // end of the expense block
    if (/^organic budget/.test(n)) { section = 'organic'; continue; }
    if (SKIP_RE.test(n)) continue;
    const byMonth = rowVals(r);
    if (!Object.values(byMonth).some(v => v !== 0)) continue;
    lines.push({ label, section, adPlatform: section === 'paid' && AD_PLATFORM_RE.test(n), byMonth });
  }
  if (!lines.length) throw new Error('Expenses sheet: no expense rows recognised under the month header');

  const budgetRow = find(/^monthly budget/); const goalRow = find(/^monthly sales goal/); const actualRow = find(/^actual sales$/);
  const pySales = find(new RegExp(`^${year - 1} sales`)); const pySpend = find(new RegExp(`^${year - 1} marketing`)); const newCust = find(/^new customers/);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7);
  const monthRows: ExpenseMonth[] = months.map(m => {
    const sheetAdSpend = lines.filter(l => l.adPlatform).reduce((s, l) => s + (l.byMonth[m] || 0), 0);
    const nonAdMarketing = lines.filter(l => !l.adPlatform).reduce((s, l) => s + (l.byMonth[m] || 0), 0);
    const cell = (r: string[] | undefined) => (r ? num(r[monthCol[m]] ?? '') : null);
    return {
      month: m, budget: cell(budgetRow), sheetAdSpend, nonAdMarketing, totalMarketing: sheetAdSpend + nonAdMarketing,
      salesGoal: cell(goalRow), actualSales: cell(actualRow) || null, priorYearSales: cell(pySales), priorYearMarketing: cell(pySpend), newCustomers: cell(newCust) || null,
      basis: m < today ? 'actual' : m === today ? 'current' : 'plan',
    };
  });
  return { title, year, lines, months: monthRows, fetchedAt: new Date().toISOString() };
}

const daysIn = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();

/** Sheet expenses prorated onto a date range (months are spread evenly across their days). */
export function expensesForRange(sheet: ExpenseSheet, from: string, to: string): RangeExpenses {
  const monthsCovered: RangeExpenses['monthsCovered'] = [];
  const weights: Record<string, number> = {};
  for (const mo of sheet.months) {
    const dim = daysIn(mo.month);
    const mFrom = `${mo.month}-01`; const mTo = `${mo.month}-${String(dim).padStart(2, '0')}`;
    const a = from > mFrom ? from : mFrom; const b = to < mTo ? to : mTo;
    if (a > b) continue;
    const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
    weights[mo.month] = days / dim;
    monthsCovered.push({ month: mo.month, days, daysInMonth: dim, basis: mo.basis });
  }
  const w = (byMonth: Record<string, number>) => Object.entries(weights).reduce((s, [m, f]) => s + (byMonth[m] || 0) * f, 0);
  const lines = sheet.lines.map(l => ({ label: l.label, section: l.section, adPlatform: l.adPlatform, amount: Math.round(w(l.byMonth) * 100) / 100 })).filter(l => l.amount !== 0);
  const budget = Object.entries(weights).reduce((s, [m, f]) => s + ((sheet.months.find(x => x.month === m)?.budget || 0) * f), 0);
  const sheetAdSpend = lines.filter(l => l.adPlatform).reduce((s, l) => s + l.amount, 0);
  const nonAdMarketing = lines.filter(l => !l.adPlatform).reduce((s, l) => s + l.amount, 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    from, to, nonAdMarketing: r2(nonAdMarketing), sheetAdSpend: r2(sheetAdSpend), totalMarketing: r2(sheetAdSpend + nonAdMarketing), budget: r2(budget),
    lines, monthsCovered, includesPlan: monthsCovered.some(m => m.basis !== 'actual'),
  };
}

/** Plain-text summary for Cleo. */
export function expensesText(sheet: ExpenseSheet, range: RangeExpenses | null): string {
  const $ = (v: number | null | undefined) => (v == null ? 'n/a' : `$${Math.round(v).toLocaleString()}`);
  const head = `MARKETING EXPENSES — from the team's budgeting sheet "${sheet.title}" (${sheet.year}; months from this month on are PLAN numbers until actuals are entered). Ad-platform rows (Google/Meta/Pinterest/Test) are the sheet's own entries; the dashboard's live ad spend is the authority for those — use the sheet only for the OTHER marketing costs (agency, influencer/PR, tools, email/SMS, platforms, content, photoshoots, SEO).`;
  const monthLines = sheet.months.map(m => `${m.month} [${m.basis}]: total marketing ${$(m.totalMarketing)} (ads per sheet ${$(m.sheetAdSpend)} + other marketing ${$(m.nonAdMarketing)}) · budget ${$(m.budget)}${m.actualSales ? ` · sales ${$(m.actualSales)} vs goal ${$(m.salesGoal)}` : m.salesGoal ? ` · sales goal ${$(m.salesGoal)}` : ''}${m.newCustomers ? ` · new customers ${m.newCustomers} (sheet CAC ${$(m.totalMarketing / m.newCustomers)} on total marketing)` : ''}${m.priorYearMarketing ? ` · ${sheet.year - 1}: marketing ${$(m.priorYearMarketing)}, sales ${$(m.priorYearSales)}` : ''}`).join('\n');
  const rangeTxt = range ? `\n\nRANGE ${range.from} → ${range.to} (prorated by days${range.includesPlan ? '; includes plan months' : ''}): other marketing ${$(range.nonAdMarketing)} · ads per sheet ${$(range.sheetAdSpend)} · total ${$(range.totalMarketing)} · budget ${$(range.budget)}\n` +
    range.lines.map(l => `- ${l.label}${l.adPlatform ? ' (ad platform — live spend on the dashboard is the source)' : ''}: ${$(l.amount)}`).join('\n') : '';
  return `${head}\n\nBY MONTH:\n${monthLines}${rangeTxt}`;
}
