// Cleo report builder — a staged pipeline so long reports survive the
// platform's per-run limit (~5 min). One run per step:
//   plan → section:0 … section:n → assemble (summary + save)
// Every step persists its state in the Settings KV (job) and its output in
// the doc store (payload, section fragments), so any run can pick the job up
// where the last one stopped. The chat banner and the viewer tab poll the job
// and nudge the next step when it stalls, so progress never depends on
// background execution being kept alive.
import Anthropic from '@anthropic-ai/sdk';
import { getClient, marketplaces } from '@/src/lib/client';
import { ANALYST_TOOLS, execTool, makeFetcher } from '@/src/lib/analystTools';
import { saveReport, isChatStoreConfigured, setKV, getKV } from '@/src/lib/chatStore';
import { saveDoc, loadDoc } from '@/src/lib/docStore';
import { friendlyAiError } from '@/src/lib/aiError';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ReportPayload { messages: ChatMessage[]; focus: string; email: string | null }
export interface ReportSection { title: string; focus: string; status: 'pending' | 'done' | 'error'; error?: string }
export interface ReportJob {
  status: 'running' | 'done' | 'error';
  stage?: string;
  step?: string; // 'plan' | 'section:<i>' | 'assemble' | 'done'
  title?: string;
  subtitle?: string;
  sections?: ReportSection[];
  claimedStep?: string;
  claimedAt?: string;
  claimToken?: string;
  error?: string;
  reportId?: string;
  updatedAt: string;
}

export const jobKey = (since: number) => `report_job_${since}`;
const STEP_TIMEOUT_MS = 6 * 60 * 1000; // a claimed step older than this is presumed dead

export async function getJob(since: number): Promise<ReportJob | null> {
  if (!since || !isChatStoreConfigured()) return null;
  try { const raw = await getKV(jobKey(since)); return raw ? (JSON.parse(raw) as ReportJob) : null; } catch { return null; }
}
export async function patchJob(since: number, patch: Partial<ReportJob>): Promise<ReportJob> {
  const cur = (await getJob(since)) || { status: 'running' as const, updatedAt: '' };
  const next: ReportJob = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  if (since && isChatStoreConfigured()) { try { await setKV(jobKey(since), JSON.stringify(next)); } catch { /* best-effort */ } }
  return next;
}
export async function savePayload(since: number, payload: ReportPayload): Promise<void> {
  if (!since || !isChatStoreConfigured()) return;
  await saveDoc(`report_payload_${since}`, JSON.stringify(payload));
}
export async function loadPayload(since: number): Promise<ReportPayload | null> {
  if (!since) return null;
  const raw = await loadDoc(`report_payload_${since}`).catch(() => null);
  return raw ? (JSON.parse(raw) as ReportPayload) : null;
}

// ── Shared pieces ──────────────────────────────────────────────────────────

const TOOLBAR = `
<style>
  #rk-toolbar { position: fixed; bottom: 16px; right: 16px; display: flex; gap: 8px; z-index: 9999; }
  #rk-toolbar button { font: 600 13px system-ui, sans-serif; border: none; border-radius: 12px; padding: 10px 16px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  #rk-pdf { background: #8b5cf6; color: #fff; }
  #rk-share { background: #fff; color: #4b5563; border: 1px solid #e5e7eb !important; }
  #rk-save { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0 !important; }
  @page { margin: 12mm; }
  @media print {
    #rk-toolbar { display: none !important; }
    /* Keep the report's colors and charts intact in the PDF: browsers strip
       backgrounds by default and clip scrollable chart containers. */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    div { overflow: visible !important; }
    svg { max-width: 100% !important; }
    /* Sensible page breaks: never slice a chart, table, or stat tile in half,
       and keep headings attached to the content below them. (Containers
       taller than a page still break — the browser ignores avoid there.) */
    body { background: #fff !important; }
    div, section, table, svg, figure, ul, ol { break-inside: avoid; page-break-inside: avoid; }
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    tr, li { break-inside: avoid; }
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
        body: JSON.stringify({ title: document.title || 'Report', html: html })
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
      var file = new File([html], (document.title || 'report') + '.html', { type: 'text/html' });
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

export function injectToolbar(html: string, alreadySaved: boolean): string {
  const prefix = alreadySaved ? '<script>window.__rkSaved = true;</script>' : '';
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + prefix + TOOLBAR : html.slice(0, i) + prefix + TOOLBAR + html.slice(i);
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:html|json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

// Shared stylesheet every section fragment relies on (the section prompt
// names these classes), so the assembled document is consistent and lean.
const REPORT_CSS = `
*{box-sizing:border-box}body{margin:0;background:#f9fafb;color:#1f2937;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}h3{font-size:14px;margin:14px 0 6px;color:#374151}
.sub{color:#6b7280;font-size:13px;margin:0 0 20px}
.card{background:#fff;border:1px solid #f3f4f6;border-radius:16px;padding:20px 22px;margin:0 0 16px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.chip{display:inline-block;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;margin-bottom:10px;background:#eef2ff;color:#4338ca}
.chip.pink{background:#fdf2f8;color:#be185d}.chip.amber{background:#fffbeb;color:#b45309}.chip.green{background:#f0fdf4;color:#15803d}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:10px 0}
.tile{background:#f9fafb;border:1px solid #f3f4f6;border-radius:12px;padding:12px}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af;font-weight:600}
.value{font-size:22px;font-weight:700;color:#1f2937;margin-top:2px}
.delta{font-size:12px;font-weight:600}.delta.up{color:#16a34a}.delta.down{color:#dc2626}
table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}th{text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #f3f4f6;padding:6px 8px}td{padding:7px 8px;border-bottom:1px solid #f9fafb}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:10px 0}
.item{border:1px solid #f3f4f6;border-radius:12px;padding:8px;text-decoration:none;color:inherit;display:block}
.item img,.item .ph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#f3f4f6;display:block}.item .ph{display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px}
.item.wide img,.item.wide .ph{aspect-ratio:16/9}.item.tall img,.item.tall .ph{aspect-ratio:2/3}
.item .t{font-size:12px;font-weight:600;margin:8px 0 2px;line-height:1.3}.item .m{font-size:11px;color:#6b7280}
.chart{overflow-x:auto;margin:10px 0}.chart svg{width:100%;height:auto;display:block}
.cap{font-size:12px;color:#6b7280;margin:6px 0 0}
.note{background:#eef2ff;border:1px solid #e0e7ff;border-radius:12px;padding:10px 14px;font-size:13px;color:#3730a3;margin:10px 0}
.warn{background:#fffbeb;border:1px solid #fef3c7;border-radius:12px;padding:10px 14px;font-size:13px;color:#92400e;margin:10px 0}
.bad{background:#fef2f2;border:1px solid #fee2e2;border-radius:12px;padding:10px 14px;font-size:13px;color:#991b1b;margin:10px 0}
ul{margin:6px 0 6px 18px;padding:0}li{margin:4px 0}
footer{color:#9ca3af;font-size:12px;text-align:center;margin-top:24px}
@page{margin:12mm}@media print{body{background:#fff}.card{break-inside:avoid;page-break-inside:avoid}h1,h2,h3{break-after:avoid}tr,li{break-inside:avoid}.chart{overflow:visible}}
`;

function baseContext(payload: ReportPayload, brandBrief: string): string {
  const brand = getClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return `You are ${brand.analyst.name}, the in-house AI data analyst for ${brand.name}. ${brand.brand.description} Today's date is ${today}.

BRAND BRIEF — any copy or campaign content must follow it, especially the hard rules:
${brandBrief}

MARKETPLACE CHANNELS — ${marketplaces().length ? `this dashboard tracks ${marketplaces().map(m => `${m.label} (Shopify sales channel "${m.shopifyChannel}")`).join(', ')}. Those sales are EXCLUDED from every store figure (get_metrics, products, customers, attribution) and are available ONLY through get_marketplace_channel — call it whenever the topic involves ${marketplaces().map(m => m.label).join(' / ')}, wholesale or dropship, and never say that data is unavailable without calling it.` : 'none on this dashboard.'}

DATES — the year is ${today.slice(0, 4)}. "September" with no year means September ${today.slice(0, 4)} (the most recent one that has happened); last year's September is only the comparison side. Every tool result starts with a date check — if it says the range is a year before today, that is the PRIOR year: fetch the current-year range too and headline that. Label every period and every chart axis with its year.

HONESTY — only report numbers you fetched. If a period had no data, say "no data" — never fabricate. Store figures are ONLINE STORE ONLY unless the tool says otherwise.`;
}

function conversationText(payload: ReportPayload): string {
  return payload.messages.map(m => `${m.role === 'user' ? 'QUESTION' : 'ANALYST ANSWER'}:\n${m.content}`).join('\n\n---\n\n') || '(no prior conversation)';
}

// ── Step 1: plan ───────────────────────────────────────────────────────────

async function runPlan(since: number, payload: ReportPayload, brandBrief: string): Promise<void> {
  const brand = getClient();
  const prettyDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });
  const system = `${baseContext(payload, brandBrief)}

You are PLANNING a shareable report that another process will build one section at a time (each section is researched and written separately, with the data tools). Submit the plan with the plan_report tool: {title, subtitle, sections: [{title, focus}]}.

Rules:
- title: the report's name (what it's about; include the period and year). subtitle: "${brand.name} · Prepared ${prettyDate}".
- 1 to 8 sections, in reading order. For a simple question, 1–2 sections. For an end-of-month / team report, one section per area the operator listed. For content deliverables (campaign copy, briefs), group the items into sections of at most 4 items each so every item gets full copy.
- Each focus is a COMPLETE brief (at most 2500 characters) for that section's builder, which does NOT see this conversation: what to cover, the exact date range(s) with years, which tools to call (get_metrics, get_ad_performance, get_ad_creatives, get_organic_content, get_marketplace_channel, get_top_products, get_customer_intel, get_retention, get_attribution, get_returns, get_product_catalog…), what to compare, which visuals (stat tiles / table / chart / image cards), and EVERY standing instruction or correction from the operator that applies to it.
- End with a "Recommendations" section for data reports (focus: concrete next steps, drawn from the other sections' topics). Not for pure content deliverables.`;
  // The plan comes back through a tool call, so the API guarantees well-formed
  // JSON (a free-text plan once came back cut off mid-array and failed to
  // parse). Generous max_tokens: eight sections with full briefs run long.
  type Plan = { title?: string; subtitle?: string; sections?: Array<{ title: string; focus: string }> };
  const planTool: Anthropic.Tool = {
    name: 'plan_report',
    description: 'Submit the report plan.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        sections: {
          type: 'array',
          items: { type: 'object', properties: { title: { type: 'string' }, focus: { type: 'string', description: 'Complete brief for this section, at most 2500 characters.' } }, required: ['title', 'focus'] },
        },
      },
      required: ['title', 'subtitle', 'sections'],
    },
  };
  let plan: Plan | null = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    const res = await client.messages.create({
      model: 'claude-opus-4-8', max_tokens: 16000,
      thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
      system,
      tools: [planTool], tool_choice: { type: 'tool', name: 'plan_report' },
      messages: [{ role: 'user', content: `REPORT FOCUS (what the operator asked for): ${payload.focus || '(none — build from the conversation)'}\n\nCONVERSATION:\n${conversationText(payload)}\n\nPlan the report now${attempt ? ' — keep every focus under 1500 characters' : ''}.` }],
    });
    if (res.stop_reason === 'max_tokens') { lastErr = 'the plan ran too long'; continue; }
    const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (tu && tu.input && typeof tu.input === 'object') { plan = tu.input as Plan; break; }
    // Fallback: the model answered in text — salvage JSON if it is complete.
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const cleaned = stripFence(text);
    try { plan = JSON.parse(cleaned.slice(Math.max(0, cleaned.indexOf('{')), cleaned.lastIndexOf('}') + 1)) as Plan; } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!plan) throw new Error(`Couldn't plan the report (${lastErr || 'no plan returned'}) — try again.`);
  const sections = (plan.sections || []).filter(s => s && s.title && s.focus).slice(0, 8);
  if (!sections.length) throw new Error('The planner returned no sections — try a more specific request.');
  await patchJob(since, {
    status: 'running', step: 'section:0', stage: `Section 1 of ${sections.length} · ${sections[0].title}`,
    title: String(plan.title || `${brand.name} report`).slice(0, 200), subtitle: String(plan.subtitle || `${brand.name} · Prepared ${prettyDate}`).slice(0, 200),
    sections: sections.map(s => ({ title: String(s.title).slice(0, 120), focus: String(s.focus).slice(0, 4000), status: 'pending' as const })),
    claimedStep: undefined, claimedAt: undefined, claimToken: undefined,
  });
}

// ── Step 2: one section ────────────────────────────────────────────────────

async function runSection(since: number, index: number, payload: ReportPayload, brandBrief: string, origin: string, cookie: string): Promise<void> {
  const job = await getJob(since);
  const sections = job?.sections || [];
  const section = sections[index];
  if (!section) throw new Error(`Section ${index} not found`);
  const get = makeFetcher(origin, cookie);
  const system = `${baseContext(payload, brandBrief)}

You are building ONE SECTION of a larger report: "${job?.title}". Other sections cover the rest; stay on this section's brief. Fetch the data it needs with the tools (1–3 calls, in parallel where possible), then output ONLY an HTML FRAGMENT — one or more <section class="card"> elements — nothing else: no <html>, <head>, <style>, <script>, markdown or commentary. The page already has the stylesheet; use these classes:
- <section class="card"> wrapper (one per card; several short cards beat one tall one — each must print on one page).
- <span class="chip">N · Title</span> then <h2>.  Chip variants: chip pink / chip amber / chip green.
- Stat tiles: <div class="tiles"><div class="tile"><div class="label">…</div><div class="value">…</div><div class="delta up|down">…</div></div></div>
- Tables: <table><thead><tr><th>…</th><th class="num">…</th></tr></thead><tbody>…<td class="num">…</td></tbody></table>
- Charts: <div class="chart"><svg viewBox="0 0 720 260" …>hand-drawn bar/line chart: axis labels, gridlines #f1f5f9, value labels, legend when two series; pixel positions computed from the REAL numbers</svg></div><p class="cap">caption</p>
  Palette: violet #8b5cf6 (first series), indigo #818cf8, pink #f9a8d4, amber #fde68a, green #86efac; positive deltas green #16a34a, negative red #dc2626.
- Image cards for ads / Instagram posts / pins / blog articles: <div class="grid"><a class="item" href="{link}" target="_blank"><img src="{image}" alt="{name}"><div class="t">name</div><div class="m">numbers</div></a></div>. Use "item wide" for blog covers, "item tall" for pins. When image is "none": <div class="ph">No preview</div> instead of the img. get_ad_creatives and get_organic_content return each item's image and link — ALWAYS show them when the section covers ads or posts; never replace them with a chart of names.
- Callouts: <div class="note">…</div>, <div class="warn">…</div>, <div class="bad">…</div>.
- Lists: <ul><li>…</li></ul>.
Section number for the chip: ${index + 1}.

PRODUCT TRUTH — before writing any copy that mentions a product, call get_product_catalog and use ONLY what appears there; never feature anything marked sold out.
CONTENT DELIVERABLES — when the brief asks for copy the team will use, write every item out in full (subject line, preview, body, CTA …), never "similar to above".`;
  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: `SECTION BRIEF: ${section.title}\n${section.focus}\n\nReport focus for context: ${payload.focus || '(from conversation)'}\n\nBuild this section now.` }];
  let finalText = '';
  for (let iter = 0; iter < 6; iter++) {
    const response = await client.messages.stream({
      model: 'claude-opus-4-8', max_tokens: 14000,
      thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
      system, tools: ANALYST_TOOLS, messages,
    }).finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('The model declined to build this section.');
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages = [...messages, { role: 'assistant', content: response.content }];
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(toolUses.map(async tu => ({
        type: 'tool_result' as const, tool_use_id: tu.id,
        content: await execTool(get, tu.name, (tu.input ?? {}) as Record<string, unknown>),
      })));
      messages.push({ role: 'user', content: results });
      await patchJob(since, { stage: `Section ${index + 1} of ${sections.length} · ${section.title} — ${iter === 0 ? 'checking the numbers' : 'writing'}` });
      continue;
    }
    if (response.stop_reason === 'max_tokens') throw new Error(`Section "${section.title}" ran too long and was cut off — split it into smaller sections.`);
    finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    break;
  }
  let frag = stripFence(finalText);
  const s0 = frag.search(/<section|<div|<h2|<p|<table/i);
  if (s0 === -1) throw new Error(`Section "${section.title}" produced no HTML.`);
  frag = frag.slice(s0);
  if (!/^<section/i.test(frag)) frag = `<section class="card">${frag}</section>`;
  await saveDoc(`report_part_${since}_${index}`, frag);
  const next = index + 1 < sections.length ? `section:${index + 1}` : 'assemble';
  const updated = sections.map((s, i) => (i === index ? { ...s, status: 'done' as const } : s));
  await patchJob(since, {
    sections: updated, step: next, claimedStep: undefined, claimedAt: undefined, claimToken: undefined,
    stage: next === 'assemble' ? 'Assembling the report' : `Section ${index + 2} of ${sections.length} · ${sections[index + 1].title}`,
  });
}

// ── Step 3: assemble + save ────────────────────────────────────────────────

async function runAssemble(since: number, payload: ReportPayload, brandBrief: string): Promise<void> {
  const brand = getClient();
  const job = await getJob(since);
  const sections = job?.sections || [];
  const parts: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const frag = await loadDoc(`report_part_${since}_${i}`).catch(() => null);
    parts.push(frag || `<section class="card"><span class="chip amber">${i + 1} · ${sections[i].title}</span><div class="warn">This section could not be built.</div></section>`);
  }
  // Executive summary from the finished sections (text only, cheap call).
  let summary = '';
  try {
    const plain = parts.join('\n').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 14000);
    const res = await client.messages.create({
      model: 'claude-opus-4-8', max_tokens: 700, thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
      system: `${baseContext(payload, brandBrief)}\n\nWrite the executive summary for a finished report: 2–4 plain-language sentences with the takeaway, using ONLY numbers that appear in the section text provided. Output the sentences only — no heading, no markdown.`,
      messages: [{ role: 'user', content: `Report: ${job?.title}\n\nSECTIONS (text):\n${plain}` }],
    });
    summary = res.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  } catch { /* the report stands without it */ }
  const prettyDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });
  const title = job?.title || `${brand.name} report`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${REPORT_CSS}</style></head><body><div class="wrap">
<h1>${esc(title)}</h1><p class="sub">${esc(job?.subtitle || `${brand.name} · Prepared ${prettyDate}`)}</p>
${summary ? `<section class="card"><span class="chip">Summary</span><p style="margin:0;font-size:15px">${esc(summary)}</p></section>` : ''}
${parts.join('\n')}
<footer>Generated by ${esc(brand.analyst.name)}, ${esc(brand.name)}'s AI analyst · ${esc(prettyDate)}</footer>
</div></body></html>`;

  await patchJob(since, { stage: 'Saving the report' });
  if (!payload.email) throw new Error('No signed-in user to save the report for');
  const meta = await saveReport(payload.email, title.slice(0, 200), injectToolbar(html, true));
  await patchJob(since, { status: 'done', step: 'done', stage: 'Done', reportId: meta.id, claimedStep: undefined, claimedAt: undefined, claimToken: undefined });
  // Browser notification to whoever asked (best-effort).
  try {
    const { notifyUser } = await import('@/src/lib/push');
    await notifyUser(payload.email, 'reports', { title: `${brand.analyst.name} finished your report`, body: title.slice(0, 120), url: `${brand.dashboardUrl.replace(/\/$/, '')}/dashboard/insights/report?saved=${encodeURIComponent(meta.id)}`, tag: `report-${since}` });
  } catch { /* the report is saved regardless */ }
}

// ── Orchestration ──────────────────────────────────────────────────────────

export type StepResult = { ran: boolean; job: ReportJob | null; reason?: string };

/**
 * Run the job's CURRENT step once. Idempotent: a step another runner claimed
 * within the last few minutes is left alone; a claim older than that is
 * presumed dead (platform killed the run) and taken over.
 */
export async function runStep(since: number, origin: string, cookie: string): Promise<StepResult> {
  const job = await getJob(since);
  if (!job) return { ran: false, job: null, reason: 'unknown job' };
  if (job.status !== 'running') return { ran: false, job, reason: job.status };
  const step = job.step || 'plan';
  if (job.claimedStep === step && job.claimedAt && Date.now() - Date.parse(job.claimedAt) < STEP_TIMEOUT_MS) {
    return { ran: false, job, reason: 'in progress' };
  }
  // Claim the step. Two runners can arrive within the same second (the chat
  // banner and the viewer both nudge), so after writing the claim re-read it
  // and stand down if someone else's token won.
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await patchJob(since, { claimedStep: step, claimedAt: new Date().toISOString(), claimToken: token });
  await new Promise(r => setTimeout(r, 500));
  const check = await getJob(since);
  if (check && check.claimToken && check.claimToken !== token) return { ran: false, job: check, reason: 'in progress' };
  const payload = await loadPayload(since);
  if (!payload) { const j = await patchJob(since, { status: 'error', error: 'Report brief not found — start the report again.' }); return { ran: true, job: j }; }
  const { getBrandBrief } = await import('@/src/lib/brandBrief');
  const brandBrief = await getBrandBrief().catch(() => getClient().brand.description);
  try {
    if (step === 'plan') await runPlan(since, payload, brandBrief);
    else if (step.startsWith('section:')) await runSection(since, Number(step.slice(8)), payload, brandBrief, origin, cookie);
    else if (step === 'assemble') await runAssemble(since, payload, brandBrief);
    else return { ran: false, job, reason: `unknown step ${step}` };
    return { ran: true, job: await getJob(since) };
  } catch (err) {
    const j = await patchJob(since, { status: 'error', error: friendlyAiError(err), claimedStep: undefined, claimedAt: undefined, claimToken: undefined });
    return { ran: true, job: j };
  }
}

/** Run steps back to back until done/error or the time budget is spent. */
export async function runUntilDone(since: number, origin: string, cookie: string, budgetMs: number): Promise<ReportJob | null> {
  const start = Date.now();
  let last: ReportJob | null = null;
  for (let i = 0; i < 12; i++) {
    const r = await runStep(since, origin, cookie);
    last = r.job;
    if (!r.ran || !last || last.status !== 'running') break;
    if (Date.now() - start > budgetMs) break;
  }
  return last;
}
