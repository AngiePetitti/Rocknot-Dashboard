import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { getClient } from '@/src/lib/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Cleo in Slack. Point the Slack app's Event Subscriptions at
//   https://<this deployment>/api/slack/events
// and @mention the bot (or DM it) with a question; the question is routed to
// the right client's Cleo (/api/insights/ask) and the answer posts in-thread.
//
// Env (on the HUB deployment — the one the Slack app points at):
//   SLACK_SIGNING_SECRET — app credentials page (verifies posts are Slack's)
//   SLACK_BOT_TOKEN      — xoxb-… (OAuth & Permissions, after adding scopes
//                          app_mentions:read, chat:write, im:history)
//   CRON_SECRET          — already set; lets this route call Cleo internally
//   PEER_DASHBOARDS      — optional JSON for multi-client routing:
//     [{"match":"kailee","name":"Kailee P","url":"https://kaileep-dashboard.vercel.app","secret":"<that project's CRON_SECRET>"}]
//     The hub's own client needs no entry. Questions naming a peer are
//     answered by THAT deployment's Cleo (its data, catalog, brand brief).

interface Peer { match: string; name: string; url: string; secret: string }

function verifySlack(req: NextRequest, raw: string): boolean {
  const secret = (process.env.SLACK_SIGNING_SECRET || '').trim();
  if (!secret) return false;
  const ts = req.headers.get('x-slack-request-timestamp') || '';
  const sig = req.headers.get('x-slack-signature') || '';
  if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const base = `v0:${ts}:${raw}`;
  const mine = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
  } catch { return false; }
}

function peers(): Peer[] {
  try {
    const parsed = JSON.parse(process.env.PEER_DASHBOARDS || '[]');
    return Array.isArray(parsed) ? parsed.filter(p => p?.match && p?.url && p?.secret) : [];
  } catch { return []; }
}

// Rough markdown → Slack mrkdwn (bold + headers; tables stay monospace-ish).
function toMrkdwn(md: string): string {
  return md
    .replace(/^#{1,4}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .slice(0, 11500);
}

async function postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || '').trim();
  if (!token) return;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false }),
  }).catch(() => {});
}

async function answer(question: string, channel: string, threadTs: string | undefined, origin: string): Promise<void> {
  const self = getClient();
  // Route to a peer when the question names one; otherwise this deployment.
  const lower = question.toLowerCase();
  const peer = peers().find(p => lower.includes(p.match.toLowerCase()));
  const targetUrl = peer ? peer.url : origin;
  const targetSecret = peer ? peer.secret : (process.env.CRON_SECRET || '').trim();
  const targetName = peer ? peer.name : self.name;

  await postMessage(channel, `💬 On it — asking ${targetName}'s data… (takes ~30–60s)`, threadTs);
  try {
    const res = await fetch(`${targetUrl}/api/insights/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${targetSecret}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
      signal: AbortSignal.timeout(280000),
    });
    const d = await res.json().catch(() => null);
    if (d?.answer) {
      await postMessage(channel, `*${targetName}* · ${toMrkdwn(String(d.answer))}`, threadTs);
    } else {
      await postMessage(channel, `⚠️ ${targetName}'s analyst couldn't answer: ${String(d?.error || `HTTP ${res.status}`).slice(0, 200)}`, threadTs);
    }
  } catch (e) {
    await postMessage(channel, `⚠️ Couldn't reach ${targetName}'s dashboard: ${String(e).slice(0, 150)}`, threadTs);
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  // Slack's one-time URL verification handshake.
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (!verifySlack(req, raw)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  // Slack retries on slow acks — process each delivery once.
  if (req.headers.get('x-slack-retry-num')) return NextResponse.json({ ok: true, deduped: true });

  const event = (body.event ?? {}) as Record<string, unknown>;
  const type = String(event.type || '');
  const isDm = type === 'message' && String(event.channel_type || '') === 'im';
  const isMention = type === 'app_mention';
  // Ignore bot echoes (including our own posts) and edits.
  if ((!isMention && !isDm) || event.bot_id || event.subtype) return NextResponse.json({ ok: true });

  const text = String(event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const channel = String(event.channel || '');
  const threadTs = String(event.thread_ts || event.ts || '') || undefined;
  if (!text || !channel) return NextResponse.json({ ok: true });

  // Ack within Slack's 3s window; answer in the background.
  waitUntil(answer(text, channel, threadTs, req.nextUrl.origin));
  return NextResponse.json({ ok: true });
}
