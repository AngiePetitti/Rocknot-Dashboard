// Black Friday / Cyber Monday tab: the plan (offer, goals, collection links,
// checklist) per client, stored in the Settings KV, plus a text summary for
// Cleo. Performance for the sale window is assembled by /api/bfcm/performance
// from the dashboard's existing sources.

import { getKV, setKV, isChatStoreConfigured } from '@/src/lib/chatStore';
import { getClient } from '@/src/lib/client';

export interface BfcmLink { label: string; url: string }
export interface BfcmCheck { id: string; text: string; done: boolean; owner?: string; due?: string; doneBy?: string; doneAt?: string }
export interface BfcmPlan {
  year: number;
  name: string;
  /** Sale window (inclusive). Performance tracks these dates. */
  window: { from: string; to: string };
  /** Early-access / VIP start, if any. */
  earlyAccessFrom?: string;
  /** Last year's actual sale dates for the baseline — set by hand, or confirmed from the detected revenue lift. */
  lastYear?: { from: string; to: string; source: 'manual' | 'detected' };
  /** The plan in the team's words: offer structure, audiences, cadence. */
  summary: string;
  offers: string;
  goals: { revenue: number; adSpend: number; orders?: number; emailRevenue?: number };
  collections: BfcmLink[];
  checklist: BfcmCheck[];
  notes: string;
  updatedAt?: string;
  updatedBy?: string;
}

export function bfcmYear(): number {
  // The tab tracks the next BFCM: after Cyber Monday + a week, roll to next year.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const y = Number(today.slice(0, 4));
  const cm = cyberMonday(y);
  return today > addDays(cm, 7) ? y + 1 : y;
}
export function addDays(d: string, n: number): string { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }
/** US Thanksgiving = 4th Thursday of November. */
export function thanksgiving(year: number): string {
  const nov1 = new Date(year, 10, 1);
  const firstThu = 1 + ((4 - nov1.getDay() + 7) % 7);
  return `${year}-11-${String(firstThu + 21).padStart(2, '0')}`;
}
export const blackFriday = (y: number) => addDays(thanksgiving(y), 1);
export const cyberMonday = (y: number) => addDays(thanksgiving(y), 4);

const uid = () => Math.random().toString(36).slice(2, 10);
export function defaultChecklist(year: number): BfcmCheck[] {
  const bf = blackFriday(year);
  const item = (text: string, daysBefore: number, owner = ''): BfcmCheck => ({ id: uid(), text, done: false, owner, due: addDays(bf, -daysBefore) });
  return [
    item('Lock the offer structure and discount codes (sitewide %, tiers, GWP, free shipping threshold)', 35),
    item('Confirm inventory depth on hero products and planned bundles; flag anything that cannot support the sale', 30),
    item('Build and QA the BFCM collection pages (links above); hide them until launch', 21),
    item('Creative: shoot or cut ad variations per offer (static, video, UGC) and name them with the BFCM prefix', 21),
    item('Ad campaigns built in draft on every platform with BFCM budgets, audiences and the launch schedule', 14),
    item('Email: VIP early access, launch, reminder, last chance, Cyber Monday and extension sends drafted and scheduled in Klaviyo', 14),
    item('SMS: compliant opt-in confirmed; launch, reminder and last-chance texts scheduled', 14),
    item('Site: banners, hero, announcement bar, countdown and discount logic tested on mobile', 7),
    item('Tracking: pixels, UTMs on every link, GA4 and dashboard attribution checked with a test order', 7),
    item('Customer service: FAQ, return policy copy and response templates ready; coverage scheduled for the weekend', 5),
    item('Day-of: launch checks at go-live (site, codes, ads live, first email delivered)', 0),
    item('Cyber Monday: final push sends and budget shifts to the best performers', -3),
    item('Post-sale: recap with the numbers from this tab, winners and misses, inventory left', -8),
  ];
}

export function defaultPlan(year = bfcmYear()): BfcmPlan {
  return {
    year, name: `BFCM ${year}`,
    window: { from: blackFriday(year), to: cyberMonday(year) },
    earlyAccessFrom: addDays(blackFriday(year), -3),
    summary: '', offers: '',
    goals: { revenue: 0, adSpend: 0 },
    collections: [], checklist: defaultChecklist(year), notes: '',
  };
}

const key = (year: number) => `bfcm_plan_${getClient().id}_${year}`;

export async function loadBfcmPlan(year = bfcmYear()): Promise<BfcmPlan> {
  if (!isChatStoreConfigured()) return defaultPlan(year);
  try {
    const raw = await getKV(key(year));
    if (!raw) return defaultPlan(year);
    const p = JSON.parse(raw) as Partial<BfcmPlan>;
    const d = defaultPlan(year);
    return { ...d, ...p, goals: { ...d.goals, ...(p.goals || {}) }, window: { ...d.window, ...(p.window || {}) }, collections: p.collections || [], checklist: p.checklist?.length ? p.checklist : d.checklist };
  } catch { return defaultPlan(year); }
}

export async function saveBfcmPlan(plan: BfcmPlan, by?: string): Promise<BfcmPlan> {
  const next = { ...plan, updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}) };
  await setKV(key(plan.year), JSON.stringify(next));
  return next;
}

/** Where the sale stands relative to today. */
export function bfcmPhase(plan: BfcmPlan, today: string): 'before' | 'early_access' | 'live' | 'after' {
  if (today > plan.window.to) return 'after';
  if (today >= plan.window.from) return 'live';
  if (plan.earlyAccessFrom && today >= plan.earlyAccessFrom) return 'early_access';
  return 'before';
}

export function bfcmPlanText(plan: BfcmPlan, today: string): string {
  const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const phase = bfcmPhase(plan, today);
  const days = Math.round((Date.parse(plan.window.from) - Date.parse(today)) / 86400000);
  const open = plan.checklist.filter(c => !c.done);
  return `${plan.name} — sale window ${plan.window.from} → ${plan.window.to}${plan.earlyAccessFrom ? ` (early access from ${plan.earlyAccessFrom})` : ''} · status: ${phase === 'before' ? `${days} days to go` : phase}.${plan.lastYear ? ` Last year's sale ran ${plan.lastYear.from} → ${plan.lastYear.to} (${plan.lastYear.source}); that is the "vs last year" baseline.` : ''}
Goals: revenue ${$(plan.goals.revenue)} · ad spend ${$(plan.goals.adSpend)}${plan.goals.adSpend > 0 ? ` · implied MER ${(plan.goals.revenue / plan.goals.adSpend).toFixed(1)}x` : ''}${plan.goals.orders ? ` · orders ${plan.goals.orders}` : ''}${plan.goals.emailRevenue ? ` · email/SMS revenue ${$(plan.goals.emailRevenue)}` : ''}.
Plan: ${plan.summary || '(not written yet)'}
Offers: ${plan.offers || '(not set)'}
Collections: ${plan.collections.map(c => `${c.label} ${c.url}`).join(' · ') || 'none linked yet'}
Checklist: ${plan.checklist.length - open.length}/${plan.checklist.length} done.${open.length ? ` Open: ${open.map(c => `${c.text}${c.owner ? ` (${c.owner})` : ''}${c.due ? ` due ${c.due}` : ''}`).join('; ')}` : ''}
${plan.notes ? `Notes: ${plan.notes}` : ''}`;
}

/**
 * Find last year's sale from the revenue itself: the longest run of days in
 * mid-Nov → mid-Dec whose revenue sits well above the pre-sale baseline
 * (median of late Oct → mid Nov), extended to neighbouring days that are
 * still clearly elevated. Returns null when no run stands out.
 */
export function detectSaleWindow(days: Array<{ date: string; revenue: number }>, year: number): { from: string; to: string; lift: number; baseline: number } | null {
  const sorted = [...days].filter(d => d.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  const base = sorted.filter(d => d.date >= `${year}-10-20` && d.date <= `${year}-11-15`).map(d => d.revenue).sort((a, b) => a - b);
  if (base.length < 10) return null;
  const median = base[Math.floor(base.length / 2)];
  if (median <= 0) return null;
  const cand = sorted.filter(d => d.date >= `${year}-11-16` && d.date <= `${year}-12-12`);
  const hot = (r: number) => r >= median * 1.6; const warm = (r: number) => r >= median * 1.3;
  let best: { s: number; e: number } | null = null; let i = 0;
  while (i < cand.length) {
    if (!hot(cand[i].revenue)) { i++; continue; }
    let j = i;
    while (j + 1 < cand.length && (hot(cand[j + 1].revenue) || (warm(cand[j + 1].revenue) && j + 2 < cand.length && hot(cand[j + 2].revenue)))) j++;
    if (!best || j - i > best.e - best.s) best = { s: i, e: j };
    i = j + 1;
  }
  if (!best) return null;
  let { s, e } = best;
  while (s > 0 && warm(cand[s - 1].revenue)) s--;
  while (e + 1 < cand.length && warm(cand[e + 1].revenue)) e++;
  const run = cand.slice(s, e + 1);
  const avg = run.reduce((t, d) => t + d.revenue, 0) / run.length;
  return { from: run[0].date, to: run[run.length - 1].date, lift: Math.round((avg / median) * 10) / 10, baseline: Math.round(median) };
}
