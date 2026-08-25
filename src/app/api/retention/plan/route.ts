import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getKV, setKV } from '@/src/lib/chatStore';
import { getEvents } from '@/src/lib/calendarStore';
import { klaviyoConfigured, fetchRetentionData } from '@/src/lib/klaviyo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The retention plan can exceed a sheet cell — chunk it across KV keys.
const CHUNK = 40000;
async function saveLarge(name: string, value: string): Promise<void> {
  const parts = Math.ceil(value.length / CHUNK) || 1;
  await setKV(`${name}_parts`, String(parts));
  for (let i = 0; i < parts; i++) {
    await setKV(`${name}_${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
}
async function loadLarge(name: string): Promise<string | null> {
  const parts = Number(await getKV(`${name}_parts`)) || 0;
  if (!parts) return null;
  let out = '';
  for (let i = 0; i < parts; i++) out += (await getKV(`${name}_${i}`)) || '';
  return out || null;
}

export async function GET() {
  try {
    const raw = await loadLarge('retention_plan');
    if (!raw) return NextResponse.json({ plan: null });
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ plan: null });
  }
}

export async function POST(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can regenerate the plan' }, { status: 403 });
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Anthropic not configured' }, { status: 500 });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // Context: upcoming launches/promos, and what's been performing in Klaviyo.
  const events = await getEvents().catch(() => []);
  const upcoming = events
    .filter(e => e.date >= today || (e.endDate && e.endDate >= today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 25)
    .map(e => `${e.date}${e.endDate ? `→${e.endDate}` : ''}: ${e.title} (${e.type}${e.channel ? `, ${e.channel}` : ''}${e.description ? ` — ${e.description}` : ''})`)
    .join('\n');

  let perf = 'Klaviyo not connected yet — plan from best practices alone.';
  if (klaviyoConfigured()) {
    try {
      const d = await fetchRetentionData();
      perf = `Last 30 days — Email: $${d.overview.email.revenue.toLocaleString()} from ${d.overview.email.campaigns} campaigns (${d.overview.email.avgOpenRate}% open, ${d.overview.email.avgClickRate}% click). SMS: $${d.overview.sms.revenue.toLocaleString()} from ${d.overview.sms.campaigns} campaigns.
Recent campaigns (name · channel · open% · click% · revenue):
${d.recent.slice(0, 20).map(c => `${c.name} · ${c.channel} · ${c.openRate ?? '?'}% · ${c.clickRate ?? '?'}% · $${(c.revenue ?? 0).toLocaleString()}`).join('\n')}
Already scheduled/drafted (do NOT duplicate these): ${d.scheduled.map(c => `${c.name} (${c.sendTime?.slice(0, 10) || 'draft'})`).join(' · ') || 'none'}`;
    } catch { /* fall back to best practices */ }
  }

  const prompt = `You are Cleo, Rocknot's retention marketing strategist. Rocknot is a DTC jewelry/handbag brand (pastel, feminine, playful; founder Orly is the face of the brand; AOV ~$170).

Today is ${today}. Build the next 30 days of the Email/SMS campaign calendar with COMPLETE briefs a designer can execute without asking questions.

UPCOMING LAUNCHES & PROMOTIONS (build the calendar around these):
${upcoming || 'None on the calendar — use best-practice cadence.'}

RECENT PERFORMANCE:
${perf}

Rules:
- 2-4 emails/week + 1-2 SMS/week max; SMS only for high-urgency moments (launch day, sale ending, back in stock).
- Mix revenue campaigns with pure-value retention sends (styling tips, founder story, UGC roundups) — best practice is ~1 value send per 2 sales sends.
- Every launch on the calendar gets a tease → launch → last-chance arc.
- Write actual copy, not placeholders: 3 subject line options, preview text, hero headline, body copy (2-3 short paragraphs max), CTA button text.
- Design brief must name the exact layout and assets ("hero: founder wearing X on pastel pink, product grid of 3 below") using existing product/UGC photography only.

Return ONLY valid JSON, no markdown fences:
{"monthOverview": "2-3 sentence strategy summary",
 "campaigns": [{"date": "YYYY-MM-DD", "channel": "Email"|"SMS", "title": "internal name", "type": "Launch|Promo|Value|Winback|Back in stock|Tease", "audience": "segment", "goal": "one line", "subjectLines": ["a","b","c"], "previewText": "...", "heroHeadline": "...", "bodyCopy": "...", "cta": "...", "designBrief": "...", "bestPractice": "why this send, one line"}]}
For SMS, subjectLines holds the 2-3 message variants (with emoji, under 160 chars) and design fields can be short.`;

  try {
    const msg = await client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 20000,
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage();
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
    const jsonStr = text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(jsonStr.slice(jsonStr.indexOf('{')));
    const payload = { plan: parsed, generatedAt: new Date().toISOString() };
    await saveLarge('retention_plan', JSON.stringify(payload));
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
