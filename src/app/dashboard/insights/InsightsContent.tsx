'use client';

import { useEffect, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (raw) setChat(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

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
      try { localStorage.setItem(CHAT_KEY, JSON.stringify(withAnswer.slice(-24))); } catch { /* ignore */ }
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
    try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
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
          <div className="w-8 h-8 rounded-xl bg-cyan-50 flex items-center justify-center text-base">💬</div>
          <div className="flex-1">
            <p className="text-xs font-bold text-gray-800">Ask the Analyst</p>
            <p className="text-[10px] text-gray-400">Questions answered against your real 90-day sales, ads, inventory & calendar data — with the math shown.</p>
          </div>
          {chat.length > 0 && (
            <button onClick={clearChat} className="text-[11px] text-gray-400 hover:text-gray-600 font-medium">Clear</button>
          )}
        </div>

        {/* Conversation */}
        {chat.length > 0 && (
          <div className="mt-3 space-y-3 max-h-96 overflow-y-auto pr-1">
            {chat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-violet-600 text-white' : 'bg-gray-50 text-gray-700 border border-gray-100'
                }`}>
                  {msg.content}
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
          </div>
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
            placeholder="e.g. Which colorways are trending up the fastest?"
            disabled={asking}
            className="flex-1 px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-60"
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
