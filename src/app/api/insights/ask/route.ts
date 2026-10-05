import { NextRequest, NextResponse } from 'next/server';
import { friendlyAiError } from '@/src/lib/aiError';
import Anthropic from '@anthropic-ai/sdk';
import { ANALYST_TOOLS, execTool, makeFetcher } from '@/src/lib/analystTools';
import { getClient, marketplaces } from '@/src/lib/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ChatImage { dataUrl: string; name?: string }
interface ChatMessage { role: 'user' | 'assistant'; content: string; images?: ChatImage[] }

// Screenshots the operator attaches (Ads Manager, Shopify, a creative, a Slack
// thread). Data URLs only, common raster types, ≤ 5 MB decoded, 4 per message.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
function parseImage(img: ChatImage): { media_type: ImageMediaType; data: string } | null {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(img?.dataUrl || '');
  if (!m || !IMAGE_TYPES.has(m[1])) return null;
  if (m[2].length * 0.75 > 5 * 1024 * 1024) return null;
  return { media_type: m[1] as ImageMediaType, data: m[2] };
}
function toParam(mm: ChatMessage): Anthropic.MessageParam {
  const imgs = (mm.images || []).slice(0, 4).map(parseImage).filter((x): x is NonNullable<typeof x> => x !== null);
  if (mm.role !== 'user' || !imgs.length) return { role: mm.role, content: mm.content };
  const blocks: Anthropic.ContentBlockParam[] = imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }));
  blocks.push({ type: 'text', text: mm.content.trim() || 'What should I do based on this?' });
  return { role: 'user', content: blocks };
}

// Chat-only tool: lets Cleo kick off the shareable-report builder when the
// operator asks for a report in conversation.
const CREATE_REPORT_TOOL: Anthropic.Tool = {
  name: 'create_report',
  description:
    'Start building a polished, shareable visual report (PDF-able, with charts). Call this when the operator asks for a report, PDF, or shareable document — e.g. "create a report on this", "turn that into a report", "make me a report about July CAC". A separate process researches the data and builds the report; it opens in a new tab and is saved to their Saved reports. Pass a focus that captures exactly what the report should cover (including any date ranges or products mentioned).',
  input_schema: {
    type: 'object',
    properties: {
      focus: { type: 'string', description: 'A complete brief for the report builder (it does NOT see this chat reliably — everything it must honor goes here): topic, date range(s), comparisons, products, AND every standing instruction or correction the operator has given that applies (naming rules, required content per item, things to include for EVERY entry). If the operator asked for content deliverables (e.g. email campaign copy), say explicitly that each item needs full ready-to-use copy, and list the items.' },
    },
    required: ['focus'],
  },
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: { messages?: ChatMessage[]; voiceMode?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  // Keep a long window: standing instructions ("always call it Statement
  // Strings™ Hoodie") arrive early in a session, and trimming them out made
  // Cleo "forget" corrections the operator already gave.
  const history = (body.messages ?? [])
    .filter(mm => (mm.role === 'user' || mm.role === 'assistant') && typeof mm.content === 'string' && (mm.content.trim() || (mm.images && mm.images.length)))
    .slice(-80);
  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Send at least one user message' }, { status: 400 });
  }

  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const brand = getClient();
  const { getBrandBrief } = await import('@/src/lib/brandBrief');
  const brandBrief = await getBrandBrief().catch(() => brand.brand.description);
  const system = `You are ${brand.analyst.name}, the in-house AI data analyst for ${brand.name}. ${brand.brand.description} Today's date is ${today}.

BRAND BRIEF — read carefully; every piece of copy, campaign idea, or brief you write must follow it, especially the hard rules:
${brandBrief}

You answer the operator's questions by QUERYING the store's data with the tools provided. The operator may ATTACH SCREENSHOTS (an ads manager, Shopify, an email or creative, a Slack thread, a spreadsheet). When one is attached: read every number and label off it carefully, say in one line what you are looking at, cross-check anything checkable against the live data with your tools, then give concrete next steps — what to change, where, and what to watch. If the image is unreadable or missing what you need, say exactly what to send instead. The question determines what you fetch — derive the exact date ranges it implies (e.g. "last year vs this year month over month" → fetch each year's window with monthly granularity; "last week" → that week daily). Use yesterday as the end date for current periods, since today is partial. Fetch the minimum needed; use monthly granularity for ranges over ~3 months.

AD VISUALS — get_ad_creatives returns each ad's thumbnail \`image\` URL and ads-manager \`link\`. When the operator asks to see ads/creatives, include the image URLs as markdown images (![ad name](url)) so they render, and the link so they can open the ad.

MARKETPLACE CHANNELS — ${marketplaces().length ? `this dashboard tracks ${marketplaces().map(m => `${m.label} (Shopify sales channel "${m.shopifyChannel}")`).join(', ')}. Those sales are EXCLUDED from every store figure (get_metrics, products, customers, attribution) and are available ONLY through get_marketplace_channel — call it whenever the question involves ${marketplaces().map(m => m.label).join(' / ')}, wholesale or dropship, and never say that data is unavailable without calling it.` : 'none on this dashboard.'}

DATES — the year is ${today.slice(0, 4)}. A month named without a year ("September", "last month", "this quarter") means the most recent one that has already happened relative to today, in ${today.slice(0, 4)} (or late ${Number(today.slice(0, 4)) - 1} only if that month hasn't occurred yet this year). Last year's same month is the comparison, never the headline. Every tool result starts with a date check — read it, and if it says the range is a year before today, you are looking at the prior year: re-fetch the current year before answering. Label every period with its year in your answer.

Answer like a data scientist:
- Quantify. Cite the actual numbers you fetched and show derived calculations briefly (growth rates, CAC = spend ÷ new customers, per-month deltas).
- Compare against a baseline where useful.
- Distinguish correlation from causation, and say so when the data only shows correlation.
- If a fetched period comes back empty or zeros, the data likely doesn't extend that far back — say exactly what's missing rather than guessing. Never invent numbers.

Format for fast reading on a phone (GitHub-flavored markdown):
- Open with a one-or-two-sentence **bold-highlighted** answer.
- Use a compact markdown table for any month-over-month, period, or product comparison (short column headers, one metric family per table). Never list months inline in a sentence.
- Use short bullets for everything else; **bold** the numbers that matter.
- Keep the whole answer tight — no filler, no headers, no closing pleasantries.

Product truth: before writing ANY copy, campaign, or brief that mentions a product, call get_product_catalog and use only product names, variants, colors, and features that appear there (or that the operator stated), and NEVER feature or mention anything the catalog marks SOLD OUT or OUT OF STOCK — customers clicking to a dead product page is worse than no email. Getting a product's name or features wrong destroys trust in everything else.

Standing instructions: when the operator gives a rule or correction earlier in the conversation ("always use this product name", "every campaign must include full copy"), treat it as binding for the rest of the session — apply it without being reminded, and carry it into any create_report focus.

If the operator asks for a report / PDF / shareable document, call create_report with a precise focus, then confirm in one sentence that the report is being built (it opens in a new tab and lands in their Saved reports) — don't rewrite the analysis in the chat.`;

  try {
    let messages: Anthropic.MessageParam[] = history.map(toParam);
    let answer = '';
    let reportFocus: string | null = null;

    // Voice mode: the answer gets read aloud, so write for the ear.
    const voiceSystem = body.voiceMode
      ? `${system}\n\nVOICE MODE: your answer will be READ ALOUD by text-to-speech. Be warm and conversational, like a sharp colleague talking — short sentences, contractions, a little personality. NO tables, NO bullet lists, NO markdown formatting, NO URLs. Round numbers the way people say them ("about five eighty-four thousand", "three and a half x"). Keep it under 120 words unless the question truly needs more; offer to go deeper instead of dumping detail.`
      : system;

    for (let iter = 0; iter < 8; iter++) {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: voiceSystem,
        tools: [...ANALYST_TOOLS, CREATE_REPORT_TOOL],
        messages,
      });

      if (response.stop_reason === 'refusal') {
        return NextResponse.json({ error: 'The model declined to answer this question. Try rephrasing.' }, { status: 502 });
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        messages = [...messages, { role: 'assistant', content: response.content }];
        // WRITE tools must run one-at-a-time: the sheet-backed stores are
        // load-modify-save, so parallel writes clobber each other (15 task
        // creates in one turn once collapsed to 5 — every call "succeeded").
        // Reads stay parallel for speed.
        const WRITE_TOOLS = new Set(['create_task', 'update_task', 'delete_task']);
        const runOne = async (tu: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> => {
          if (tu.name === 'create_report') {
            const focus = String((tu.input as { focus?: string })?.focus || '').trim();
            if (focus) reportFocus = focus;
            return {
              type: 'tool_result' as const,
              tool_use_id: tu.id,
              content: 'Report generation queued. Confirm to the operator in one sentence that it is being built and will open in a new tab / appear in Saved reports.',
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: await execTool(get, tu.name, (tu.input ?? {}) as Record<string, unknown>),
          };
        };
        const reads = toolUses.filter(tu => !WRITE_TOOLS.has(tu.name));
        const writes = toolUses.filter(tu => WRITE_TOOLS.has(tu.name));
        const readResults = await Promise.all(reads.map(runOne));
        const writeResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of writes) writeResults.push(await runOne(tu));
        // Results must line up with the tool_use order in the assistant turn.
        const byId = new Map([...readResults, ...writeResults].map(r => [r.tool_use_id, r]));
        const results = toolUses.map(tu => byId.get(tu.id)!);
        messages.push({ role: 'user', content: results });
        continue;
      }

      answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      break;
    }

    if (!answer) answer = 'I ran out of analysis steps before finishing — try asking a more specific question.';
    return NextResponse.json({ ok: true, answer, ...(reportFocus ? { reportFocus } : {}) });
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err) }, { status: 500 });
  }
}
