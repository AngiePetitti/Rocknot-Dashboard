import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getKV, setKV } from '@/src/lib/chatStore';
import { getEvents } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHUNK = 40000;
async function saveLarge(name: string, value: string): Promise<void> {
  const parts = Math.ceil(value.length / CHUNK) || 1;
  await setKV(`${name}_parts`, String(parts));
  for (let i = 0; i < parts; i++) await setKV(`${name}_${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
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
    const raw = await loadLarge('creative_briefs');
    if (!raw) return NextResponse.json({ briefs: null });
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ briefs: null });
  }
}

export async function POST(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can regenerate briefs' }, { status: 403 });
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Anthropic not configured' }, { status: 500 });

  // Per-ad performance from our own creatives API (forward the session).
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get('cookie') || '';
  const cres = await fetch(`${origin}/api/windsor/creatives?tf=30d`, { headers: { cookie }, cache: 'no-store' });
  const cdata = await cres.json().catch(() => null);
  const creatives = (cdata?.creatives ?? []) as Array<{
    name: string; platform: string; campaign: string; spend: number; revenue: number;
    roas: number; ctr: number; conversions: number; costPerConversion: number;
  }>;
  if (!creatives.length) {
    return NextResponse.json({ error: 'No creative performance data available to base briefs on' }, { status: 502 });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const events = await getEvents().catch(() => []);
  const upcoming = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15)
    .map(e => `${e.date}: ${e.title} (${e.type})`).join('\n');

  const adLines = creatives.slice(0, 40).map(c =>
    `${c.name} [${c.platform}] — $${Math.round(c.spend)} spend · ${c.roas}x ROAS · ${c.ctr}% CTR · ${c.conversions} conv`
  ).join('\n');

  const prompt = `You are Cleo, Rocknot's creative strategist. Rocknot is a DTC jewelry/handbag brand (pastel, feminine, founder Orly is charismatic on camera; products: rhinestone straps, chain tops, bags, jewelry). Ad naming convention encodes the creative: Video_/Static_, product, format (Demo, Talking Head, Montage UGC, Founder Video, Product Showcase, Quote/Review), and landing page.

LAST 30 DAYS OF AD-LEVEL PERFORMANCE (name · spend · ROAS · CTR · conversions):
${adLines}

UPCOMING LAUNCHES (briefs should support these):
${upcoming || 'None scheduled.'}

TASK 1 — Format analysis: from the ad names + numbers, identify which creative FORMATS are winning and losing (video vs static, demo vs talking head vs UGC montage vs founder voice, product categories) and WHY, concretely referencing the data.

TASK 2 — Three sets of production-ready briefs (3-4 briefs each):
A) VIDEO EDITOR briefs — re-edits of EXISTING footage only (no new shooting): new hooks in the first 2s, length variants, b-roll re-ordering, audio/caption changes, reformatting winners for other platforms. Name which existing ad each edit starts from.
B) STATIC briefs — simple, unambiguous image-ad specs using EXISTING product/UGC photography only (no AI-generated imagery): exact layout, headline text, product, background, CTA. Written so a designer (or a careful AI layout tool) can execute without questions.
C) ORLY ON-CAMERA concepts — new shoots leveraging the founder: currently-trending formats (specify the trend), untested angles, each with a shot list of 3-6 shots, hook script (first line spoken), and what winning ad or gap in the data justifies it.

Return ONLY valid JSON, no markdown fences:
{"formatInsights": [{"finding": "...", "evidence": "...", "action": "..."}],
 "videoEditorBriefs": [{"title": "...", "basedOn": "existing ad name", "objective": "...", "instructions": ["step", ...], "successMetric": "..."}],
 "staticBriefs": [{"title": "...", "product": "...", "layout": "...", "headline": "...", "supportingCopy": "...", "cta": "...", "assets": "...", "rationale": "..."}],
 "orlyConcepts": [{"title": "...", "trend": "...", "hookScript": "...", "shotList": ["shot", ...], "rationale": "...", "successMetric": "..."}]}`;

  try {
    const msg = await client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 20000,
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage();
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
    const jsonStr = text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(jsonStr.slice(jsonStr.indexOf('{')));
    const payload = { briefs: parsed, generatedAt: new Date().toISOString() };
    await saveLarge('creative_briefs', JSON.stringify(payload));
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
