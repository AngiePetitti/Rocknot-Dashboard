import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { ANALYST_TOOLS, execTool, makeFetcher } from '@/src/lib/analystTools';
import { saveReport, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ChatMessage { role: 'user' | 'assistant'; content: string }

// Floating Share / Save-as-PDF toolbar injected into every report. Hidden when
// printing so it never shows up in the PDF itself.
const TOOLBAR = `
<style>
  #rk-toolbar { position: fixed; bottom: 16px; right: 16px; display: flex; gap: 8px; z-index: 9999; }
  #rk-toolbar button { font: 600 13px system-ui, sans-serif; border: none; border-radius: 12px; padding: 10px 16px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  #rk-pdf { background: #8b5cf6; color: #fff; }
  #rk-share { background: #fff; color: #4b5563; border: 1px solid #e5e7eb !important; }
  #rk-save { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0 !important; }
  @media print {
    #rk-toolbar { display: none !important; }
    /* Keep the report's colors and charts intact in the PDF: browsers strip
       backgrounds by default and clip scrollable chart containers. */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    div { overflow: visible !important; }
    svg { max-width: 100% !important; }
  }
</style>
<div id="rk-toolbar">
  <button id="rk-save" type="button" style="display:none">💾 Save</button>
  <button id="rk-share" type="button">📤 Share</button>
  <button id="rk-pdf" type="button">Save as PDF</button>
</div>
<script>
  (function () {
    var pdf = document.getElementById('rk-pdf');
    var share = document.getElementById('rk-share');
    var save = document.getElementById('rk-save');
    // Save is only offered on a freshly generated report inside the dashboard
    // (?k=...) — not on saved copies (?saved=...) or shared/downloaded files.
    if (location.pathname.indexOf('/dashboard/insights/report') !== -1 && location.search.indexOf('k=') !== -1) {
      save.style.display = '';
    }
    if (window.__rkSaved) { save.textContent = '✓ Saved'; save.disabled = true; }
    save.addEventListener('click', function () {
      save.disabled = true;
      save.textContent = 'Saving…';
      var html = '<!doctype html>' + document.documentElement.outerHTML;
      fetch('/api/insights/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: document.title || 'Rocknot report', html: html })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) { save.textContent = '✓ Saved'; }
        else {
          save.textContent = 'Save failed — retry';
          save.title = (d && d.error) || 'Unknown error';
          save.disabled = false;
          console.error('Report save failed:', d && d.error);
        }
      }).catch(function (e) { save.textContent = 'Save failed — retry'; save.title = String(e); save.disabled = false; });
    });
    // Print dialog = "Save as PDF" on iPhone (pinch out on the preview) and desktop.
    pdf.addEventListener('click', function () { window.print(); });
    share.addEventListener('click', function () {
      var html = '<!doctype html>' + document.documentElement.outerHTML;
      var file = new File([html], (document.title || 'rocknot-report') + '.html', { type: 'text/html' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: document.title }).catch(function () {});
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        a.download = file.name;
        a.click();
      }
    });
  })();
</script>`;

function injectToolbar(html: string, alreadySaved: boolean): string {
  const prefix = alreadySaved ? '<script>window.__rkSaved = true;</script>' : '';
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + prefix + TOOLBAR : html.slice(0, i) + prefix + TOOLBAR + html.slice(i);
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return (m?.[1] || 'Rocknot report').trim().slice(0, 200);
}

// Pull the HTML document out of the model's final text (it may wrap it in a code fence).
function extractHtml(text: string): string | null {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  return candidate.slice(start);
}

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
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16);
  if (!history.some(m => m.role === 'assistant')) {
    return NextResponse.json({ error: 'Ask Cleo at least one question first — the report is built from the conversation.' }, { status: 400 });
  }

  const get = makeFetcher(req.nextUrl.origin, req.headers.get('cookie') || '');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const prettyDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });

  const conversation = history
    .map(m => `${m.role === 'user' ? 'QUESTION' : 'ANALYST ANSWER'}:\n${m.content}`)
    .join('\n\n---\n\n');

  const system = `You are Cleo, the in-house AI data analyst for Rocknot, a music-inspired handbag & accessories brand. Today's date is ${today}. You are turning an analyst chat conversation into a polished, SHAREABLE one-page report.

You have the same data tools as the chat. Re-fetch the key series behind the conversation's findings so every number and chart in the report is exact (the chat answers may be rounded). Fetch only what the report needs.

Then output a COMPLETE standalone HTML document — and nothing else. No commentary before or after, no markdown fence. Requirements:

STRUCTURE
- <title> and an <h1> report title derived from what the conversation is about, subtitle "Rocknot · Prepared ${prettyDate}".
- An executive summary of 2–4 sentences up top: the answer/takeaway, in plain language.
- 2–4 sections following the conversation's storyline: key metrics as stat tiles, comparisons as tables, trends as charts, then a short "Recommendations" section with concrete next steps drawn from the analysis.
- A small footer: "Generated by Cleo, Rocknot's AI analyst · Data through [latest data date]".

VISUALS (inline SVG only — no external libraries, no <script>)
- At least one chart when the data has a series or comparison: hand-write clean SVG bar or line charts with axis labels, gridlines (subtle #f1f5f9), value labels on bars, and a small legend when two series are compared.
- Charts must be accurate to the fetched data — compute pixel positions from the real numbers.
- Wrap charts in a container with overflow-x:auto so they never break the page on a phone. Give SVGs width:100%, height:auto with a viewBox.

BRAND STYLE — Rocknot dashboard pastels (use these exact colors)
- Page: background #f9fafb, cards white with border #f3f4f6, border-radius 16px, subtle shadow (0 1px 2px rgba(0,0,0,.05)), padding 20-24px, max-width 780px centered.
- Text: #1f2937 headings (bold), #6b7280 secondary, system-ui font stack.
- Accent palette: violet #8b5cf6 (primary — h1 accent, first chart series), indigo #818cf8, pink #f9a8d4, amber #fde68a, green #86efac. Pastel section header chips using the -50 tints: #eef2ff indigo, #fdf2f8 pink, #fffbeb amber, #f0fdf4 green.
- Stat tiles: label in 11px uppercase #9ca3af, value 24px bold #1f2937, optional delta in green #16a34a / red #dc2626.
- Positive deltas green, negative red; keep everything else pastel and calm — no harsh saturated colors, no purple walls.
- Print-friendly: add @media print { body { background: white } } and avoid elements that break across pages badly.

HONESTY
- Only report numbers you fetched. If a period had no data, either omit it or mark it "no data" — never fabricate.`;

  try {
    let messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Here is the analyst conversation to turn into a shareable report:\n\n${conversation}\n\nBuild the report now.`,
      },
    ];
    let finalText = '';

    for (let iter = 0; iter < 8; iter++) {
      // Streamed because a full HTML report can exceed the SDK's 10-minute
      // non-streaming limit at this max_tokens.
      const response = await client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        system,
        tools: ANALYST_TOOLS,
        messages,
      }).finalMessage();

      if (response.stop_reason === 'refusal') {
        return NextResponse.json({ error: 'The model declined to build this report. Try again.' }, { status: 502 });
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        messages = [...messages, { role: 'assistant', content: response.content }];
        const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUses.map(async tu => ({
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: await execTool(get, tu.name, (tu.input ?? {}) as Record<string, unknown>),
          }))
        );
        messages.push({ role: 'user', content: results });
        continue;
      }

      finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      break;
    }

    const html = finalText ? extractHtml(finalText) : null;
    if (!html) {
      return NextResponse.json({ error: 'Report generation didn\'t complete — try again, or ask a more specific question first.' }, { status: 502 });
    }
    // Auto-save the finished report to the user's saved list so it survives
    // even if they closed the tab while it was generating.
    let saved = false;
    if (isChatStoreConfigured() && authConfigured()) {
      try {
        const session = await getServerSession(authOptions);
        const email = session?.user?.email?.toLowerCase();
        if (email) {
          await saveReport(email, titleOf(html), injectToolbar(html, true));
          saved = true;
        }
      } catch { /* auto-save is best-effort — manual Save still available */ }
    }
    return NextResponse.json({ ok: true, html: injectToolbar(html, saved) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
