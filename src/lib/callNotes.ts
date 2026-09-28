// Call notes → action items. Paste (or dictate) the notes from a client call
// and Claude pulls out the concrete to-dos with an owner and a due date where
// one was said. Used by the Tasks tab importer and by the daily Wispr Flow
// routine, so both land tasks on THIS deployment's board only.
import Anthropic from '@anthropic-ai/sdk';
import { getClient } from '@/src/lib/client';
import { todayPst } from '@/src/lib/timeframes';

export interface ActionItem {
  title: string;
  description?: string;
  assignee?: string;
  dueDate?: string;      // YYYY-MM-DD
  priority: 'low' | 'medium' | 'high';
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return JSON.parse(candidate);
}

export async function extractActionItems(notes: string, opts: { source?: string; callDate?: string; people?: string[] } = {}): Promise<ActionItem[]> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey });
  const c = getClient();
  const today = todayPst();
  const people = (opts.people || []).filter(Boolean);

  const prompt = `Today is ${today}. These are notes from a call about ${c.name} (${c.brand.description.split('.')[0]}).
${opts.source ? `Call: ${opts.source}.` : ''} ${opts.callDate ? `Call date: ${opts.callDate}.` : ''}
${people.length ? `People who take action items on these calls: ${people.join(', ')}. Match owners to these names when the notes point at them.` : ''}

Pull out every concrete ACTION ITEM — something a named person (or "Angie" / the agency, by default) has to do next. Skip discussion, context and decisions that need no action. Merge duplicates. Keep each title short and imperative ("Send Kailee the October brief", not "October brief discussion").

Return ONLY a JSON array, no prose:
[
  {
    "title": "…",                       // ≤ 90 chars, imperative
    "description": "…",                // 1-2 sentences of context from the notes, or omit
    "assignee": "First name",          // who owns it; "Angie" when the notes say we/I/us or nobody is named
    "dueDate": "YYYY-MM-DD",           // only if a date or a clear relative deadline was said ("by Friday", "before the launch"); resolve relative dates from today; omit otherwise
    "priority": "low" | "medium" | "high"   // high = blocks a launch/send or a client is waiting on it
  }
]

NOTES:
"""
${notes.slice(0, 20000)}
"""`;

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The model declined to read these notes.');
  const text = response.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
  const raw = extractJson(text);
  if (!Array.isArray(raw)) return [];
  return raw.map((r: Record<string, unknown>) => ({
    title: String(r.title || '').slice(0, 200).trim(),
    description: typeof r.description === 'string' ? r.description.slice(0, 2000).trim() : undefined,
    assignee: typeof r.assignee === 'string' ? r.assignee.slice(0, 60).trim() : undefined,
    dueDate: typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? r.dueDate : undefined,
    priority: (r.priority === 'high' || r.priority === 'low' ? r.priority : 'medium') as ActionItem['priority'],
  })).filter(i => i.title);
}
