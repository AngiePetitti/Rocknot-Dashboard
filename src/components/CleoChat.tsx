'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useClient } from '@/src/components/ClientProvider';

// Cleo — the AI analyst chat, available on every dashboard tab as a floating
// bubble. Fullscreen on mobile, a docked panel on desktop. Conversations are
// cached per-login in localStorage and synced to the server chat store.


const SUGGESTED_QUESTIONS = [
  'Which products should we put more ad spend behind, and why?',
  'Why did CAC move over the last month?',
  'What are our best and worst days of the week for revenue?',
  'Which slow-moving inventory should we discount first?',
];

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

function isMobile(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

// Compact, readable rendering for Cleo's answers (bold, bullets, tables).
function AnswerMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-gray-800">{children}</strong>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-snug">{children}</li>,
        h1: ({ children }) => <p className="font-bold text-gray-800 mb-1">{children}</p>,
        h2: ({ children }) => <p className="font-bold text-gray-800 mb-1">{children}</p>,
        h3: ({ children }) => <p className="font-bold text-gray-800 mb-1">{children}</p>,
        code: ({ children }) => <code className="bg-gray-100 rounded px-1 text-[12px]">{children}</code>,
        table: ({ children }) => (
          <div className="overflow-x-auto -mx-1 mb-2">
            <table className="text-xs border-collapse min-w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="text-left font-semibold text-gray-500 border-b border-gray-200 px-2 py-1 whitespace-nowrap">{children}</th>,
        td: ({ children }) => <td className="border-b border-gray-100 px-2 py-1 whitespace-nowrap">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// Generic, rotating working states — "crunching the numbers" read oddly on
// non-numeric asks (task creation, briefs).
const THINKING_PHRASES = ['thinking…', 'putting that together…', 'on it…', 'working on it…', 'one sec…'];

function ConversationView({ chat, asking, endRef }: { chat: ChatMsg[]; asking: boolean; endRef: React.RefObject<HTMLDivElement> }) {
  // Pick a phrase per ask, and rotate if it runs long.
  const [thinkingPhrase, setThinkingPhrase] = useState(0);
  useEffect(() => {
    if (!asking) return;
    setThinkingPhrase(Math.floor(Math.random() * THINKING_PHRASES.length));
    const t = setInterval(() => setThinkingPhrase(p => (p + 1) % THINKING_PHRASES.length), 6000);
    return () => clearInterval(t);
  }, [asking]);
  return (
    <>
      {chat.map((msg, i) => (
        <div key={i} className={`flex min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[92%] sm:max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 text-sm break-words ${
            msg.role === 'user' ? 'bg-violet-600 text-white leading-relaxed' : 'bg-gray-50 text-gray-700 border border-gray-100'
          }`}>
            {msg.role === 'assistant' ? <AnswerMarkdown text={msg.content} /> : msg.content}
          </div>
        </div>
      ))}
      {asking && (
        <div className="flex justify-start">
          <div className="bg-gray-50 border border-gray-100 rounded-2xl px-3.5 py-2.5 text-sm text-gray-400">
            <span className="inline-flex gap-1">
              <span className="animate-bounce">·</span>
              <span className="animate-bounce" style={{ animationDelay: '0.15s' }}>·</span>
              <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>·</span>
            </span>
            <span className="ml-2">{THINKING_PHRASES[thinkingPhrase]}</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </>
  );
}

export default function CleoChat() {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // ── Voice input (browser speech recognition, where supported) ──
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  function toggleVoice() {
    if (listening) { recRef.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    interface SpeechRec {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setQuestion((finalText + interim).trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }
  const [reportMenu, setReportMenu] = useState(false);
  const [reportLink, setReportLink] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { data: session, status: sessionStatus } = useSession();
  // Scope saved chat to the signed-in user so it never leaks across logins on a shared device.
  const client = useClient();
  const CHAT_KEY = `${client.storagePrefix}_ai_analyst_chat`;
  const chatKey = session?.user?.email ? `${CHAT_KEY}:${session.user.email.toLowerCase()}` : CHAT_KEY;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat, asking, open]);

  // Other components (e.g. the Insights tab card) can open Cleo via this event.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-cleo', handler);
    return () => window.removeEventListener('open-cleo', handler);
  }, []);

  // Lock the page behind the fullscreen chat (mobile) so swipes only move the chat.
  useEffect(() => {
    if (open && isMobile()) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    let local: ChatMsg[] = [];
    try {
      let raw = localStorage.getItem(chatKey);
      // Migrate any history saved under the old shared (non-scoped) key.
      if (chatKey !== CHAT_KEY) {
        const legacy = localStorage.getItem(CHAT_KEY);
        if (legacy) {
          if (!raw) { localStorage.setItem(chatKey, legacy); raw = legacy; }
          localStorage.removeItem(CHAT_KEY);
        }
      }
      if (raw) local = JSON.parse(raw);
    } catch { /* ignore */ }
    if (local.length) setChat(local);

    // Server copy (keyed to the login) is the source of truth across devices.
    // The old rule was "longer copy wins", which let a STALE-but-longer local
    // history overwrite the server and destroy a newer conversation from
    // another device. Now: the server wins whenever this device has nothing
    // unsynced (tracked via a synced-snapshot hash); genuinely-new local
    // messages are pushed up only when the server has nothing newer.
    const syncKey = `${chatKey}:synced`;
    let lastSynced = '';
    try { lastSynced = localStorage.getItem(syncKey) || ''; } catch { /* ignore */ }
    const localStr = JSON.stringify(local);
    let cancelled = false;
    fetch('/api/insights/chat', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: { configured?: boolean; messages?: ChatMsg[] }) => {
        if (cancelled || !d?.configured) return;
        const server = Array.isArray(d.messages) ? d.messages : [];
        const serverStr = JSON.stringify(server);
        const localUnsynced = localStr !== lastSynced && local.length > 0;
        if (serverStr !== localStr && (server.length > 0 || !localUnsynced)) {
          if (!localUnsynced || server.length >= local.length) {
            // Adopt the server copy — this device has nothing newer.
            setChat(server);
            try {
              localStorage.setItem(chatKey, serverStr);
              localStorage.setItem(syncKey, serverStr);
            } catch { /* ignore */ }
            return;
          }
        }
        if (localUnsynced && local.length > server.length) {
          // This device holds messages the server never got (e.g. the backup
          // request died mid-session) — push them up.
          fetch('/api/insights/chat', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: local }),
          }).then(() => { try { localStorage.setItem(syncKey, localStr); } catch { /* ignore */ } }).catch(() => {});
        } else {
          try { localStorage.setItem(syncKey, localStr); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chatKey, sessionStatus]);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || asking) return;
    const next: ChatMsg[] = [...chat, { role: 'user', content: text }];
    setChat(next);
    setQuestion('');
    setAsking(true);
    setAskError(null);
    try {
      const res = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong');
      const withAnswer: ChatMsg[] = [...next, { role: 'assistant', content: data.answer }];
      setChat(withAnswer);
      // Voice conversation: a dictated question gets a spoken answer.
      try {
        const snap = JSON.stringify(withAnswer.slice(-24));
        localStorage.setItem(chatKey, snap);
        localStorage.setItem(`${chatKey}:synced`, snap);
      } catch { /* ignore */ }
      // Back up to the server (keyed to the login) — best-effort.
      fetch('/api/insights/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: withAnswer.slice(-24) }),
      }).catch(() => {});
      // Cleo decided to build a report — start it in the background right away
      // and open a viewer tab (tap-through link if the popup is blocked).
      if (typeof data.reportFocus === 'string' && data.reportFocus) {
        kickoffReport({ messages: withAnswer.slice(-8), focus: data.reportFocus });
      }
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Something went wrong');
      setChat(chat); // roll back the optimistic user message on failure
      setQuestion(text);
    } finally {
      setAsking(false);
    }
  }

  function clearChat() {
    if (!confirm('Clear this conversation everywhere? It syncs across your devices, so this deletes it on all of them.')) return;
    setChat([]);
    setAskError(null);
    try { localStorage.removeItem(chatKey); } catch { /* ignore */ }
    fetch('/api/insights/chat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    }).catch(() => {});
  }

  // Turn the current conversation into a shareable visual report. Opens a
  // dedicated tab that builds the report itself, so backgrounding this tab
  // (common on iOS) can't strand the request.
  // Kick off report generation IMMEDIATELY in the background (the server
  // auto-saves the result), then open a viewer tab that just waits for it.
  // The viewer can be closed or backgrounded freely — generation continues.
  function kickoffReport(payload: { messages: ChatMsg[]; focus?: string }): void {
    const since = Date.now();
    const body = JSON.stringify(payload);
    try {
      // keepalive lets the request survive tab switches (64KB body limit).
      // Record failures so the viewer tab can surface them instead of
      // polling forever for a report that will never arrive.
      fetch('/api/insights/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: body.length < 60000,
      })
        .then(async r => {
          const d = await r.json().catch(() => null);
          const problem = !r.ok ? (d?.error || `Report generation failed (HTTP ${r.status})`) : d?.saveError ? `Report built but saving failed: ${d.saveError}` : null;
          if (problem) { try { localStorage.setItem(`rk_report_err_${since}`, problem); } catch { /* ignore */ } }
        })
        .catch(e => { try { localStorage.setItem(`rk_report_err_${since}`, `Report request died: ${String(e)}`); } catch { /* ignore */ } });
    } catch { /* ignore */ }
    const url = `/dashboard/insights/report?since=${since}`;
    const w = window.open(url, '_blank');
    setReportLink(w ? null : url);
  }

  function createReport(scope: 'last' | 'all') {
    if (!chat.some(m => m.role === 'assistant')) return;
    setReportMenu(false);
    let msgs = chat;
    if (scope === 'last') {
      let lastAssistant = -1;
      for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === 'assistant') { lastAssistant = i; break; }
      let lastUser = -1;
      for (let i = lastAssistant - 1; i >= 0; i--) if (chat[i].role === 'user') { lastUser = i; break; }
      if (lastUser !== -1 && lastAssistant !== -1) msgs = chat.slice(lastUser, lastAssistant + 1);
    }
    kickoffReport({ messages: msgs });
  }

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Cleo"
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-pink-400 text-white shadow-lg shadow-violet-300/50 flex items-center justify-center text-2xl hover:scale-105 active:scale-95 transition-transform"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          💬
        </button>
      )}

      {/* Chat panel — fullscreen on mobile, docked card on desktop */}
      {open && (
        <div className="fixed z-50 bg-white flex flex-col inset-x-0 top-0 h-[100dvh] md:inset-auto md:bottom-5 md:right-5 md:top-auto md:h-[min(640px,calc(100dvh-3rem))] md:w-[400px] md:rounded-2xl md:border md:border-gray-200 md:shadow-2xl md:overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-100 to-pink-100 flex items-center justify-center text-base shrink-0">💬</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 leading-tight">Cleo</p>
              <p className="text-[10px] text-gray-400 leading-tight">Your AI analyst — live data, any period</p>
            </div>
            {chat.some(m => m.role === 'assistant') && (
              <div className="relative">
                <button
                  onClick={() => setReportMenu(v => !v)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-100 font-semibold"
                >
                  📊 Report
                </button>
                {reportMenu && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 overflow-hidden">
                    <button
                      onClick={() => createReport('last')}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50"
                    >
                      <span className="font-semibold text-gray-800 block">This question only</span>
                      <span className="text-gray-400">Report on the last question &amp; answer</span>
                    </button>
                    <button
                      onClick={() => createReport('all')}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50"
                    >
                      <span className="font-semibold text-gray-800 block">Whole conversation</span>
                      <span className="text-gray-400">Everything discussed in this chat</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {chat.length > 0 && (
              <button onClick={clearChat} className="text-xs text-gray-400 hover:text-gray-600 font-medium px-1">Clear</button>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 space-y-3">
            {chat.length === 0 && !asking && (
              <div className="pt-6">
                <p className="text-xs text-gray-400 mb-3 text-center">Ask Cleo anything about your sales, ads, inventory, or calendar — any time period.</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => ask(q)}
                      className="text-xs px-3 py-2.5 rounded-xl bg-violet-50 text-violet-800 border border-violet-100 text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <ConversationView chat={chat} asking={asking} endRef={endRef} />
            {reportLink && (
              <div className="flex justify-start">
                <a
                  href={reportLink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setReportLink(null)}
                  className="text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-100 rounded-2xl px-3.5 py-2.5"
                >
                  📊 Report is building in the background — tap to watch, or find it in Saved reports when done
                </a>
              </div>
            )}
            {askError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{askError}</div>
            )}
          </div>

          {/* Input pinned at the bottom */}
          <form
            onSubmit={e => { e.preventDefault(); ask(); }}
            className="flex gap-2 px-3 py-3 border-t border-gray-100 shrink-0"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask Cleo…"
              disabled={asking}
              className="flex-1 min-w-0 px-3.5 py-2.5 text-base md:text-sm border border-gray-200 rounded-xl bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-60"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={asking}
                aria-label={listening ? 'Stop dictation' : 'Dictate your question'}
                className={`px-3 py-2.5 rounded-xl border text-base transition-colors ${listening ? 'bg-red-50 border-red-300 animate-pulse' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
              >
                {listening ? '🔴' : '🎤'}
              </button>
            )}
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {asking ? '…' : 'Ask'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
