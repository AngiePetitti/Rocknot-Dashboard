import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { saveDoc, loadDoc } from '@/src/lib/docStore';
import { getEvents } from '@/src/lib/calendarStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface BriefIndexEntry { id: string; track: 'video' | 'static' | 'orly'; title: string; summary: string }

export async function GET() {
  try {
    const raw = await loadDoc('creative_briefs_index');
    if (!raw) return NextResponse.json({ briefs: null });
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ briefs: null });
  }
}

const TRACK_SPECS: Record<'video' | 'static' | 'orly', string> = {
  video: `TRACK: VIDEO EDITOR RE-EDIT. The editor can ONLY use footage that already exists in past ads — no new shooting, no product access. The brief must include, as sections:
1. **The winning ad this starts from** — exact ad name from the data, its numbers, and specifically WHY we believe it works (hook? product? pacing?).
2. **The hypothesis** — the one variable this edit tests, and the data gap that justifies it.
3. **Edit script** — a timecoded plan (0:00–0:02 hook, 0:02–0:07 …) describing exactly what appears in each segment, which source footage to pull it from, and every text overlay VERBATIM (write the actual overlay text).
4. **Variants to deliver** — exact list (e.g. 15s and 30s cuts; 9:16 and 1:1; 3 hook variants with each hook's overlay text written out).
5. **Audio direction** — trending vs original audio, caption style, where the beat should hit.
6. **Do NOT** — 3-5 specific things that would break what works.
7. **Naming & delivery** — filenames following the existing convention, where to upload.
8. **Success criteria** — the metric vs the source ad's benchmark, and how long to let it run.`,
  static: `TRACK: STATIC AD. Uses EXISTING product/UGC photography only — absolutely no AI-generated imagery. The designer may not know the brand, so be exhaustive:
1. **Objective & background** — what the data says (which products/formats are converting) and what this static must accomplish.
2. **Canvas & versions** — exact sizes to deliver (1080×1080, 1080×1350, 1080×1920) and any platform placements.
3. **Layout, described spatially** — walk through the composition zone by zone (top third / center / bottom), where the product photo sits, scale, cropping, negative space. Reference which existing photos to use by describing them (e.g. "the flat-lay of the Gali Chain Top on white from the product page").
4. **Every word on the ad, verbatim** — headline, subline, badge text, CTA button text. No placeholders.
5. **Typography & color direction** — per the BRAND GUIDELINES section; if guidelines are missing, instruct the designer to pull type and color exactly from rocknot.com product pages, and say so explicitly.
6. **Do NOT** — specific mistakes to avoid.
7. **Success criteria.**

After the markdown sections, append a machine-readable layout mockup as a fenced code block with the language tag \u0060\u0060\u0060layout containing STRICT JSON in exactly this shape (percent heights should sum to ~100; use the REAL text and brand hex colors from the guidelines):
{"canvas":"1080x1350","background":"#HEX","zones":[
 {"h":14,"type":"badge","text":"...", "align":"center"},
 {"h":16,"type":"headline","text":"...","align":"center","color":"#HEX"},
 {"h":48,"type":"product","note":"which existing photo goes here and how it is cropped"},
 {"h":12,"type":"subline","text":"..."},
 {"h":10,"type":"cta","text":"..."}]}
Zone types allowed: headline, subline, badge, product, cta, spacer.`,
  orly: `TRACK: ORLY ON-CAMERA (founder shoot). Orly is charismatic and converts on camera — the data shows founder-voice content performs. This brief is a shoot plan she can execute in one session:
1. **The concept & the trend** — name the specific trending format (describe it precisely: structure, why it's trending, an example of the format in the wild) and why it fits the data.
2. **Full script** — every spoken line written out, 30-45 seconds, in Orly's casual founder voice, with [action] cues between lines. Write 3 alternative first-lines (hooks) verbatim.
3. **Shot list** — 5-8 shots: framing (close/medium/wide), location suggestion, what happens in frame, which products appear, approx duration each.
4. **Wardrobe & props** — specific products to wear/feature (tie to what's selling or launching).
5. **Capture notes** — vertical 9:16, natural light vs ring light, phone is fine, leave 3s of padding, etc.
6. **B-roll to grab while set up** — 4-6 quick clips for the editor's future use.
7. **Success criteria** — what winning looks like vs the current best founder ad.`,
};

export async function POST(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can regenerate briefs' }, { status: 403 });
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Anthropic not configured' }, { status: 500 });

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get('cookie') || '';
  const cres = await fetch(`${origin}/api/windsor/creatives?tf=30d`, { headers: { cookie }, cache: 'no-store' });
  const cdata = await cres.json().catch(() => null);
  const creatives = (cdata?.creatives ?? []) as Array<{
    id: string; name: string; platform: string; campaign: string; spend: number; revenue: number;
    roas: number; ctr: number; conversions: number; adUrl?: string | null; videoUrl?: string | null;
    thumbnailUrl?: string | null;
  }>;
  if (!creatives.length) {
    return NextResponse.json({ error: 'No creative performance data available to base briefs on' }, { status: 502 });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const events = await getEvents().catch(() => []);
  const upcoming = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12)
    .map(e => `${e.date}: ${e.title} (${e.type})`).join('\n');
  const guidelines = (await loadDoc('brand_guidelines').catch(() => null)) || '';

  const adLines = creatives.slice(0, 40).map(c =>
    `${c.name} [${c.platform}] — $${Math.round(c.spend)} spend · ${c.roas}x ROAS · ${c.ctr}% CTR · ${c.conversions} conv`
  ).join('\n');

  const shared = `You are Rocknot's senior creative strategist writing a production brief. Rocknot is a DTC rhinestone jewelry/handbag brand; founder Orly fronts the content; AOV ~$170. Ad names encode the creative (Video_/Static_, product, Demo/Talking Head/Montage UGC/Founder, landing page).

BRAND GUIDELINES (follow these for ALL visual/voice direction — do NOT invent brand colors or assume any palette. If this section is empty, explicitly instruct the designer to pull visual identity from rocknot.com and say the guidelines doc is pending):
${guidelines || '(none uploaded yet)'}

LAST 30 DAYS OF AD PERFORMANCE:
${adLines}

UPCOMING LAUNCHES:
${upcoming || 'None scheduled.'}

Write ONE deep, self-contained brief in Markdown. It will be handed to a freelancer who has never spoken to us — they must be able to produce the deliverable with ZERO follow-up questions. Use ## section headings, short paragraphs, bullet lists and tables where helpful. 600-1000 words. Ground every choice in the performance data by naming the actual ads (exact names, plain text — never invent URLs or links; names get auto-linked). Start with a # title line, then a one-sentence summary line in italics, then the sections.`;

  try {
    const batch = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const tracks: Array<'video' | 'static' | 'orly'> = ['video', 'static', 'orly'];
    const results = await Promise.all(tracks.map(track =>
      client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        messages: [{ role: 'user', content: `${shared}\n\n${TRACK_SPECS[track]}` }],
      }).finalMessage()
    ));

    // Linkify referenced ad names to the DASHBOARD's creative view (the
    // Analyze modal auto-opens via ?ad=<id> — playback, download, stats all
    // there). Placeholder pass first so sibling ads whose names are prefixes
    // of each other can never nest links inside links.
    const linkable = creatives.sort((a, b) => b.name.length - a.name.length);
    const linkify = (mdIn: string): string => {
      let out = mdIn;
      linkable.forEach((c, i) => {
        if (!out.includes(c.name)) return;
        out = out.split('\u0060' + c.name + '\u0060').join(`\u27e6AD${i}\u27e7`);
        out = out.split(c.name).join(`\u27e6AD${i}\u27e7`);
      });
      linkable.forEach((c, i) => {
        const link = `[${c.name}](/dashboard/creatives?tf=30d&ad=${encodeURIComponent(c.id)})`;
        out = out.split(`\u27e6AD${i}\u27e7`).join(link);
      });
      return out;
    };

    // Visual reference gallery: thumbnails of every ad the brief cites.
    const addReferences = (mdIn: string): string => {
      const cited = linkable.filter(c => c.thumbnailUrl && mdIn.includes(`/dashboard/creatives?tf=30d&ad=${encodeURIComponent(c.id)}`)).slice(0, 4);
      if (!cited.length) return mdIn;
      return mdIn + '\n\n## Reference Creatives\n' + cited.map(c =>
        `![${c.name}](${c.thumbnailUrl})\n*[${c.name}](/dashboard/creatives?tf=30d&ad=${encodeURIComponent(c.id)}) — ${c.roas}x ROAS · ${c.ctr}% CTR*`
      ).join('\n\n');
    };

    const index: BriefIndexEntry[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const md = addReferences(linkify(results[i].content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()));
      const title = (md.match(/^#\s*(.+)$/m)?.[1] || `${track} brief`).trim();
      const summary = (md.match(/^\*(.+)\*$/m)?.[1] || md.replace(/^#.*$/m, '').trim().split('\n').find(l => l.trim()) || '').trim().slice(0, 200);
      const id = `${batch}_${track}`;
      await saveDoc(`brief_${id}`, md);
      index.push({ id, track, title, summary });
    }

    const payload = { briefs: index, generatedAt: new Date().toISOString() };
    await saveDoc('creative_briefs_index', JSON.stringify(payload));
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
