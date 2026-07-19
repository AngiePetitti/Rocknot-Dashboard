import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ANALYST_TOOLS, execTool, makeFetcher } from '@/src/lib/analystTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ChatMessage { role: 'user' | 'assistant'; content: string }

// Chat-only tool: lets Cleo kick off the shareable-report builder when the
// operator asks for a report in conversation.
const CREATE_REPORT_TOOL: Anthropic.Tool = {
  name: 'create_report',
  description:
    'Start building a polished, shareable visual report (PDF-able, with charts). Call this when the operator asks for a report, PDF, or shareable document — e.g. "create a report on this", "turn that into a report", "make me a report about July CAC". A separate process researches the data and builds the report; it opens in a new tab and is saved to their Saved reports. Pass a focus that captures exactly what the report should cover (including any date ranges or products mentioned).',
  input_schema: {
    type: 'object',
    properties: {
      focus: { type: 'string', description: 'One or two sentences describing exactly what the report should cover — topic, date range(s), comparisons, products.' },
    },
    required: ['focus'],
  },
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter(mm => (mm.role === 'user' || mm.role === 'assistant') && typeof mm.content === 'string' && mm.content.trim())
    .slice(-16);
  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Send at least one user message' }, { status: 400 });
  }

  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const system = `You are Cleo, the in-house AI data analyst for Rocknot, a music-inspired handbag & accessories brand (bags with interchangeable straps, jewelry, phone accessories). Today's date is ${today}.

You answer the operator's questions by QUERYING the store's data with the tools provided. The question determines what you fetch — derive the exact date ranges it implies (e.g. "last year vs this year month over month" → fetch each year's window with monthly granularity; "last week" → that week daily). Use yesterday as the end date for current periods, since today is partial. Fetch the minimum needed; use monthly granularity for ranges over ~3 months.

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

If the operator asks for a report / PDF / shareable document, call create_report with a precise focus, then confirm in one sentence that the report is being built (it opens in a new tab and lands in their Saved reports) — don't rewrite the analysis in the chat.`;

  try {
    let messages: Anthropic.MessageParam[] = [...history];
    let answer = '';
    let reportFocus: string | null = null;

    for (let iter = 0; iter < 8; iter++) {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system,
        tools: [...ANALYST_TOOLS, CREATE_REPORT_TOOL],
        messages,
      });

      if (response.stop_reason === 'refusal') {
        return NextResponse.json({ error: 'The model declined to answer this question. Try rephrasing.' }, { status: 502 });
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        messages = [...messages, { role: 'assistant', content: response.content }];
        const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUses.map(async tu => {
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
          })
        );
        messages.push({ role: 'user', content: results });
        continue;
      }

      answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      break;
    }

    if (!answer) answer = 'I ran out of analysis steps before finishing — try asking a more specific question.';
    return NextResponse.json({ ok: true, answer, ...(reportFocus ? { reportFocus } : {}) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
