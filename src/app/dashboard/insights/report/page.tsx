'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const CHAT_KEY_PREFIX = 'rocknot_ai_analyst_chat';

// Standalone report tab: reads the saved conversation, builds the report from
// THIS tab (so iOS backgrounding the dashboard tab can't strand the request),
// then replaces the whole document with the finished report HTML.
function ReportBuilder() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (status !== 'working') return;
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function build() {
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
      if (!Array.isArray(chat) || !chat.length) {
        setStatus('error'); setError('No conversation found — ask Cleo a question first, then create the report from the same device.'); return;
      }
      // scope=last (the default): report only the most recent question & its
      // answer, not the whole conversation history.
      if (params.get('scope') !== 'all') {
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
      try {
        const res = await fetch('/api/insights/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chat }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.html) throw new Error(data?.error || `Report generation failed (${res.status})`);
        document.open();
        document.write(data.html);
        document.close();
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Report generation failed');
      }
    }
    build();
  }, [params]);

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        {status === 'working' ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center text-2xl mx-auto mb-4 animate-pulse">✦</div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Cleo is building your report…</p>
            <p className="text-xs text-gray-400 mb-2">Re-checking the numbers and drawing the charts. This can take a few minutes for bigger questions. ({elapsed}s)</p>
            <p className="text-[11px] text-gray-400">You don&apos;t have to wait here — the finished report is saved automatically and will appear under <strong>Saved reports</strong> on the AI Insights tab.</p>
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
