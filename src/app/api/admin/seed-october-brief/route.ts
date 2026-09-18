import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getClientId } from '@/src/lib/client';
import { getEvents, saveEvents, TYPE_COLORS, MarketingEvent, EventType } from '@/src/lib/calendarStore';
import { getGoals, saveGoals, isChatStoreConfigured } from '@/src/lib/chatStore';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// One-time load of Kailee P's October 2026 marketing brief into the
// dashboard's stores: calendar events, the October revenue goal, and the
// brand guidelines the creative briefs are generated from. Admin-only,
// Kailee P only, idempotent (skips anything already present; never
// overwrites existing guidelines). Safe to remove once run.
//   GET /api/admin/seed-october-brief

const EVENTS: { title: string; date: string; endDate?: string; type: EventType; description: string }[] = [
  {
    title: 'Campaign: "Your Bridal Shoes Options Start Here"',
    date: '2026-10-01',
    endDate: '2026-10-31',
    type: 'content',
    description: 'October 2026 campaign. Primary: late-stage brides (wedding in 30–90 days, harvesting). Secondary: early-stage brides (seeding, capture email). Revenue goal $379,259 (paid $227,555 · email $94,815 · organic/direct $56,889) · 2,528 orders · AOV $150 · CVR 1.85% · blended MER 5–6 · CPA < $27–30 · 2,022 new / 506 returning customers.',
  },
  {
    title: 'Second Pair Program page launch',
    date: '2026-10-01',
    type: 'launch',
    description: 'October launch — exact date TBD. "Your Second Pair, Sorted": a ceremony pair + a reception pair. Pairings to show: stiletto + flat pump, block heel + bridal sneaker, statement heel + classic flat.',
  },
  {
    title: 'Product Customizer page launch — Second Look, Second Ankle Strap',
    date: '2026-10-01',
    type: 'launch',
    description: 'October launch — exact date TBD. Interchangeable ankle straps (plain, pearl or sparkle): "Change the strap, change the look." Ceremony classic, reception statement.',
  },
  {
    title: 'October spotlight: low block heels — Leila, Adele, Dana, Yvonne',
    date: '2026-10-01',
    endDate: '2026-10-31',
    type: 'content',
    description: 'Product of the month (20% of content). Closed toes + low block heels for cooler fall celebrations. Dana & Yvonne also for junior bridesmaids. Evergreen best sellers (80%): Bella, Twila Lace, Jackie, Abby, Faith, Sally.',
  },
];

const OCTOBER_GOAL = { month: '2026-10', revenueGoal: 379_259, adBudget: 69_000 }; // budget = revenue ÷ 5.5 (midpoint of the 5–6 MER target)

const GUIDELINES = `KAILEE P — BRAND & OCTOBER 2026 BRIEF
(Source: October 2026 marketing brief, "Bridal and Women's Shoes")

POSITIONING
Timeless styles. Elegant comfort for the full wedding day. Every bride, every look.
2026 goal: position Kailee P as the trusted go-to brand for timeless bridal shoes that match every wedding look, with proven all-day comfort.
Two engines: Seeding (create demand — educate, build trust, stay top of mind, capture emails so brides start their journey with KP) and Harvesting (conversion, AOV, retargeting incl. upsell of a 2nd pair, paid retargeting, email education).

AUDIENCE
- Primary — late-stage bride (harvesting): high purchase intent, actively searching, wedding within 30–90 days.
- Secondary — early-stage bride (seeding): recently engaged, building the vision, pinning, exploring. Goal: capture email and be top of mind before purchase intent activates.

OCTOBER 2026 CAMPAIGN: "Your Bridal Shoes Options Start Here"
Launching: Second Pair Program page; Second Look, Second Ankle Strap (Product Customizer page).
Objective: acquire and convert high-intent brides early in their decision journey while building a qualified owned-audience pipeline for peak bridal season.
Targets: revenue $379,259 (paid $227,555 · email $94,815 · organic/direct $56,889) · CVR 1.85% · AOV $150 · 2,528 orders · CPA < $27–30 · blended MER 5–6 · 2,022 new / 506 returning customers · 136,673 sessions (82,003 paid · 54,670 organic/direct).

CHANNEL ROLES
- Google Ads: primary paid conversion — scale to validate 6x+ ROAS (ROAS ≥ 6x, CPA < $30).
- Meta Ads: retargeting + late-stage capture; validate the efficiency floor.
- TikTok: primary discovery engine — top-of-funnel awareness (reach, video views, link clicks).
- Instagram: trust-building, mid-funnel nurture (saves, profile visits, DMs, link clicks).
- Pinterest (organic + ads): demand creation and long-tail pipeline feeding Google and Meta (outbound clicks, sessions, 1% CTR).
- Email: nurture + conversion of captured leads, reactivation — $85,061 (~20% of revenue).
Awareness KPIs: reach, saves (key), shares (key), website sessions, email signups. Organic/branded/direct traffic +25% MoM.

ART DIRECTION — THE 80/20 RULE
No new styles each month, so each month puts different products in the spotlight. 80% of content pushes EVERGREEN best sellers; 20% pushes the product/collection of the month. Every department (social, ads, Pinterest, newsletter) works from the same assets so the brand looks and sounds like one brand.
Visual direction: soft, airy, editorial. Ivory and blush lace, pearl and floral appliqués, tulle and veiling, dried florals and wedding stationery as props, flat-lays and gentle daylight. Landing-page tone: "The bridal silhouette made for the season." Pale blue accents (something blue) welcome.

THIS MONTH'S PRODUCT HIGHLIGHT (October 2026)
Low block heels: LEILA, ADELE, DANA & YVONNE (Dana & Yvonne also for junior bridesmaids).
Evergreen best sellers: Bella, Twila Lace, Jackie, Abby, Faith, Sally.
Messages to push: (1) Low heels and closed toes for fall; (2) Product Customizer — interchangeable ankle straps; (3) Second Pair Program.

MESSAGING PILLARS
Top funnel (awareness & education)
- Fall calls for a new kind of bridal heel: as temperatures drop, closed-toe silhouettes take center stage. "The bridal silhouette made for the season." "Cooler days. Timeless bridal style."
- One shoe, two bridal moments: bridal shoes can transform with the bride's second look. "Your dress isn't the only thing that can have a second look." "Ceremony elegance. The reception sparkle." "One pair, styled two ways."
- One wedding, two shoe moments: different parts of the day call for different shoes. "Why choose one when your wedding has more than one moment?" "Walk down the aisle. Dance into the night." "From 'I do' to the dance floor."

Middle funnel
- More coverage, more comfort, still bridal: closed toes + low block heels for cooler fall celebrations. "A little more coverage for cooler celebrations." "Low heels. Closed toes. Fall-ready comfort."
- Change the strap, change the look: interchangeable ankle straps transform the shoe in seconds. "Classic for the ceremony. Statement for the reception." "Plain, pearl or sparkle: make the look yours." "A simple switch."
- The perfect pairing — "Different moments call for different shoes": stiletto + flat pump (height for the aisle, ease for the evening); block heel + bridal sneaker (elegance for the ceremony, comfort for the dance floor); statement heel + classic flat (make an entrance, stay for the last dance). "Your wedding day changes pace. Your shoes can too." "The heels you dreamed of. The comfort you'll be glad you planned for."

Bottom funnel
- "Your fall wedding heel, found." Shop elegant closed-toe low block heels designed for the season. "Fall-ready bridal shoes without the towering heel." "Find your perfect closed-toe bridal heel."
- "Your second look starts here." Make adding a second ankle strap an easy upgrade. "Two looks. One pair." "Add a little sparkle for the reception." "One pair, more ways to wear."
- "Your second pair, sorted." Complete the wedding wardrobe with a ceremony + reception pair. "Don't choose between the look and the comfort. Have both." "Make your second look as special as your first."

DELIVERABLES (October)
UGC / real-bride pieces: 15–20. RMS: 12 + 8 (Michelle). TikTok freelancer: 40. Hooks to test on TikTok/IG Reels.
`;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function GET() {
  if (getClientId() !== 'kaileep') {
    return NextResponse.json({ error: 'This seed is for the Kailee P dashboard only' }, { status: 404 });
  }
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    }
  }
  const out: Record<string, unknown> = {};

  // 1. Calendar events (skip titles already present).
  try {
    const events = await getEvents();
    const existing = new Set(events.map(e => norm(e.title)));
    const added: string[] = [];
    const skipped: string[] = [];
    for (const l of EVENTS) {
      if (existing.has(norm(l.title))) { skipped.push(l.title); continue; }
      const ev: MarketingEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: l.title,
        date: l.date,
        ...(l.endDate ? { endDate: l.endDate } : {}),
        type: l.type,
        status: 'planned',
        description: l.description,
        color: TYPE_COLORS[l.type],
      };
      events.push(ev);
      existing.add(norm(l.title));
      added.push(l.title);
    }
    if (added.length) await saveEvents(events);
    out.calendar = { added, skipped };
  } catch (e: unknown) { out.calendar = { error: String(e instanceof Error ? e.message : e) }; }

  // 2. October goal (only if no October 2026 goal exists yet).
  try {
    if (!isChatStoreConfigured()) {
      out.goal = { error: 'Goal storage not configured' };
    } else {
      const goals = await getGoals();
      if (goals.some(g => g.month === OCTOBER_GOAL.month)) {
        out.goal = { skipped: 'October 2026 goal already set', current: goals.find(g => g.month === OCTOBER_GOAL.month) };
      } else {
        goals.push({ ...OCTOBER_GOAL, pinned: false });
        await saveGoals(goals);
        out.goal = { added: OCTOBER_GOAL, note: 'adBudget = revenue goal ÷ 5.5 (midpoint of the 5–6 MER target); edit on the Goals page' };
      }
    }
  } catch (e: unknown) { out.goal = { error: String(e instanceof Error ? e.message : e) }; }

  // 3. Brand guidelines (only if empty — never overwrite what an admin pasted).
  try {
    const current = (await loadDoc('brand_guidelines')) || '';
    if (current.trim()) {
      out.guidelines = { skipped: 'guidelines already present', currentLength: current.length };
    } else {
      await saveDoc('brand_guidelines', GUIDELINES);
      out.guidelines = { added: true, length: GUIDELINES.length };
    }
  } catch (e: unknown) { out.guidelines = { error: String(e instanceof Error ? e.message : e) }; }

  return NextResponse.json(out);
}
