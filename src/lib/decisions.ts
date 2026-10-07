// The operating framework: seven standing questions an operator asks every
// morning, each answered by a rule against the dashboard's own targets
// (profile goals: MER / ROAS / CAC targets; Goals tab: this month's revenue
// goal and ad budget; finance: gross margin). Verdicts are deterministic —
// Cleo narrates them, she does not decide them.
import type { BriefFacts, Delta } from '@/src/lib/brief';
import { getClient } from '@/src/lib/client';

export type Verdict = 'scale' | 'hold' | 'cut' | 'investigate' | 'fine' | 'unknown';
export interface Decision {
  key: 'scale' | 'cut' | 'cac' | 'hidden_new' | 'meta_vs_site' | 'product' | 'profit';
  question: string;
  verdict: Verdict;
  /** What the verdict is about (a platform, a product). */
  subject?: string;
  /** One sentence, numbers included, that an operator can act on. */
  reason: string;
  /** The rule, stated, so the operator can disagree with it. */
  rule: string;
}

export interface DecisionInputs {
  facts: BriefFacts;
  weekRevenue: Delta;          // last 7 days net revenue vs prior 7
  weekMer: Delta;              // weekRevenue ÷ week spend
  mtd?: { spend: number; adBudget: number | null; revenue: number; revenueGoal: number | null; dayOfMonth: number; daysInMonth: number } | null;
}

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtPct = (p: number | null) => (p == null ? 'n/a' : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`);

export function evaluateDecisions(inp: DecisionInputs): Decision[] {
  const { facts: f, weekRevenue, weekMer, mtd } = inp;
  const g = getClient().goals;
  const marginPct = getClient().finance.grossMarginPct;
  const out: Decision[] = [];
  const totalWeekSpend = f.weekAds.spend.current;
  const share = (spend: number) => (totalWeekSpend > 0 ? spend / totalWeekSpend : 0);
  const cvrSteady = f.cvr.pct == null || f.cvr.pct > -10;

  // 1. Do we scale? — a material platform beating the CAC target with ROAS at
  //    goal, while blended MER is at goal and conversion is holding.
  {
    const candidates = (f.cac?.byPlatform || []).filter(p => {
      const ads = f.weekAds.byPlatform.find(x => x.platform === p.platform);
      return ads && share(ads.spend.current) >= 0.1 && p.ncac.current > 0 && p.ncac.current <= g.targetCac && ads.roas.current >= g.targetRoas;
    });
    const merOk = weekMer.current >= g.targetMer;
    if (candidates.length && merOk && cvrSteady) {
      const best = candidates.sort((a, b) => a.ncac.current - b.ncac.current)[0];
      out.push({ key: 'scale', question: 'Do we scale?', verdict: 'scale', subject: best.platform, rule: `Platform nCAC ≤ $${g.targetCac} target, ROAS ≥ ${g.targetRoas}x, 7-day MER ≥ ${g.targetMer}x, conversion not down >10%`,
        reason: `${best.platform} is acquiring at ${fmt$(best.ncac.current)} per new customer (target $${g.targetCac}) with MER at ${weekMer.current.toFixed(2)}x — room to add 10–15% budget while watching CAC daily.` });
    } else {
      const why = !merOk ? `7-day MER is ${weekMer.current.toFixed(2)}x against a ${g.targetMer}x goal` : !cvrSteady ? `conversion is down ${fmtPct(f.cvr.pct)} vs a typical ${f.weekday}` : `no platform is under the $${g.targetCac} CAC target with ROAS at ${g.targetRoas}x`;
      out.push({ key: 'scale', question: 'Do we scale?', verdict: 'hold', rule: `Scale only when a platform's nCAC ≤ $${g.targetCac}, its ROAS ≥ ${g.targetRoas}x, 7-day MER ≥ ${g.targetMer}x and conversion is steady`, reason: `Hold: ${why}.` });
    }
  }

  // 2. Do we cut? — a material platform 50%+ over the CAC target two weeks
  //    running, or spending more for flat purchases.
  {
    const cuts = (f.cac?.byPlatform || []).filter(p => {
      const ads = f.weekAds.byPlatform.find(x => x.platform === p.platform);
      if (!ads || share(ads.spend.current) < 0.1) return false;
      const overTwoWeeks = p.ncac.current > g.targetCac * 1.5 && p.ncac.baseline > g.targetCac * 1.5;
      const spendUpFlatBuys = (ads.spend.pct ?? 0) >= 15 && (ads.purchases.pct ?? 0) <= 0;
      return overTwoWeeks || spendUpFlatBuys;
    });
    if (cuts.length) {
      const worst = cuts.sort((a, b) => b.ncac.current - a.ncac.current)[0];
      const ads = f.weekAds.byPlatform.find(x => x.platform === worst.platform)!;
      out.push({ key: 'cut', question: 'Do we cut spend?', verdict: 'cut', subject: worst.platform, rule: `Trim when a platform with ≥10% of spend runs nCAC > 1.5× target two weeks running, or spend is up ≥15% with purchases flat`,
        reason: `${worst.platform}: nCAC ${fmt$(worst.ncac.current)} this week and ${fmt$(worst.ncac.baseline)} last week against a $${g.targetCac} target, on ${fmt$(ads.spend.current)} spend (${fmtPct(ads.spend.pct)} WoW). Trim 15–20% and re-check in a week; keep enough volume to read results.` });
    } else {
      out.push({ key: 'cut', question: 'Do we cut spend?', verdict: 'fine', rule: `Trim when a platform with ≥10% of spend runs nCAC > 1.5× target two weeks running, or spend is up ≥15% with purchases flat`, reason: 'No cut warranted: no material platform is far over target two weeks running.' });
    }
  }

  // 3. Is CAC really bad? — judged against first-order margin, not a fixed number.
  {
    const cac = f.cac?.blended.current ?? 0;
    const aov = f.aov.current;
    if (cac > 0 && aov > 0 && marginPct != null) {
      const firstOrderMargin = aov * (marginPct / 100);
      const ratio = cac / firstOrderMargin;
      const verdict: Verdict = ratio <= 1 ? 'fine' : ratio <= 1.5 ? 'hold' : 'investigate';
      out.push({ key: 'cac', question: 'Is CAC really bad?', verdict, rule: `Blended nCAC vs first-order margin (AOV × ${marginPct}% gross margin); ≤1.0× pays back on the first order, ≤1.5× needs one repeat, above that needs real retention`,
        reason: ratio <= 1
          ? `No. Blended nCAC is ${fmt$(cac)} against a ${fmt$(firstOrderMargin)} first-order margin — new customers pay back on their first order (${(ratio * 100).toFixed(0)}% of margin).`
          : ratio <= 1.5
          ? `Watch it. Blended nCAC ${fmt$(cac)} is ${(ratio * 100).toFixed(0)}% of the ${fmt$(firstOrderMargin)} first-order margin — payback needs roughly one repeat purchase.`
          : `Yes, on current margins. Blended nCAC ${fmt$(cac)} is ${ratio.toFixed(1)}× the ${fmt$(firstOrderMargin)} first-order margin; it only works if repeat revenue covers the gap.` });
    } else {
      out.push({ key: 'cac', question: 'Is CAC really bad?', verdict: 'unknown', rule: 'Blended nCAC vs first-order margin', reason: 'Not enough inputs this week (needs blended nCAC, AOV and a gross margin on the profile).' });
    }
  }

  // 4. Are returning customers hiding a new-customer problem?
  {
    const newDelta = f.cac?.blendedNewCustomers;
    if (newDelta && newDelta.baseline > 0) {
      const hidden = (weekRevenue.pct ?? 0) >= -5 && (newDelta.pct ?? 0) <= -10;
      out.push({ key: 'hidden_new', question: 'Are returning customers hiding a new-customer problem?', verdict: hidden ? 'investigate' : 'fine', rule: 'Revenue within −5% WoW while first-time buyers fall ≥10% WoW',
        reason: hidden
          ? `Yes. Revenue is ${fmtPct(weekRevenue.pct)} WoW but first-time buyers fell ${fmtPct(newDelta.pct)} (${newDelta.current} vs ${newDelta.baseline}). Returning customers are carrying the week; new-customer acquisition is weakening underneath.`
          : `No. First-time buyers ${fmtPct(newDelta.pct)} WoW (${newDelta.current} vs ${newDelta.baseline}) alongside revenue ${fmtPct(weekRevenue.pct)}.` });
    }
  }

  // 5. Is Meta failing or is the website failing?
  {
    const meta = f.weekAds.byPlatform.find(p => /meta|facebook/i.test(p.platform));
    if (meta && meta.clicks) {
      const clicksDown = (meta.clicks.pct ?? 0) <= -15;
      const buysDown = (meta.purchases.pct ?? 0) <= -15;
      const siteCvrDown = (f.cvr.pct ?? 0) <= -10;
      let verdict: Verdict = 'fine'; let reason = `Neither. Meta clicks ${fmtPct(meta.clicks.pct)} and purchases ${fmtPct(meta.purchases.pct)} WoW; site conversion ${fmtPct(f.cvr.pct)} vs a typical ${f.weekday}.`; let subject: string | undefined;
      if (clicksDown) { verdict = 'investigate'; subject = 'Meta'; reason = `Meta. Clicks fell ${fmtPct(meta.clicks.pct)} WoW on ${fmtPct(meta.spend.pct)} spend — delivery or creative fatigue, not the site. Refresh creative / check frequency before touching the website.`; }
      else if (buysDown && siteCvrDown) { verdict = 'investigate'; subject = 'Website'; reason = `The website. Meta clicks held (${fmtPct(meta.clicks.pct)}) but purchases fell ${fmtPct(meta.purchases.pct)} and site conversion is ${fmtPct(f.cvr.pct)}${f.devices.length ? ` — ${f.devices.map(d => `${d.device} CVR ${fmtPct(d.cvr.pct)}`).join(', ')}` : ''}. Check the site before blaming the ads.`; }
      else if (buysDown) { verdict = 'investigate'; subject = 'Meta'; reason = `Meta's audience, not the site. Clicks ${fmtPct(meta.clicks.pct)} but purchases ${fmtPct(meta.purchases.pct)} while site conversion is steady (${fmtPct(f.cvr.pct)}) — the traffic quality changed.`; }
      out.push({ key: 'meta_vs_site', question: 'Is Meta failing or is the website failing?', verdict, subject, rule: 'Clicks down ≥15% → Meta; clicks steady with purchases and site CVR down → website; clicks steady, purchases down, CVR steady → traffic quality', reason });
    }
  }

  // 6. What product should we push?
  {
    const pick = f.products.filter(p => p.share28d > 0 && p.shareYesterday >= p.share28d * 1.5 && p.shareYesterday >= 5).sort((a, b) => b.shareYesterday / b.share28d - a.shareYesterday / a.share28d)[0];
    if (pick) out.push({ key: 'product', question: 'What product should we push?', verdict: 'scale', subject: pick.title, rule: 'Share of revenue yesterday ≥ 1.5× its 28-day share and ≥ 5% of the day',
      reason: `${pick.title}: ${fmt$(pick.revenue)} yesterday, ${pick.shareYesterday}% of revenue against a ${pick.share28d}% 28-day share. Give it dedicated creative and prospecting budget; confirm stock first.` });
    else out.push({ key: 'product', question: 'What product should we push?', verdict: 'hold', rule: 'Share of revenue yesterday ≥ 1.5× its 28-day share and ≥ 5% of the day', reason: 'No product broke out of its usual share yesterday.' });
  }

  // 7. Are we actually profitable? — contribution after COGS and ad spend, with pace to goal.
  {
    // Net sales over the settled ad week = MER × spend (the Overview's MER basis).
    const weekNet = weekMer.current * f.weekAds.spend.current;
    if (marginPct != null && weekNet > 0) {
      const contrib = weekNet * (marginPct / 100) - f.weekAds.spend.current;
      const cm = (contrib / weekNet) * 100;
      const pace = mtd && mtd.revenueGoal ? ` MTD revenue ${fmt$(mtd.revenue)} vs ${fmt$(mtd.revenueGoal * (mtd.dayOfMonth / mtd.daysInMonth))} expected by day ${mtd.dayOfMonth} of a ${fmt$(mtd.revenueGoal)} goal.` : '';
      const budget = mtd && mtd.adBudget ? ` Ad spend ${fmt$(mtd.spend)} of a ${fmt$(mtd.adBudget)} budget (${((mtd.spend / mtd.adBudget) * 100).toFixed(0)}% used, ${((mtd.dayOfMonth / mtd.daysInMonth) * 100).toFixed(0)}% of the month gone).` : '';
      out.push({ key: 'profit', question: 'Are we actually profitable?', verdict: cm >= 20 ? 'fine' : cm >= 0 ? 'hold' : 'investigate', rule: `Contribution = net revenue × ${marginPct}% gross margin − ad spend (marketing overhead not yet connected)`,
        reason: `Week to ${f.adWeek.to}: ${fmt$(contrib)} contribution on ${fmt$(weekNet)} net sales (${cm.toFixed(0)}% after COGS and ${fmt$(f.weekAds.spend.current)} ad spend; MER ${weekMer.current.toFixed(2)}x vs ${g.targetMer}x goal).${pace}${budget} Fixed marketing costs are not in this number yet.` });
    } else {
      out.push({ key: 'profit', question: 'Are we actually profitable?', verdict: 'unknown', rule: 'Contribution after COGS and ad spend', reason: 'Needs a gross margin on the profile and a week of net sales.' });
    }
  }
  return out;
}
