'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Cleo — the AI analyst chat, available on every dashboard tab as a floating
// bubble. Fullscreen on mobile, a docked panel on desktop. Conversations are
// cached per-login in localStorage and synced to the server chat store.

const CHAT_KEY = 'rocknot_ai_analyst_chat';

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

function ConversationView({ chat, asking, endRef }: { chat: ChatMsg[]; asking: boolean; endRef: React.RefObject<HTMLDivElement> }) {
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
            <span className="ml-2">crunching the numbers…</span>
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
  const endRef = useRef<HTMLDivElement>(null);
  const { data: session, status: sessionStatus } = useSession();
  // Scope saved chat to the signed-in user so it never leaks across logins on a shared device.
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

    // Server copy (keyed to the login) wins when it's ahead of this device;
    // otherwise push the local copy up so it's backed up and synced.
    let cancelled = false;
    fetch('/api/insights/chat', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: { configured?: boolean; messages?: ChatMsg[] }) => {
        if (cancelled || !d?.configured) return;
        const server = Array.isArray(d.messages) ? d.messages : [];
        if (server.length > local.length) {
          setChat(server);
          try { localStorage.setItem(chatKey, JSON.stringify(server)); } catch { /* ignore */ }
        } else if (local.length > server.length) {
          fetch('/api/insights/chat', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: local }),
          }).catch(() => {});
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
      try { localStorage.setItem(chatKey, JSON.stringify(withAnswer.slice(-24))); } catch { /* ignore */ }
      // Back up to the server (keyed to the login) — best-effort.
      fetch('/api/insights/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: withAnswer.slice(-24) }),
      }).catch(() => {});
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Something went wrong');
      setChat(chat); // roll back the optimistic user message on failure
      setQuestion(text);
    } finally {
      setAsking(false);
    }
  }

  function clearChat() {
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
  function createReport() {
    if (!chat.some(m => m.role === 'assistant')) return;
    try { localStorage.setItem(chatKey, JSON.stringify(chat.slice(-24))); } catch { /* ignore */ }
    window.open(`/dashboard/insights/report?k=${encodeURIComponent(chatKey)}`, '_blank');
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
              <button
                onClick={createReport}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-100 font-semibold"
              >
                📊 Report
              </button>
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
