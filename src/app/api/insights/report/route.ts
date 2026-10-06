import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/src/lib/client';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { isChatStoreConfigured, getReport } from '@/src/lib/chatStore';
import { waitUntil } from '@vercel/functions';
import { type ChatMessage, getJob, patchJob, savePayload, runStep, runUntilDone } from '@/src/lib/reportBuilder';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Report builds are a staged pipeline (see src/lib/reportBuilder.ts):
//   plan → section:0 … section:n → assemble (summary + save)
// Each step is a separate short run that persists its output, so a report
// of any size survives the platform's per-run limit. Three ways in:
//   • kickoff  {messages, focus, since}       — save the brief, start, answer 202
//   • resume   {since, resume: true}          — run the job's CURRENT step once
//                                               (idempotent; the chat banner and
//                                               the viewer tab call this whenever
//                                               the job looks idle)
//   • legacy   {messages, focus} (no since)   — build inline and return the HTML
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: { messages?: ChatMessage[]; focus?: string; since?: number; wait?: boolean; resume?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get('cookie') || '';

  // ── Resume: advance a persisted job by one step ───────────────────────────
  if (body.resume) {
    const since = Number(body.since || 0) || 0;
    if (!since) return NextResponse.json({ error: 'since required' }, { status: 400 });
    if (authConfigured()) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const before = await getJob(since);
    if (!before) return NextResponse.json({ error: 'Unknown report job' }, { status: 404 });
    const r = await runStep(since, origin, cookie);
    return NextResponse.json({ ok: true, ran: r.ran, reason: r.reason, status: r.job?.status, step: r.job?.step, stage: r.job?.stage, reportId: r.job?.reportId }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Kickoff / legacy: validate the brief ─────────────────────────────────
  // The focus is the builder's full brief — never truncate it to a sentence.
  const focus = (body.focus || '').trim().slice(0, 6000);
  const history = (body.messages ?? [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-40);
  if (!focus && !history.some(m => m.role === 'assistant')) {
    return NextResponse.json({ error: `Ask ${getClient().analyst.name} at least one question first — the report is built from the conversation.` }, { status: 400 });
  }

  // Resolve the signed-in user NOW (the request is still open); later steps
  // run without a request to read from and save the report for this user.
  let email: string | null = null;
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    email = session?.user?.email?.toLowerCase() || null;
    if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (!isChatStoreConfigured()) {
    return NextResponse.json({ error: 'Report storage not configured (PRIVATE_SHEET_ID / GCP_SERVICE_ACCOUNT_KEY)' }, { status: 500 });
  }

  const since = Number(body.since || 0) || Date.now();
  const existing = await getJob(since);
  if (existing) {
    // Same job id posted twice (chat retry) — never start a second build.
    return NextResponse.json({ queued: true, since, alreadyHandled: true, status: existing.status }, { status: 202 });
  }
  try {
    await savePayload(since, { messages: history, focus, email });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't save the report brief: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  await patchJob(since, { status: 'running', step: 'plan', stage: 'Planning the report', claimedStep: undefined, claimedAt: undefined, claimToken: undefined });

  // Kickoff: hand the first steps to the platform and answer at once. The
  // browser's connection is no longer part of the job — and if the platform
  // freezes this background work, the chat banner / viewer resume it.
  if (body.since && !body.wait) {
    try {
      waitUntil(runUntilDone(since, origin, cookie, 100000));
      return NextResponse.json({ queued: true, since }, { status: 202 });
    } catch {
      // No request context to attach to (local dev without the Vercel
      // runtime) — fall through and build inline.
    }
  }

  // Legacy / wait: build inline within this run's budget and return the HTML.
  const job = await runUntilDone(since, origin, cookie, 150000);
  if (job?.status === 'error') return NextResponse.json({ error: job.error || 'Report generation failed', since }, { status: 502 });
  if (job?.status === 'done' && job.reportId && email) {
    // Saved copies already carry the Share / PDF toolbar.
    const html = await getReport(email, job.reportId).catch(() => null);
    if (html) return NextResponse.json({ ok: true, html, reportId: job.reportId, since });
    return NextResponse.json({ ok: true, reportId: job.reportId, since });
  }
  // Still running (a big report) — the caller can follow it by job id.
  return NextResponse.json({ queued: true, since, status: job?.status, stage: job?.stage }, { status: 202 });
}
