'use client';

import { useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';

interface Insight {
  title: string;
  insight: string;
}

interface InsightSet {
  creatives: Insight[];
  products: Insight[];
  promos: Insight[];
  retention: Insight[];
}

interface Snapshot {
  dateFrom: string;
  dateTo: string;
  metrics: Record<string, number>;
  productsCount: number;
  platforms: string[];
}

const CATEGORIES = [
  {
    key: 'creatives' as const,
    label: 'Ad Creative Ideas',
    icon: '🎨',
    accentColor: '#818cf8',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    dot: 'bg-indigo-400',
    description: 'New angles, hooks & formats to test',
  },
  {
    key: 'products' as const,
    label: 'Product Opportunities',
    icon: '📦',
    accentColor: '#f9a8d4',
    bg: 'bg-pink-50',
    text: 'text-pink-700',
    dot: 'bg-pink-400',
    description: 'Colorways, bundles & variants to explore',
  },
  {
    key: 'promos' as const,
    label: 'Promos & Events',
    icon: '🎯',
    accentColor: '#fde68a',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-400',
    description: 'Sale timing, campaigns & seasonal plays',
  },
  {
    key: 'retention' as const,
    label: 'Retention & Growth',
    icon: '👥',
    accentColor: '#86efac',
    bg: 'bg-green-50',
    text: 'text-green-700',
    dot: 'bg-green-400',
    description: 'Win-back, loyalty & customer growth',
  },
];

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

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/insights', { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setInsights(data.insights);
      setSnapshot(data.snapshot);
      setGeneratedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const hasInsights = insights && !loading;

  return (
    <div>
      <Header title="AI Insights" subtitle="Data-driven ideas powered by Claude">
        <button
          onClick={generate}
          disabled={loading}
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

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!insights && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center text-3xl mb-4">✦</div>
          <h2 className="text-base font-bold text-gray-800 mb-1">Ready to generate insights</h2>
          <p className="text-sm text-gray-400 max-w-xs mb-6">
            Claude will analyze your last 30 days of real sales, ad, and product data to generate specific recommendations for Rocknot.
          </p>
          <button
            onClick={generate}
            className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors"
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
        <div className="flex flex-wrap items-center gap-3 mb-4 px-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Analyzed {snapshot.dateFrom} → {snapshot.dateTo}
          </div>
          {snapshot.platforms.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              · Platforms: {snapshot.platforms.join(', ')}
            </div>
          )}
          {snapshot.productsCount > 0 && (
            <div className="text-[11px] text-gray-400">
              · {snapshot.productsCount} products
            </div>
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
                    <div key={i} className={`p-3 rounded-xl ${cat.bg} border border-transparent`}>
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

      {/* Disclaimer */}
      {hasInsights && (
        <p className="text-[10px] text-gray-300 text-center mt-6">
          AI-generated insights based on your real store data. Always validate before acting.
        </p>
      )}
    </div>
  );
}
