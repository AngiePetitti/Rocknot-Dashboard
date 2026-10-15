import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/src/lib/client';
import { getKV, setKV } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Intraday pacing watchdog → Slack. Runs every ~2h during business hours via
// Vercel Cron. Compares today-so-far revenue against the trailing 7 complete
// days' average scaled to the fraction of day elapsed, and today's MER
// against goal. Posts ONLY when something is off (quiet when healthy), max
// one alert per condition per day (KV cooldown).
// Webhook: SLACK_ALERTS_WEBHOOK_URL (falls back to SLACK_RESTOCK_WEBHOOK_URL).

interface Metrics {
  totalRevenue: number; netSales?: number; totalAdSpend: number; netAdSpend?: number;
  mer?: number; totalOrders: number;
  metaSpend?: number; googleSpend?: number; tiktokSpend?: number; snapchatSpend?: number; pinterestSpend?: number;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

async function getMetrics(origin: string, headers: HeadersInit, qs: string): Promise<Metrics | null> {
  try {
    const r = await fetch(`${origin}/api/windsor?${qs}`, { cache: 'no-store', headers });
    const d = await r.json();
    if ((d?.source === 'windsor_live' || d?.source === 'bigquery_live') && d.metrics) return d.metrics as Metrics;
    return null;
  } catch { return null; }
}

function addDays(ds: string, n: number): string {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const client = getClient();
  const webhook = (process.env.SLACK_ALERTS_WEBHOOK_URL || process.env.SLACK_RESTOCK_WEBHOOK_URL || '').trim();
  if (!webhook) return NextResponse.json({ error: 'Set SLACK_ALERTS_WEBHOOK_URL in Vercel.' }, { status: 500 });

  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const hourPT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now));
  const minutePT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', minute: 'numeric' }).format(now));
  const dayFrac = Math.min(1, (hourPT + minutePT / 60) / 24);
  // Too early in the day = too noisy; the cron schedule also gates this.
  if (dayFrac < 0.33 && !req.nextUrl.searchParams.get('test')) {
    return NextResponse.json({ ok: true, skipped: 'before 8am PT' });
  }

  const fwd = { cookie: req.headers.get('cookie') || '', authorization: req.headers.get('authorization') || '' };
  const [todayM, trailing] = await Promise.all([
    getMetrics(req.nextUrl.origin, fwd, 'tf=today'),
    getMetrics(req.nextUrl.origin, fwd, `tf=custom&date_from=${addDays(today, -7)}&date_to=${addDays(today, -1)}`),
  ]);
  if (!todayM || !trailing) return NextResponse.json({ ok: false, error: 'metrics unavailable' }, { status: 502 });

  const todayNet = todayM.netSales ?? todayM.totalRevenue;
  const avgDaily = (trailing.netSales ?? trailing.totalRevenue) / 7;
  const expectedByNow = avgDaily * dayFrac;
  const pace = expectedByNow > 0 ? (todayNet / expectedByNow) * 100 : 100;

  const spend = todayM.netAdSpend ?? todayM.totalAdSpend;
  const mer = todayM.mer ?? (spend > 0 ? todayNet / spend : 0);
  const merGoal = client.goals.targetMer;

  const alerts: Array<{ key: string; text: string }> = [];
  if (pace < 75 && avgDaily > 100) {
    alerts.push({
      key: 'revpace',
      text: `🔴 *${client.name}: revenue pacing ${pace.toFixed(0)}% of normal* — ${fmt(todayNet)} net by ${hourPT}:00 PT vs ${fmt(expectedByNow)} expected (trailing-7-day rhythm, avg day ${fmt(avgDaily)}).`,
    });
  }
  // MER check only once real money is in play for the day. This is the
  // throttle-spend signal, so it names where today's money is going.
  if (spend > 300 && mer < merGoal * 0.8) {
    const plat: Array<[string, number]> = [
      ['Meta', todayM.metaSpend ?? 0], ['Google', todayM.googleSpend ?? 0],
      ['TikTok', todayM.tiktokSpend ?? 0], ['Snap', todayM.snapchatSpend ?? 0],
      ['Pinterest', todayM.pinterestSpend ?? 0],
    ].filter(([, v]) => v > 0).sort((a, b) => (b[1] as number) - (a[1] as number)) as Array<[string, number]>;
    const mix = plat.map(([n, v]) => `${n} ${fmt(v)}`).join(' · ');
    alerts.push({
      key: 'mer',
      text: `🟠 *${client.name}: MER ${mer.toFixed(2)}x — below the throttle line (goal ${merGoal}x)* with ${fmt(spend)} net spend vs ${fmt(todayNet)} net sales so far today.${mix ? `\nSpend mix: ${mix}.` : ''} If this holds another check-in, pull the top spender back toward yesterday's level.`,
    });
  }

  if (!alerts.length) return NextResponse.json({ ok: true, healthy: true, pace: Math.round(pace), mer: Number(mer.toFixed(2)) });

  // Cooldowns: revenue pacing alerts once per day (it dips and recovers);
  // the MER/throttle alert may repeat after 5 quiet hours if still breached,
  // so a morning warning that went unhandled resurfaces in the afternoon.
  const sent: string[] = [];
  for (const a of alerts) {
    const kvKey = `pace_alert_${today}_${a.key}`;
    const already = await getKV(kvKey).catch(() => null);
    const cooldownOk = a.key === 'mer' && already
      ? Date.now() - Date.parse(already) > 5 * 3600 * 1000
      : !already;
    if (!cooldownOk && !req.nextUrl.searchParams.get('test')) continue;
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${a.text}\n<https://${req.nextUrl.host}/dashboard?tf=today|Open live view →>` }),
    });
    if (res.ok) {
      sent.push(a.key);
      await setKV(kvKey, new Date().toISOString()).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, sent, pace: Math.round(pace), mer: Number(mer.toFixed(2)) });
}
