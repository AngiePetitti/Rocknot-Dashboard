'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const CHAT_KEY_PREFIX = 'rocknot_ai_analyst_chat';

// Standalone report tab: reads the saved conversation, builds the report from
// THIS tab (so iOS backgrounding the dashboard tab can't strand the request),
// then replaces the whole document with the finished report HTML.
function ReportBuilder() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'working' | 'waiting' | 'error'>('working');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const baselineIds = useRef<Set<string>>(new Set());

  function render(html: string) {
    document.open();
    document.write(html);
    document.close();
  }

  // The generation request died (iOS suspends fetches when the tab is
  // backgrounded) — but the server keeps working and auto-saves the finished
  // report. Watch the saved list and open the new report when it appears.
  async function waitForAutoSaved() {
    setStatus('waiting');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const res = await fetch('/api/insights/reports', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        const fresh = (data?.reports as { id: string }[] | undefined)?.find(r => !baselineIds.current.has(r.id));
        if (fresh) {
          const rep = await fetch(`/api/insights/reports/${encodeURIComponent(fresh.id)}`, { cache: 'no-store' });
          const repData = await rep.json().catch(() => null);
          if (repData?.html) { render(repData.html); return; }
        }
      } catch { /* keep polling */ }
    }
    setStatus('error');
    setError('The report is taking unusually long. Check Saved reports on the AI Insights tab in a few minutes, or try again.');
  }

  useEffect(() => {
    if (status === 'error') return;
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function build() {
      // Viewer mode: generation was already started in the background by the
      // chat; this tab just waits for the auto-saved result and shows it.
      // Backgrounding or closing this tab never affects the report.
      const since = Number(params.get('since') || 0);
      if (since) {
        setStatus('working');
        for (let i = 0; i < 150; i++) {
          try {
            const res = await fetch('/api/insights/reports', { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            const reports = (data?.reports as { id: string; createdAt: string }[] | undefined) ?? [];
            // 2-minute clock-skew allowance between this device and the server.
            const fresh = reports.find(r => Date.parse(r.createdAt) >= since - 120000);
            if (fresh) {
              const rep = await fetch(`/api/insights/reports/${encodeURIComponent(fresh.id)}`, { cache: 'no-store' });
              const repData = await rep.json().catch(() => null);
              if (repData?.html) { render(repData.html); return; }
            }
          } catch { /* keep polling */ }
          await new Promise(r => setTimeout(r, 4000));
        }
        setStatus('error');
        setError('The report is taking unusually long. Check Saved reports on the AI Insights tab in a few minutes.');
        return;
      }

      // Opening a previously saved report — fetch it and render, no generation.
      const savedId = params.get('saved');
      if (savedId) {
        try {
          const res = await fetch(`/api/insights/reports/${encodeURIComponent(savedId)}`, { cache: 'no-store' });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.html) throw new Error(data?.error || `Couldn't load the saved report (${res.status})`);
          document.open();
          document.write(data.html);
          document.close();
        } catch (e) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Couldn\'t load the saved report');
        }
        return;
      }

      const key = params.get('k') || CHAT_KEY_PREFIX;
      if (!key.startsWith(CHAT_KEY_PREFIX)) {
        setStatus('error'); setError('Invalid report link.'); return;
      }
      let chat: unknown[] = [];
      try { chat = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* fall through */ }
      if (!Array.isArray(chat) || !chat.length) {
        // No local copy on this device — try the server-synced conversation.
        try {
          const r = await fetch('/api/insights/chat', { cache: 'no-store' });
          const d = await r.json();
          if (Array.isArray(d?.messages)) chat = d.messages;
        } catch { /* fall through */ }
      }
      const focus = params.get('focus') || '';
      if (!Array.isArray(chat)) chat = [];
      if (!chat.length && !focus) {
        setStatus('error'); setError('No conversation found — ask Cleo a question first, then create the report from the same device.'); return;
      }
      // scope=last (the default): report only the most recent question & its
      // answer, not the whole conversation history. With an explicit focus
      // (Cleo-initiated), send the recent conversation as context instead.
      if (!focus && params.get('scope') !== 'all') {
        const msgs = chat as { role?: string }[];
        let lastAssistant = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i]?.role === 'assistant') { lastAssistant = i; break; }
        }
        if (lastAssistant > 0) {
          let lastUser = -1;
          for (let i = lastAssistant - 1; i >= 0; i--) {
            if (msgs[i]?.role === 'user') { lastUser = i; break; }
          }
          if (lastUser !== -1) chat = chat.slice(lastUser, lastAssistant + 1);
        }
      }
      // Snapshot existing report ids so we can spot the auto-saved new one if
      // the request dies while this tab is backgrounded.
      try {
        const res = await fetch('/api/insights/reports', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        for (const r of (data?.reports as { id: string }[] | undefined) ?? []) baselineIds.current.add(r.id);
      } catch { /* non-fatal */ }

      try {
        const res = await fetch('/api/insights/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(focus ? { messages: chat.slice(-8), focus } : { messages: chat }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.html) {
          // The server answered but with an error — a real failure.
          setStatus('error');
          setError((data?.error as string) || `Report generation failed (${res.status})`);
          return;
        }
        render(data.html);
      } catch {
        // Network died mid-flight (usually iOS backgrounding) — the server is
        // still working. Switch to watching for the auto-saved result.
        waitForAutoSaved();
      }
    }
    build();
  }, [params]);

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        {status === 'waiting' ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center text-2xl mx-auto mb-4 animate-pulse">✦</div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Still building — reconnecting…</p>
            <p className="text-xs text-gray-400 mb-2">This tab lost its connection (that happens when you switch apps), but Cleo is still working. The report will appear here the moment it&apos;s ready. ({elapsed}s)</p>
            <p className="text-[11px] text-gray-400">It&apos;s also saved automatically under <strong>Saved reports</strong> on the AI Insights tab.</p>
          </>
        ) : status === 'working' ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center text-2xl mx-auto mb-4 animate-pulse">✦</div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Cleo is building your report…</p>
            <p className="text-xs text-gray-400 mb-2">Re-checking the numbers and drawing the charts. This can take a few minutes for bigger questions. ({elapsed}s)</p>
            <p className="text-[11px] text-gray-400">You don&apos;t have to wait here — it builds in the background even if you close this tab, and lands under <strong>Saved reports</strong> on the AI Insights tab.</p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-2xl mx-auto mb-4">⚠️</div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Couldn&apos;t build the report</p>
            <p className="text-xs text-gray-500 mb-4 break-words">{error}</p>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportBuilder />
    </Suspense>
  );
}
