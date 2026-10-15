import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/src/lib/client';
import { getGoals } from '@/src/lib/chatStore';
import { isLiveOverviewSource } from '@/src/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily morning brief → Slack. Triggered by Vercel Cron (vercel.json) with
// Authorization: Bearer <CRON_SECRET>; admins can test with ?test=1.
// Posts yesterday's scorecard + month-to-date pacing vs the month's goal so
// the operator sees every client's state without opening a dashboard.
// Webhook: SLACK_ALERTS_WEBHOOK_URL (falls back to SLACK_RESTOCK_WEBHOOK_URL).

interface Metrics {
  totalRevenue: number; netSales?: number; totalOrders: number; aov: number;
  totalAdSpend: number; netAdSpend?: number; adCreditApplied?: number;
  mer?: number; newCustomers?: number;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

async function getMetrics(origin: string, headers: HeadersInit, qs: string): Promise<Metrics | null> {
  try {
    const r = await fetch(`${origin}/api/windsor?${qs}`, { cache: 'no-store', headers });
    const d = await r.json();
    if (isLiveOverviewSource(d?.source) && d.metrics) return d.metrics as Metrics;
    return null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const client = getClient();
  const webhook = (process.env.SLACK_ALERTS_WEBHOOK_URL || process.env.SLACK_RESTOCK_WEBHOOK_URL || '').trim();
  if (!webhook) return NextResponse.json({ error: 'Set SLACK_ALERTS_WEBHOOK_URL in Vercel.' }, { status: 500 });

  const fwd = { cookie: req.headers.get('cookie') || '', authorization: req.headers.get('authorization') || '' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();

  const [yd, mtd, goals] = await Promise.all([
    getMetrics(req.nextUrl.origin, fwd, 'tf=yesterday'),
    getMetrics(req.nextUrl.origin, fwd, 'tf=mtd'),
    getGoals().catch(() => []),
  ]);
  if (!yd && !mtd) return NextResponse.json({ error: 'Metrics unavailable — nothing posted.' }, { status: 502 });

  const monthGoal = goals.find(g => g.month === today.slice(0, 7))?.revenueGoal || 0;
  const merGoal = client.goals.targetMer;
  const cacTarget = client.goals.targetCac;

  const lines: string[] = [`*🌅 ${client.name} — morning brief · ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })}*`];

  if (yd) {
    const net = yd.netSales ?? yd.totalRevenue;
    const spend = yd.netAdSpend ?? yd.totalAdSpend;
    const mer = yd.mer ?? (spend > 0 ? net / spend : 0);
    const cac = yd.newCustomers ? spend / yd.newCustomers : 0;
    lines.push(
      `*Yesterday:* ${fmt(yd.totalRevenue)} total · ${fmt(net)} net · ${yd.totalOrders} orders · AOV ${fmt(yd.aov)}`,
      `  Ads: ${fmt(spend)} net spend · MER ${mer.toFixed(2)}x ${mer >= merGoal ? '✅' : `⚠️ (goal ${merGoal}x)`}${cac > 0 ? ` · New-customer CAC ${fmt(cac)} ${cac <= cacTarget ? '✅' : `⚠️ (target $${cacTarget})`}` : ''}`
    );
  } else {
    lines.push('_Yesterday: metrics unavailable (query failed)._');
  }

  if (mtd) {
    const net = mtd.netSales ?? mtd.totalRevenue;
    const spend = mtd.netAdSpend ?? mtd.totalAdSpend;
    const mer = mtd.mer ?? (spend > 0 ? net / spend : 0);
    const cac = mtd.newCustomers ? spend / mtd.newCustomers : 0;
    let goalLine = '';
    if (monthGoal > 0) {
      // Yesterday was the last complete day — pace against elapsed complete days.
      const elapsed = Math.max(1, dayOfMonth - 1);
      const expected = (monthGoal / daysInMonth) * elapsed;
      const pace = expected > 0 ? (net / expected) * 100 : 0;
      const projected = (net / elapsed) * daysInMonth;
      goalLine = `  Goal ${fmt(monthGoal)}: *${pace.toFixed(0)}% of pace* ${pace >= 100 ? '✅' : pace >= 90 ? '🟡' : '🔴'} · projecting ${fmt(projected)} at current run-rate`;
    }
    lines.push(
      `*Month to date:* ${fmt(net)} net sales · ${mtd.totalOrders} orders · MER ${mer.toFixed(2)}x${cac > 0 ? ` · CAC ${fmt(cac)}` : ''}`,
      ...(goalLine ? [goalLine] : [])
    );
  }

  lines.push(`<https://${req.nextUrl.host}/dashboard?tf=mtd|Open dashboard →>`);

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!res.ok) return NextResponse.json({ error: `Slack rejected the post (${res.status})` }, { status: 502 });
  return NextResponse.json({ ok: true, posted: true });
}
