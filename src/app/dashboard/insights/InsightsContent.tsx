'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';

// Compact, readable rendering for analyst answers (bold, bullets, tables).
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

interface Insight {
  title: string;
  insight: string;
}

interface InsightSet {
  summary?: string;
  creatives: Insight[];
  products: Insight[];
  promos: Insight[];
  retention: Insight[];
}

interface Snapshot {
  dateFrom: string;
  dateTo: string;
  label: string;
  compareLabel: string | null;
  metrics: Record<string, number>;
  productsCount: number;
  platforms: string[];
  hasInventoryContext?: boolean;
  hasCalendarContext?: boolean;
}

const STORAGE_KEY = 'rocknot_ai_insights_last';
const CHAT_KEY = 'rocknot_ai_analyst_chat';

interface ChatMsg { role: 'user' | 'assistant'; content: string }

function isMobile(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

// Message list shared by the inline (desktop) card and the fullscreen mobile chat.
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

const SUGGESTED_QUESTIONS = [
  'Which products should we put more ad spend behind, and why?',
  'Why did CAC move over the last month?',
  'What are our best and worst days of the week for revenue?',
  'Which slow-moving inventory should we discount first?',
];

const CATEGORIES = [
  { key: 'creatives' as const, label: 'Ad Creative Ideas', icon: '🎨', accentColor: '#818cf8', bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-400', description: 'New angles, hooks & formats to test' },
  { key: 'products' as const, label: 'Product Opportunities', icon: '📦', accentColor: '#f9a8d4', bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-400', description: 'Colorways, bundles & variants to explore' },
  { key: 'promos' as const, label: 'Promos & Events', icon: '🎯', accentColor: '#fde68a', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', description: 'Sale timing, campaigns & seasonal plays' },
  { key: 'retention' as const, label: 'Retention & Growth', icon: '👥', accentColor: '#86efac', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-400', description: 'Win-back, loyalty & customer growth' },
];

const TIMEFRAMES = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: 'ytd', label: 'Year to date' },
  { divider: true },
  { value: 'q4_last', label: 'Q4 Last Year', badge: 'Holiday' },
  { value: 'holiday_last', label: 'Holiday Season', badge: 'Nov–Dec' },
  { value: 'q3_last', label: 'Q3 Last Year' },
  { divider: true },
  { value: 'q1', label: 'Q1 This Year' },
  { value: 'q2', label: 'Q2 This Year' },
  { value: 'q3', label: 'Q3 This Year' },
  { value: 'q4', label: 'Q4 This Year' },
  { divider: true },
  { value: 'custom', label: 'Custom range…' },
] as const;

type TfValue = 'custom' | '30d' | '90d' | '6m' | 'ytd' | 'q4_last' | 'holiday_last' | 'q3_last' | 'q1' | 'q2' | 'q3' | 'q4';

function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 bg-gray-200 rounded w-2/5" />
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-4/5" />
        </div>
      ))}
    </div>
  );
}

export default function InsightsContent() {
  const [insights, setInsights] = useState<InsightSet | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const [tf, setTf] = useState<TfValue>('30d');
  const [compareMode, setCompareMode] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showTfMenu, setShowTfMenu] = useState(false);

  const currentTfItem = TIMEFRAMES.find(t => 'value' in t && t.value === tf);
  const currentTfLabel = currentTfItem && 'label' in currentTfItem ? currentTfItem.label : 'Last 30 days';

  // ── Ask the Analyst chat ──
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false); // fullscreen chat (mobile)
  const { data: session, status: sessionStatus } = useSession();
  // Scope saved chat to the signed-in user so it never leaks across logins on a shared device.
  const chatKey = session?.user?.email ? `${CHAT_KEY}:${session.user.email.toLowerCase()}` : CHAT_KEY;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const overlayEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    overlayEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat, asking, chatOpen]);

  // Lock the page behind the fullscreen chat so swipes only move the chat.
  useEffect(() => {
    if (chatOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [chatOpen]);

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
    if (isMobile()) setChatOpen(true); // answer arrives in the fullscreen chat
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

  // Turn the current conversation into a shareable visual report. Opens a
  // dedicated tab that builds the report itself, so backgrounding this tab
  // (common on iOS) can't strand the request.
  function createReport() {
    if (!chat.some(m => m.role === 'assistant')) return;
    try { localStorage.setItem(chatKey, JSON.stringify(chat.slice(-24))); } catch { /* ignore */ }
    window.open(`/dashboard/insights/report?k=${encodeURIComponent(chatKey)}`, '_blank');
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

  // Restore the last generation so insights survive a reload / tab switch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.insights) {
        setInsights(saved.insights);
        setSnapshot(saved.snapshot ?? null);
        if (saved.generatedAt) setGeneratedAt(new Date(saved.generatedAt));
        if (saved.tf) setTf(saved.tf);
        if (typeof saved.compareMode === 'boolean') setCompareMode(saved.compareMode);
      }
    } catch { /* corrupt cache — ignore */ }
  }, []);

  async function generate() {
    if (tf === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(null);
    try {
      let url = `/api/insights?tf=${tf}&compare=${compareMode}`;
      if (tf === 'custom') url += `&date_from=${customFrom}&date_to=${customTo}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setInsights(data.insights);
      setSnapshot(data.snapshot);
      const now = new Date();
      setGeneratedAt(now);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          insights: data.insights, snapshot: data.snapshot, generatedAt: now.toISOString(), tf, compareMode,
        }));
      } catch { /* storage full — non-fatal */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const hasInsights = insights && !loading;
  const canGenerate = tf !== 'custom' || (customFrom && customTo);

  return (
    <div>
      <Header title="AI Insights" subtitle="Data-driven ideas powered by Claude">
        <button
          onClick={generate}
          disabled={loading || !canGenerate}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Analyzing…
            </>
          ) : (
            <>
              <span>✦</span>
              {insights ? 'Refresh' : 'Generate Insights'}
            </>
          )}
        </button>
      </Header>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Timeframe picker */}
        <div className="relative">
          <button
            onClick={() => setShowTfMenu(v => !v)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 hover:border-violet-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 6h14M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            {currentTfLabel}
            <svg className="w-3 h-3 text-gray-400" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {showTfMenu && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
              {TIMEFRAMES.map((item, i) => {
                if ('divider' in item) return <div key={i} className="h-px bg-gray-100 my-1" />;
                return (
                  <button
                    key={item.value}
                    onClick={() => { setTf(item.value as TfValue); setShowTfMenu(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-violet-50 transition-colors ${tf === item.value ? 'text-violet-700 font-semibold bg-violet-50' : 'text-gray-700'}`}
                  >
                    <span>{item.label}</span>
                    {'badge' in item && item.badge && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom date range */}
        {tf === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
        )}

        {/* Compare toggle */}
        <button
          onClick={() => setCompareMode(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
            compareMode
              ? 'bg-violet-600 border-violet-600 text-white'
              : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          Compare vs Q4 Last Year
        </button>

        {showTfMenu && (
          <div className="fixed inset-0 z-10" onClick={() => setShowTfMenu(false)} />
        )}
      </div>

      {/* Compare info pill */}
      {compareMode && (
        <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-violet-700">
          <span>✦</span>
          <span>Claude will analyze <strong>{currentTfLabel}</strong> vs <strong>Q4 last year</strong> and highlight what changed, what worked, and what to do differently.</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Ask the Analyst ── */}
      <Card accentColor="#67e8f9" className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-xl bg-cyan-50 flex items-center justify-center text-base shrink-0">💬</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-800">Ask Cleo</p>
            <p className="text-[10px] text-gray-400">Cleo is your AI analyst — she queries your live sales, ads, inventory & calendar data for whatever period your question needs, and shows the math.</p>
          </div>
          {chat.some(m => m.role === 'assistant') && (
            <button
              onClick={createReport}
              className="hidden md:flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-100 font-semibold transition-colors"
            >
              📊 Create report
            </button>
          )}
          {chat.length > 0 && (
            <button onClick={clearChat} className="text-[11px] text-gray-400 hover:text-gray-600 font-medium">Clear</button>
          )}
        </div>

        {/* Conversation — inline on desktop; mobile uses the fullscreen chat */}
        {chat.length > 0 && (
          <div className="hidden md:block mt-3 space-y-3 max-h-[60vh] overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
            <ConversationView chat={chat} asking={asking} endRef={chatEndRef} />
          </div>
        )}

        {/* Mobile: open the conversation fullscreen */}
        {chat.length > 0 && (
          <button
            onClick={() => setChatOpen(true)}
            className="md:hidden mt-3 w-full flex items-center justify-between px-3.5 py-3 rounded-xl bg-cyan-50 border border-cyan-100 text-left"
          >
            <span className="text-sm font-semibold text-cyan-800">💬 Open conversation ({chat.length} message{chat.length > 1 ? 's' : ''})</span>
            <span className="text-cyan-500 text-lg leading-none">⤢</span>
          </button>
        )}

        {/* Suggested questions (before first message) */}
        {chat.length === 0 && !asking && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="text-[11px] px-2.5 py-1.5 rounded-full bg-cyan-50 text-cyan-800 hover:bg-cyan-100 border border-cyan-100 transition-colors text-left"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {askError && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{askError}</div>
        )}

        {/* Input */}
        <form
          onSubmit={e => { e.preventDefault(); ask(); }}
          className="mt-3 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onFocus={e => { if (isMobile()) { e.target.blur(); setChatOpen(true); } }}
            placeholder="Ask Cleo about any product, period, or metric…"
            disabled={asking}
            className="flex-1 min-w-0 px-3.5 py-2.5 text-base sm:text-sm border border-gray-200 rounded-xl bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {asking ? '…' : 'Ask'}
          </button>
        </form>
      </Card>

      {/* ── Fullscreen chat (mobile) ── */}
      {chatOpen && (
        <div className="md:hidden fixed inset-x-0 top-0 h-[100dvh] z-50 bg-white flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-50 flex items-center justify-center text-base shrink-0">💬</div>
            <p className="flex-1 text-sm font-bold text-gray-800">Cleo</p>
            {chat.some(m => m.role === 'assistant') && (
              <button
                onClick={createReport}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-100 font-semibold"
              >
                📊 Report
              </button>
            )}
            {chat.length > 0 && (
              <button onClick={clearChat} className="text-xs text-gray-400 hover:text-gray-600 font-medium px-2">Clear</button>
            )}
            <button
              onClick={() => setChatOpen(false)}
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
                      className="text-xs px-3 py-2.5 rounded-xl bg-cyan-50 text-cyan-800 border border-cyan-100 text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <ConversationView chat={chat} asking={asking} endRef={overlayEndRef} />
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
              autoFocus
              className="flex-1 min-w-0 px-3.5 py-2.5 text-base border border-gray-200 rounded-xl bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="px-4 py-2.5 bg-cyan-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl"
            >
              {asking ? '…' : 'Ask'}
            </button>
          </form>
        </div>
      )}

      {/* Empty state */}
      {!insights && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center text-3xl mb-4">✦</div>
          <h2 className="text-base font-bold text-gray-800 mb-1">Ready to generate insights</h2>
          <p className="text-sm text-gray-400 max-w-xs mb-6">
            Pick a timeframe, optionally compare against Q4 last year, then hit Generate. Claude analyzes your real store data and returns specific recommendations.
          </p>
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <span>✦</span> Generate Insights
          </button>
          <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-sm text-left">
            {CATEGORIES.map(c => (
              <div key={c.key} className={`flex items-start gap-2 p-3 rounded-xl ${c.bg}`}>
                <span className="text-lg">{c.icon}</span>
                <div>
                  <p className={`text-xs font-bold ${c.text}`}>{c.label}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{c.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data context bar */}
      {snapshot && hasInsights && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 px-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {snapshot.label}
          </div>
          {snapshot.compareLabel && (
            <div className="text-[11px] text-gray-400">· vs {snapshot.compareLabel}</div>
          )}
          {snapshot.platforms.length > 0 && (
            <div className="text-[11px] text-gray-400">· {snapshot.platforms.join(', ')}</div>
          )}
          {snapshot.productsCount > 0 && (
            <div className="text-[11px] text-gray-400">· {snapshot.productsCount} products</div>
          )}
          {snapshot.hasInventoryContext && (
            <span className="text-[10px] bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded-full font-medium">🏭 inventory-aware</span>
          )}
          {snapshot.hasCalendarContext && (
            <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-full font-medium">📅 calendar-aware</span>
          )}
          {generatedAt && (
            <div className="ml-auto text-[11px] text-gray-300">
              Generated {generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORIES.map(c => (
            <Card key={c.key} accentColor={c.accentColor}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{c.icon}</span>
                <div>
                  <p className="text-xs font-bold text-gray-700">{c.label}</p>
                  <p className="text-[10px] text-gray-400">{c.description}</p>
                </div>
              </div>
              <SkeletonCard />
            </Card>
          ))}
        </div>
      )}

      {/* Executive summary */}
      {hasInsights && insights.summary && (
        <Card accentColor="#a78bfa" className="mb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center text-base shrink-0">✦</div>
            <div>
              <p className="text-xs font-bold text-gray-800 mb-1">Executive Summary</p>
              <p className="text-sm text-gray-600 leading-relaxed">{insights.summary}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Insight cards */}
      {hasInsights && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORIES.map(cat => {
            const items: Insight[] = insights[cat.key] || [];
            return (
              <Card key={cat.key} accentColor={cat.accentColor}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-8 h-8 rounded-xl ${cat.bg} flex items-center justify-center text-base`}>
                    {cat.icon}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-800">{cat.label}</p>
                    <p className="text-[10px] text-gray-400">{cat.description}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {items.map((item, i) => (
                    <div key={i} className={`p-3 rounded-xl ${cat.bg}`}>
                      <div className="flex items-start gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${cat.dot}`} />
                        <div>
                          <p className={`text-xs font-bold mb-0.5 ${cat.text}`}>{item.title}</p>
                          <p className="text-xs text-gray-600 leading-relaxed">{item.insight}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {hasInsights && (
        <p className="text-[10px] text-gray-300 text-center mt-6">
          AI-generated insights based on your real store data. Always validate before acting.
        </p>
      )}
    </div>
  );
}
