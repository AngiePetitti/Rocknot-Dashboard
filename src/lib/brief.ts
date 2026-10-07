// The intelligence layer: a daily brief that says what moved and why.
//
// Two stages, deliberately separated:
//   1. FACTS — computed here from Shopify, the ad tables and the CAC model,
//      with exact numbers: yesterday against the average of the same weekday
//      over the prior four weeks (retail has a weekly rhythm), the last seven
//      days against the seven before, revenue decomposed into traffic ×
//      conversion × order value, conversion by device, sessions by channel,
//      spend and new-customer CAC by platform, Google brand vs non-brand, and
//      product momentum (share of revenue yesterday vs its 28-day share).
//   2. WORDS — Cleo turns the facts into four or five plain sentences and a
//      recommendation. She is given only the facts and may use only numbers
//      that appear in them, so the brief cannot invent a figure.
// Cached per day in the Settings KV; the Overview card and Cleo read it.
import Anthropic from '@anthropic-ai/sdk';
import { shopifyql } from '@/src/lib/shopifyql';
import { storeOnlyWhere, getClient, hasPlatform } from '@/src/lib/client';
import { getAdsOverview } from '@/src/lib/bqAds';
import { fetchNcac } from '@/src/lib/ncac';
import { runQuery, isBigQueryConfigured, googleSource, tableExists } from '@/src/lib/bigquery';
import { getKV, setKV, isChatStoreConfigured, getGoals } from '@/src/lib/chatStore';
import { evaluateDecisions, type Decision } from '@/src/lib/decisions';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (cur: number, base: number) => (base > 0 ? r2(((cur - base) / base) * 100) : null);
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const todayPst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export interface Delta { current: number; baseline: number; pct: number | null }
export interface BriefFacts {
  date: string;                 // the day the brief is about (yesterday)
  weekday: string;
  baseline: { kind: 'same weekday, prior 4 weeks'; days: string[] };
  week: { from: string; to: string }; priorWeek: { from: string; to: string };
  revenue: Delta; orders: Delta; aov: Delta; sessions: Delta; cvr: Delta; // cvr in %
  /** How much of the revenue change came from traffic, conversion and order value (percentage points, sum ≈ revenue.pct). */
  decomposition: { fromSessions: number; fromCvr: number; fromAov: number } | null;
  devices: Array<{ device: string; sessions: number; cvr: Delta }>;
  channels: Array<{ channel: string; sessions: Delta }>;
  spendYesterday: { total: Delta; byPlatform: Array<{ platform: string; spend: Delta }> };
  weekAds: { spend: Delta; purchases: Delta; revenue: Delta; byPlatform: Array<{ platform: string; spend: Delta; purchases: Delta; roas: Delta; clicks: Delta }> };
  /** Last 7 days of store net revenue vs the 7 before, and MER on that week. */
  weekRevenue: Delta; weekMer: Delta;
  /** Month to date against the Goals tab. */
  mtd: { spend: number; adBudget: number | null; revenue: number; revenueGoal: number | null; dayOfMonth: number; daysInMonth: number } | null;
  /** The seven operating questions, answered by rule. */
  decisions: Decision[];
  cac: { blended: Delta; blendedNewCustomers: Delta; byPlatform: Array<{ platform: string; ncac: Delta; newCustomers: Delta }> } | null;
  googleBrand: { brand: { spend: Delta; purchases: Delta; cpa: Delta }; nonBrand: { spend: Delta; purchases: Delta; cpa: Delta } } | null;
  products: Array<{ title: string; revenue: number; shareYesterday: number; share28d: number; orders: number }>;
  notes: string[];
}
export interface Brief {
  date: string;
  generatedAt: string;
  headline: string;
  summary: string;
  drivers: string[];
  recommendation: string;
  watch?: string;
  facts: BriefFacts;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const cacheKey = (date: string) => `brief_${getClient().id}_${date}`;

export async function getCachedBrief(date: string): Promise<Brief | null> {
  if (!isChatStoreConfigured()) return null;
  try { const raw = await getKV(cacheKey(date)); return raw ? (JSON.parse(raw) as Brief) : null; } catch { return null; }
}

// ── Facts ──────────────────────────────────────────────────────────────────

async function dailySales(from: string, to: string): Promise<Map<string, { orders: number; net: number }>> {
  const rows = await shopifyql(`FROM sales SHOW orders, net_sales TIMESERIES day ${storeOnlyWhere()} SINCE ${from} UNTIL ${to}`, { timeoutMs: 25000 }).catch(() => []);
  const m = new Map<string, { orders: number; net: number }>();
  for (const r of rows) { const d = str(r.day).slice(0, 10); if (d) m.set(d, { orders: num(r.orders), net: num(r.net_sales) }); }
  return m;
}
async function dailySessions(from: string, to: string): Promise<Map<string, { sessions: number; completed: number }>> {
  const rows = await shopifyql(`FROM sessions SHOW sessions, sessions_that_completed_checkout TIMESERIES day SINCE ${from} UNTIL ${to}`, { timeoutMs: 25000 }).catch(() => []);
  const m = new Map<string, { sessions: number; completed: number }>();
  for (const r of rows) { const d = str(r.day).slice(0, 10); if (d) m.set(d, { sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout) }); }
  return m;
}
async function byDevice(from: string, to: string): Promise<Map<string, { sessions: number; completed: number }>> {
  const rows = await shopifyql(`FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY session_device_type SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 6`, { timeoutMs: 20000 }).catch(() => []);
  const m = new Map<string, { sessions: number; completed: number }>();
  for (const r of rows) m.set(str(r.session_device_type) || 'Unknown', { sessions: num(r.sessions), completed: num(r.sessions_that_completed_checkout) });
  return m;
}
async function byChannel(from: string, to: string): Promise<Map<string, number>> {
  const rows = await shopifyql(`FROM sessions SHOW sessions GROUP BY referrer_source SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 12`, { timeoutMs: 20000 }).catch(() => []);
  const m = new Map<string, number>();
  for (const r of rows) m.set(str(r.referrer_source) || 'direct', num(r.sessions));
  return m;
}
async function byProduct(from: string, to: string, limit: number): Promise<Array<{ title: string; net: number; orders: number }>> {
  const rows = await shopifyql(`FROM sales SHOW net_sales, orders GROUP BY product_title ${storeOnlyWhere()} SINCE ${from} UNTIL ${to} ORDER BY net_sales DESC LIMIT ${limit}`, { timeoutMs: 25000 }).catch(() => []);
  return rows.map(r => ({ title: str(r.product_title), net: num(r.net_sales), orders: num(r.orders) })).filter(p => p.title);
}
async function googleBrandSplit(from: string, to: string): Promise<{ brand: { spend: number; conv: number }; nonBrand: { spend: number; conv: number } } | null> {
  if (!isBigQueryConfigured() || !hasPlatform('google') || !(await tableExists('google_ads'))) return null;
  try {
    const gsrc = await googleSource();
    const rows = await runQuery<{ seg: string; spend: number; conv: number }>(
      `SELECT CASE WHEN REGEXP_CONTAINS(LOWER(CAST(campaign AS STRING)), r'brand') THEN 'brand' ELSE 'non_brand' END AS seg,
              SUM(spend) AS spend, SUM(IFNULL(conversions, 0)) AS conv
       FROM ${gsrc} WHERE DATE(date) BETWEEN @from AND @to GROUP BY seg`, { from, to });
    const get = (k: string) => { const r = rows.find(x => x.seg === k); return { spend: num(r?.spend), conv: num(r?.conv) }; };
    return { brand: get('brand'), nonBrand: get('non_brand') };
  } catch { return null; }
}

const delta = (cur: number, base: number): Delta => ({ current: r2(cur), baseline: r2(base), pct: pct(cur, base) });

export async function computeFacts(date: string): Promise<BriefFacts> {
  const y = date;
  const baselineDays = [7, 14, 21, 28].map(n => addDays(y, -n));
  const rangeFrom = addDays(y, -28);
  const week = { from: addDays(y, -6), to: y };
  const priorWeek = { from: addDays(y, -13), to: addDays(y, -7) };
  const notes: string[] = [];

  const [sales, sessions, devY, devBase, chY, chBase, prodY, prodBase, adsRange, adsWeek, adsPrior, ncacWeek, ncacPrior, gbWeek, gbPrior] = await Promise.all([
    dailySales(rangeFrom, y), dailySessions(rangeFrom, y),
    byDevice(y, y), byDevice(rangeFrom, addDays(y, -1)),
    byChannel(y, y), byChannel(rangeFrom, addDays(y, -1)),
    byProduct(y, y, 12), byProduct(rangeFrom, addDays(y, -1), 60),
    getAdsOverview(rangeFrom, y).catch(() => null),
    getAdsOverview(week.from, week.to).catch(() => null),
    getAdsOverview(priorWeek.from, priorWeek.to).catch(() => null),
    fetchNcac(week.from, week.to).catch(() => null),
    fetchNcac(priorWeek.from, priorWeek.to).catch(() => null),
    googleBrandSplit(week.from, week.to), googleBrandSplit(priorWeek.from, priorWeek.to),
  ]);

  const avg = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
  const sY = sales.get(y) || { orders: 0, net: 0 };
  const sB = baselineDays.map(d => sales.get(d)).filter(Boolean) as Array<{ orders: number; net: number }>;
  const vY = sessions.get(y) || { sessions: 0, completed: 0 };
  const vB = baselineDays.map(d => sessions.get(d)).filter(Boolean) as Array<{ sessions: number; completed: number }>;
  if (sB.length < 4) notes.push(`Only ${sB.length} of 4 baseline days had sales data.`);
  const revenue = delta(sY.net, avg(sB.map(s => s.net)));
  const orders = delta(sY.orders, avg(sB.map(s => s.orders)));
  const aov = delta(sY.orders ? sY.net / sY.orders : 0, avg(sB.map(s => (s.orders ? s.net / s.orders : 0))));
  const sess = delta(vY.sessions, avg(vB.map(v => v.sessions)));
  const cvrY = vY.sessions ? (sY.orders / vY.sessions) * 100 : 0;
  const cvrB = avg(vB.map((v, i) => (v.sessions && sB[i] ? (sB[i].orders / v.sessions) * 100 : 0)).filter(x => x > 0));
  const cvr = delta(cvrY, cvrB);
  // Log decomposition: ln(R1/R0) = ln(S1/S0) + ln(C1/C0) + ln(A1/A0); shares scaled to the revenue % change.
  let decomposition: BriefFacts['decomposition'] = null;
  if (revenue.baseline > 0 && revenue.current > 0 && sess.baseline > 0 && sess.current > 0 && cvr.baseline > 0 && cvr.current > 0 && aov.baseline > 0 && aov.current > 0) {
    const lr = Math.log(revenue.current / revenue.baseline);
    const ls = Math.log(sess.current / sess.baseline), lc = Math.log(cvr.current / cvr.baseline), la = Math.log(aov.current / aov.baseline);
    const tot = ls + lc + la || 1;
    const scale = (revenue.pct || 0) / tot;
    decomposition = { fromSessions: r2(ls * scale), fromCvr: r2(lc * scale), fromAov: r2(la * scale) };
  }

  const baseDays = 28;
  const devices = Array.from(devY.entries()).filter(([, v]) => v.sessions >= 20).map(([device, v]) => {
    const b = devBase.get(device);
    return { device, sessions: v.sessions, cvr: delta(v.sessions ? (v.completed / v.sessions) * 100 : 0, b && b.sessions ? (b.completed / b.sessions) * 100 : 0) };
  });
  const channels = Array.from(chY.entries()).map(([channel, s]) => ({ channel, sessions: delta(s, (chBase.get(channel) || 0) / baseDays) })).filter(c => c.sessions.current >= 30 || c.sessions.baseline >= 30);

  // Spend yesterday vs same-weekday baseline, per platform.
  const platformKeys: Array<{ key: keyof NonNullable<typeof adsRange>['dailySpend'][number]; label: string }> = [
    { key: 'meta', label: 'Meta' }, { key: 'google', label: 'Google' }, { key: 'pinterest', label: 'Pinterest' }, { key: 'tiktok', label: 'TikTok' }, { key: 'snapchat', label: 'Snapchat' },
  ];
  const dayRow = (d: string) => adsRange?.dailySpend.find(x => x.date === d);
  const byPlatformSpend = platformKeys.map(p => {
    const cur = num(dayRow(y)?.[p.key]);
    const base = avg(baselineDays.map(d => num(dayRow(d)?.[p.key])));
    return { platform: p.label, spend: delta(cur, base) };
  }).filter(p => p.spend.current > 0 || p.spend.baseline > 0);
  const spendYesterday = { total: delta(byPlatformSpend.reduce((s, p) => s + p.spend.current, 0), byPlatformSpend.reduce((s, p) => s + p.spend.baseline, 0)), byPlatform: byPlatformSpend };

  const wp = adsWeek?.platforms || [], pp = adsPrior?.platforms || [];
  const sum = (arr: typeof wp, k: 'spend' | 'conversions' | 'revenue') => arr.reduce((s, p) => s + num(p[k]), 0);
  const weekAds = {
    spend: delta(sum(wp, 'spend'), sum(pp, 'spend')), purchases: delta(sum(wp, 'conversions'), sum(pp, 'conversions')), revenue: delta(sum(wp, 'revenue'), sum(pp, 'revenue')),
    byPlatform: wp.map(p => { const q = pp.find(x => x.platform === p.platform); return { platform: p.platform, spend: delta(p.spend, num(q?.spend)), purchases: delta(p.conversions, num(q?.conversions)), roas: delta(p.roas, num(q?.roas)), clicks: delta(p.clicks, num(q?.clicks)) }; }),
  };
  const cac = ncacWeek ? {
    blended: delta(ncacWeek.blended.ncac || 0, ncacPrior?.blended.ncac || 0),
    blendedNewCustomers: delta(ncacWeek.blended.newCustomers, ncacPrior?.blended.newCustomers || 0),
    byPlatform: ncacWeek.platforms.filter(p => p.spend > 0).map(p => { const q = ncacPrior?.platforms.find(x => x.key === p.key); return { platform: p.label, ncac: delta(p.ncac || 0, q?.ncac || 0), newCustomers: delta(p.newCustomers, q?.newCustomers || 0) }; }),
  } : null;
  const googleBrand = gbWeek ? (() => {
    const seg = (c: { spend: number; conv: number }, p?: { spend: number; conv: number }) => ({ spend: delta(c.spend, num(p?.spend)), purchases: delta(c.conv, num(p?.conv)), cpa: delta(c.conv ? c.spend / c.conv : 0, p && p.conv ? p.spend / p.conv : 0) });
    return { brand: seg(gbWeek.brand, gbPrior?.brand), nonBrand: seg(gbWeek.nonBrand, gbPrior?.nonBrand) };
  })() : null;

  const totalY = prodY.reduce((s, p) => s + p.net, 0);
  const totalB = prodBase.reduce((s, p) => s + p.net, 0);
  const products = prodY.slice(0, 8).map(p => {
    const b = prodBase.find(x => x.title === p.title);
    return { title: p.title, revenue: r2(p.net), orders: p.orders, shareYesterday: totalY ? r2((p.net / totalY) * 100) : 0, share28d: totalB && b ? r2((b.net / totalB) * 100) : 0 };
  });

  // Week revenue (store net) and MER; month-to-date against the Goals tab.
  const sumRange = (from: string, to: string) => Array.from(sales.entries()).filter(([d]) => d >= from && d <= to).reduce((s, [, v]) => s + v.net, 0);
  const weekRevenue = delta(sumRange(week.from, week.to), sumRange(priorWeek.from, priorWeek.to));
  const weekMer = delta(weekAds.spend.current > 0 ? weekRevenue.current / weekAds.spend.current : 0, weekAds.spend.baseline > 0 ? weekRevenue.baseline / weekAds.spend.baseline : 0);
  let mtd: BriefFacts['mtd'] = null;
  try {
    const monthStart = `${y.slice(0, 7)}-01`;
    const dayOfMonth = Number(y.slice(8, 10));
    const daysInMonth = new Date(Number(y.slice(0, 4)), Number(y.slice(5, 7)), 0).getDate();
    const goals = await getGoals().catch(() => []);
    const goal = goals.find(g => g.month === y.slice(0, 7) || g.month === monthStart);
    const mtdSpend = (adsRange?.dailySpend || []).filter(d => d.date >= monthStart && d.date <= y).reduce((s, d) => s + num(d.meta) + num(d.google) + num(d.tiktok) + num(d.snapchat) + num(d.pinterest), 0);
    mtd = { spend: r2(mtdSpend), adBudget: goal?.adBudget ?? null, revenue: r2(sumRange(monthStart, y)), revenueGoal: goal?.revenueGoal ?? null, dayOfMonth, daysInMonth };
  } catch { mtd = null; }

  const partial: Omit<BriefFacts, 'decisions'> = {
    date: y, weekday: new Date(`${y}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' }),
    baseline: { kind: 'same weekday, prior 4 weeks', days: baselineDays }, week, priorWeek,
    revenue, orders, aov, sessions: sess, cvr, decomposition, devices, channels, spendYesterday, weekAds, weekRevenue, weekMer, mtd, cac, googleBrand, products, notes,
  };
  const decisions = evaluateDecisions({ facts: { ...partial, decisions: [] }, weekRevenue, weekMer, mtd });
  return { ...partial, decisions };
}

// ── Words ──────────────────────────────────────────────────────────────────

export async function writeBrief(facts: BriefFacts): Promise<Omit<Brief, 'facts' | 'generatedAt' | 'date'>> {
  const brand = getClient();
  const pretty = new Date(`${facts.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const tool: Anthropic.Tool = {
    name: 'write_brief',
    description: 'Submit the morning brief.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One line, ≤ 110 characters, the single most important thing. Start with the day, e.g. "Tuesday: revenue down 18% on softer conversion".' },
        summary: { type: 'string', description: '2–4 plain sentences: what happened and why, in the style "Revenue fell 18% vs the same weekday. Traffic was flat; the decline came from conversion dropping from 2.8% to 2.2%, concentrated on mobile." Numbers only from FACTS.' },
        drivers: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short bullets, each one driver with its number (channel, device, platform, product).' },
        recommendation: { type: 'string', description: '1–2 sentences. Concrete, or "No budget change recommended" when the movement is within normal range.' },
        watch: { type: 'string', description: 'Optional one line: something to keep an eye on.' },
      },
      required: ['headline', 'summary', 'drivers', 'recommendation'],
    },
  };
  const system = `You are ${brand.analyst.name}, ${brand.name}'s in-house analyst, writing the founder's morning brief for ${pretty}. You are given FACTS as JSON. Rules:
- Use ONLY numbers that appear in FACTS. Never estimate, extrapolate or round beyond one decimal. If a section is null or empty, do not mention it.
- "baseline" means the average of the same weekday over the prior four weeks; say "vs the same weekday" or "vs a typical ${facts.weekday}". Week figures compare the last 7 days with the 7 before.
- Lead with the biggest movement. Movements under 8% in revenue, 10% in conversion or 15% in CAC are "steady" — say so briefly rather than inventing a story.
- Explain revenue changes through the decomposition (traffic, conversion, order value) and name where it concentrated (device, channel, platform) only when FACTS show it.
- CAC: the platform rows are estimates (platform-reported purchases × first-time share) — compare each to its own prior week, never platform against platform; blended is exact.
- Product momentum: a product whose shareYesterday is well above its share28d is worth a sentence; include its revenue.
- FACTS.decisions holds the seven operating questions already answered by rule (verdict + reason). Lead with the verdicts that are not "fine"/"hold" — scale, cut, investigate — quoting their reasons' numbers; the recommendation must agree with the decisions (never recommend scaling what the rules say to hold). When everything is fine or hold, say so in one line and spend the words on what moved.
- Plain language a founder reads in 30 seconds. No hedging, no "it appears". Submit with the write_brief tool.`;
  const res = await client.messages.create({
    model: 'claude-opus-4-8', max_tokens: 1500, thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
    system, tools: [tool], tool_choice: { type: 'tool', name: 'write_brief' },
    messages: [{ role: 'user', content: `FACTS:\n${JSON.stringify(facts)}` }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const out = (tu?.input || {}) as { headline?: string; summary?: string; drivers?: string[]; recommendation?: string; watch?: string };
  if (!out.headline || !out.summary) throw new Error('The brief came back empty');
  return { headline: String(out.headline).slice(0, 160), summary: String(out.summary), drivers: (out.drivers || []).map(String).slice(0, 4), recommendation: String(out.recommendation || ''), ...(out.watch ? { watch: String(out.watch) } : {}) };
}

/** Build (or return the cached) brief for a date; `force` rebuilds. */
export async function getBrief(date: string, force = false): Promise<Brief> {
  if (!force) { const c = await getCachedBrief(date); if (c) return c; }
  const facts = await computeFacts(date);
  const words = await writeBrief(facts);
  const brief: Brief = { date, generatedAt: new Date().toISOString(), ...words, facts };
  if (isChatStoreConfigured()) { try { await setKV(cacheKey(date), JSON.stringify(brief)); } catch { /* still return it */ } }
  return brief;
}

export function yesterdayPst(): string { return addDays(todayPst(), -1); }

/** Plain-text version for Cleo. */
export function briefText(b: Brief): string {
  const f = b.facts;
  const d = (x: Delta, unit = '') => `${unit}${x.current.toLocaleString()} vs ${unit}${x.baseline.toLocaleString()} (${x.pct == null ? 'n/a' : `${x.pct > 0 ? '+' : ''}${x.pct}%`})`;
  const verdicts = f.decisions.map(x => `- ${x.question} → ${x.verdict.toUpperCase()}${x.subject ? ` (${x.subject})` : ''}: ${x.reason} [rule: ${x.rule}]`).join('\n');
  return `MORNING BRIEF for ${f.date} (${f.weekday}) — generated ${b.generatedAt}
OPERATING DECISIONS (by rule, against the dashboard's own targets):
${verdicts}

${b.headline}
${b.summary}
${b.drivers.map(x => `- ${x}`).join('\n')}
Recommendation: ${b.recommendation}${b.watch ? `\nWatch: ${b.watch}` : ''}

FACTS (yesterday vs same-weekday average of the prior 4 weeks): revenue ${d(f.revenue, '$')} · orders ${d(f.orders)} · AOV ${d(f.aov, '$')} · sessions ${d(f.sessions)} · CVR ${d(f.cvr)}%${f.decomposition ? ` · revenue change from traffic ${f.decomposition.fromSessions}pp, conversion ${f.decomposition.fromCvr}pp, order value ${f.decomposition.fromAov}pp` : ''}
Devices: ${f.devices.map(x => `${x.device} CVR ${d(x.cvr)}%`).join(' · ') || 'n/a'}
Spend yesterday: ${d(f.spendYesterday.total, '$')} — ${f.spendYesterday.byPlatform.map(p => `${p.platform} ${d(p.spend, '$')}`).join(' · ')}
Week vs prior week: revenue ${d(f.weekRevenue, '$')} · MER ${d(f.weekMer)}x · spend ${d(f.weekAds.spend, '$')} · purchases ${d(f.weekAds.purchases)}${f.cac ? ` · blended nCAC ${d(f.cac.blended, '$')} · ${f.cac.byPlatform.map(p => `${p.platform} nCAC ${d(p.ncac, '$')}`).join(' · ')}` : ''}
${f.googleBrand ? `Google brand: spend ${d(f.googleBrand.brand.spend, '$')} · CPA ${d(f.googleBrand.brand.cpa, '$')} | non-brand: spend ${d(f.googleBrand.nonBrand.spend, '$')} · CPA ${d(f.googleBrand.nonBrand.cpa, '$')}` : ''}
Products yesterday: ${f.products.slice(0, 5).map(p => `${p.title} $${p.revenue.toLocaleString()} (${p.shareYesterday}% of revenue vs ${p.share28d}% 28-day share)`).join(' · ')}`;
}
