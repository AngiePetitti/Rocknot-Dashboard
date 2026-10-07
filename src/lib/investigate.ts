// The investigation: Cleo takes the top outliers from the sweep and digs into
// each with the same tools she uses in chat, then submits findings — problem
// or opportunity, evidence, action, confidence. Guardrail: every number in a
// finding must appear in the anomalies or in a tool result she actually saw;
// a finding whose numbers cannot be traced is dropped, not published.
import Anthropic from '@anthropic-ai/sdk';
import { ANALYST_TOOLS, execTool, makeFetcher } from '@/src/lib/analystTools';
import { getClient } from '@/src/lib/client';
import type { Anomaly } from '@/src/lib/scan';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface Finding {
  kind: 'problem' | 'opportunity' | 'note';
  title: string;
  evidence: string;
  action: string;
  confidence: 'high' | 'medium' | 'low';
  /** Rough dollar impact (from the anomaly it came from). */
  impact: number;
  /** Which anomaly it investigated (group · name). */
  source?: string;
}

const NUM_RE = /(?<![\w.])\$?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?<![\w.])\$?-?\d+(?:\.\d+)?%?/g;
function numbersIn(text: string): number[] {
  return (text.match(NUM_RE) || []).map(t => Number(t.replace(/[$,%]/g, ''))).filter(n => Number.isFinite(n));
}
function allowed(n: number, pool: number[]): boolean {
  // Small integers (counts, days, "7-day", percentages under 10) are not worth policing.
  if (Math.abs(n) < 10) return true;
  return pool.some(p => Math.abs(p - n) <= Math.max(0.5, Math.abs(p) * 0.006) || Math.abs(Math.round(p) - n) < 0.5 || Math.abs(Math.round(p * 10) / 10 - n) < 0.05);
}

export async function investigate(date: string, anomalies: Anomaly[], origin: string, cookie: string, maxToolCalls = 12): Promise<{ findings: Finding[]; dropped: number; toolCalls: number; error?: string }> {
  if (!anomalies.length) return { findings: [], dropped: 0, toolCalls: 0 };
  const brand = getClient();
  const get = makeFetcher(origin, cookie);
  const top = anomalies.slice(0, 7);
  const seen: string[] = [JSON.stringify(top)];
  let toolCalls = 0;
  const submit: Anthropic.Tool = {
    name: 'submit_findings',
    description: 'Submit the findings from this investigation (at most 5).',
    input_schema: {
      type: 'object',
      properties: {
        findings: { type: 'array', items: { type: 'object', properties: {
          kind: { type: 'string', enum: ['problem', 'opportunity', 'note'] },
          title: { type: 'string', description: '≤ 90 chars, specific: "Desktop conversion fell on the bridal collection page"' },
          evidence: { type: 'string', description: '1–3 sentences with the numbers that prove it, all from the anomalies or your tool results.' },
          action: { type: 'string', description: 'One concrete next step, or "No action — explained by X".' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          impact: { type: 'number', description: 'Dollar impact from the anomaly list' },
          source: { type: 'string', description: 'group · name of the anomaly investigated' },
        }, required: ['kind', 'title', 'evidence', 'action', 'confidence', 'impact'] } },
      },
      required: ['findings'],
    },
  };
  const system = `You are ${brand.analyst.name}, ${brand.name}'s in-house analyst. The dashboard swept every series it tracks for ${date} and ranked the outliers by dollar impact (ANOMALIES below). Investigate the most important ones like an operator who has sat inside brands: is this a problem, an opportunity, or noise explained by something else (a launch, a sale, a stock-out, a tracking change)?
- Use the tools to confirm and explain (at most ${maxToolCalls} calls in total; batch independent calls in one turn). Good moves: get_organic_content / get_ad_creatives to see what drove a product spike; get_site_analytics for a landing-page or device conversion change; get_ad_performance for a campaign; get_inventory before calling anything an opportunity; get_top_products to size a product.
- Every number you write must come from ANOMALIES or a tool result you received. Findings with untraceable numbers are discarded automatically.
- Prefer fewer, sharper findings (3–5). Skip anything you cannot explain or that is clearly noise. Write for a founder: plain words, the number, the action.
- Finish by calling submit_findings exactly once.`;
  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: `ANOMALIES (ranked by impact):\n${JSON.stringify(top, null, 1)}\n\nInvestigate and submit findings.` }];
  try {
    for (let iter = 0; iter < 8; iter++) {
      const res = await client.messages.create({
        model: 'claude-opus-4-8', max_tokens: 6000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
        system, tools: [...ANALYST_TOOLS, submit], messages,
      });
      const submitted = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_findings');
      if (submitted) {
        const raw = ((submitted.input as { findings?: Finding[] })?.findings || []).slice(0, 5);
        const pool = numbersIn(seen.join('\n'));
        const kept: Finding[] = []; let dropped = 0;
        for (const f of raw) {
          const nums = numbersIn(`${f.title} ${f.evidence} ${f.action}`);
          if (nums.every(n => allowed(n, pool))) kept.push({ kind: f.kind, title: String(f.title).slice(0, 120), evidence: String(f.evidence), action: String(f.action), confidence: f.confidence, impact: Number(f.impact) || 0, source: f.source });
          else dropped += 1;
        }
        return { findings: kept.sort((a, b) => b.impact - a.impact), dropped, toolCalls };
      }
      if (res.stop_reason !== 'tool_use') break;
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages = [...messages, { role: 'assistant', content: res.content }];
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(uses.map(async tu => {
        toolCalls += 1;
        const content = toolCalls > maxToolCalls ? 'Tool budget exhausted — submit your findings now with submit_findings.' : await execTool(get, tu.name, (tu.input ?? {}) as Record<string, unknown>);
        seen.push(content);
        return { type: 'tool_result' as const, tool_use_id: tu.id, content };
      }));
      messages.push({ role: 'user', content: results });
    }
    return { findings: [], dropped: 0, toolCalls, error: 'The investigation ended without findings.' };
  } catch (e) {
    return { findings: [], dropped: 0, toolCalls, error: e instanceof Error ? e.message : String(e) };
  }
}
