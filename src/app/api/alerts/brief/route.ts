import { NextRequest, NextResponse } from 'next/server';
import { getClient , effectiveGoals } from '@/src/lib/client';
import { getGoals } from '@/src/lib/chatStore';
import { isLiveOverviewSource } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily morning brief → Slack. Triggered by Vercel Cron (vercel.json) with
// Authorization: Bearer <CRON_SECRET>; admins can test with ?test=1.
// Posts yesterday's scorecard + month-to-date pacing vs the month's goal so
// the operator sees every client's state without opening a dashboard.
// If metrics can't be loaded even after retries, a short failure notice is
// posted INSTEAD of silence — a missing brief must never be ambiguous.
// Webhook: SLACK_ALERTS_WEBHOOK_URL (falls back to SLACK_RESTOCK_WEBHOOK_URL).

interface Metrics {
  totalRevenue: number; netSales?: number; totalOrders: number; aov: number;
  totalAdSpend: number; netAdSpend?: number; adCreditApplied?: number;
  mer?: number; newCustomers?: number;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtK = (n: number) => (n >= 10000 ? `$${Math.round(n / 1000)}K` : fmt(n));

// Early-morning queries hit cold caches and rate limits — retry before
// declaring failure (3 attempts, spaced out).
async function getMetrics(origin: string, headers: HeadersInit, qs: string): Promise<Metrics | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 8000));
    try {
      const r = await fetch(`${origin}/api/windsor?${qs}`, { cache: 'no-store', headers });
      const d = await r.json();
      if (isLiveOverviewSource(d?.source) && d.metrics) return d.metrics as Metrics;
    } catch { /* retry */ }
  }
  return null;
}

async function postSlack(webhook: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  const client = getClient();
  const webhook = (process.env.SLACK_ALERTS_WEBHOOK_URL || process.env.SLACK_RESTOCK_WEBHOOK_URL || '').trim();
  if (!webhook) return NextResponse.json({ error: 'Set SLACK_ALERTS_WEBHOOK_URL in Vercel.' }, { status: 500 });

  const fwd = { cookie: req.headers.get('cookie') || '', authorization: req.headers.get('authorization') || '' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  const prettyDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });

  const [yd, mtd, goals] = await Promise.all([
    getMetrics(req.nextUrl.origin, fwd, 'tf=yesterday'),
    getMetrics(req.nextUrl.origin, fwd, 'tf=mtd'),
    getGoals().catch(() => []),
  ]);

  if (!yd && !mtd) {
    // Loud failure beats a silently missing brief.
    await postSlack(webhook, {
      text: `⚠️ ${client.name}: morning brief couldn't load metrics after 3 tries (data source slow or down). Check the dashboard directly — https://${req.nextUrl.host}/dashboard?tf=mtd`,
    });
    return NextResponse.json({ error: 'Metrics unavailable — failure notice posted.' }, { status: 502 });
  }

  const monthGoal = goals.find(g => g.month === today.slice(0, 7))?.revenueGoal || 0;
  const merGoal = effectiveGoals(client).targetMer;
  const cacTarget = effectiveGoals(client).targetCac;

  // Block Kit layout — compact, scannable on a phone.
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: `🌅 ${client.name} · ${prettyDate}`, emoji: true } },
  ];

  if (yd) {
    const net = yd.netSales ?? yd.totalRevenue;
    const spend = yd.netAdSpend ?? yd.totalAdSpend;
    const mer = yd.mer ?? (spend > 0 ? net / spend : 0);
    const cac = yd.newCustomers ? spend / yd.newCustomers : 0;
    const merMark = spend > 0 ? (mer >= merGoal ? ' ✅' : ' ⚠️') : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Yesterday*  ${fmt(net)} net · ${yd.totalOrders} orders · AOV ${fmt(yd.aov)}\n` +
          (spend > 0
            ? `MER *${mer.toFixed(2)}x*${merMark} (goal ${merGoal}x)  ·  Spend ${fmt(spend)}${cac > 0 ? `  ·  CAC ${fmt(cac)} ${cac <= cacTarget ? '✅' : '⚠️'}` : ''}`
            : '_No ad spend recorded yesterday._'),
      },
    });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Yesterday: metrics unavailable this morning._' } });
  }

  if (mtd) {
    const net = mtd.netSales ?? mtd.totalRevenue;
    const spend = mtd.netAdSpend ?? mtd.totalAdSpend;
    const mer = mtd.mer ?? (spend > 0 ? net / spend : 0);
    const cac = mtd.newCustomers ? spend / mtd.newCustomers : 0;
    let line = `*Month*  ${fmtK(net)} net · ${mtd.totalOrders} orders` + (spend > 0 ? ` · MER *${mer.toFixed(2)}x*${cac > 0 ? ` · CAC ${fmt(cac)}` : ''}` : '');
    if (monthGoal > 0) {
      const elapsed = Math.max(1, dayOfMonth - 1);
      const expected = (monthGoal / daysInMonth) * elapsed;
      const pace = expected > 0 ? (net / expected) * 100 : 0;
      const projected = (net / elapsed) * daysInMonth;
      line += `\n*${pace.toFixed(0)}%* of ${fmtK(monthGoal)} pace ${pace >= 100 ? '✅' : pace >= 90 ? '🟡' : '🔴'} · projecting ${fmtK(projected)}`;
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: line } });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `<https://${req.nextUrl.host}/dashboard?tf=mtd|Open ${client.name} dashboard →>` }],
  });

  const ok = await postSlack(webhook, { text: `🌅 ${client.name} — morning brief · ${prettyDate}`, blocks });
  if (!ok) return NextResponse.json({ error: 'Slack rejected the post' }, { status: 502 });
  return NextResponse.json({ ok: true, posted: true });
}
