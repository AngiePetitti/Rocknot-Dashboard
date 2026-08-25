'use client';

import { useEffect, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface Campaign {
  id: string; name: string; channel: 'email' | 'sms'; status: string; sendTime: string | null;
  recipients?: number; openRate?: number; clickRate?: number; revenue?: number;
}
interface ChannelAgg { revenue: number; campaigns: number; recipients: number; avgOpenRate: number; avgClickRate: number }
interface RetentionResponse {
  source?: string; error?: string; statsError?: string;
  overview?: { email: ChannelAgg; sms: ChannelAgg };
  recent?: Campaign[]; scheduled?: Campaign[];
}

interface PlanCampaign {
  date: string; channel: string; title: string; type: string; audience: string; goal: string;
  subjectLines: string[]; previewText?: string; heroHeadline?: string; bodyCopy?: string;
  cta?: string; designBrief?: string; bestPractice?: string;
}
interface PlanResponse { plan?: { monthOverview?: string; campaigns?: PlanCampaign[] } | null; generatedAt?: string; error?: string }

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const CHANNEL_BADGE: Record<string, string> = { email: 'bg-violet-100 text-violet-700', sms: 'bg-emerald-100 text-emerald-700' };
const TYPE_COLORS: Record<string, string> = {
  Launch: '#c4b5fd', Promo: '#f9a8d4', Value: '#86efac', Winback: '#fdba74',
  'Back in stock': '#93c5fd', Tease: '#fde68a',
};

export default function RetentionContent() {
  const [data, setData] = useState<RetentionResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [openBrief, setOpenBrief] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  useEffect(() => {
    fetch('/api/retention/hidden', { cache: 'no-store' }).then(r => r.json()).then(d => { if (Array.isArray(d?.hidden)) setHidden(d.hidden); }).catch(() => {});
  }, []);
  async function hideCampaign(id: string) {
    setHidden(prev => [...prev, id]);
    await fetch('/api/retention/hidden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  async function unhideCampaign(id: string) {
    setHidden(prev => prev.filter(h => h !== id));
    await fetch('/api/retention/hidden', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
  }

  useEffect(() => {
    fetch('/api/retention', { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ source: 'error', error: 'Failed to load' }));
    fetch('/api/retention/plan', { cache: 'no-store' }).then(r => r.json()).then(setPlan).catch(() => {});
  }, []);

  async function generatePlan() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/retention/plan', { method: 'POST' });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Generation failed');
      setPlan(d);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function copyBrief(c: PlanCampaign) {
    const text = `${c.title} — ${c.channel} · ${c.date}
Type: ${c.type} · Audience: ${c.audience}
Goal: ${c.goal}

Subject lines:
${(c.subjectLines || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}
Preview text: ${c.previewText || '—'}

Hero headline: ${c.heroHeadline || '—'}
Body copy:
${c.bodyCopy || '—'}
CTA: ${c.cta || '—'}

Design brief:
${c.designBrief || '—'}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(c.title);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const ov = data?.overview;

  return (
    <div>
      <Header title="Retention" subtitle="Email & SMS · Klaviyo performance + campaign calendar with ready-to-build briefs" />

      {data?.source === 'error' && (
        <Card accentColor="#fca5a5" className="mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-1">Klaviyo isn&apos;t connected yet</p>
          <p className="text-xs text-gray-500">{data.error}</p>
        </Card>
      )}
      {data?.statsError && (
        <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ Campaign list loaded but stats didn&apos;t: {data.statsError}
        </div>
      )}

      {/* ── Overview ── */}
      {ov && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard title="Email Revenue (30d)" value={$(ov.email.revenue)} subtitle={`${ov.email.campaigns} campaigns · ${ov.email.recipients.toLocaleString()} sends`} accentColor="#c4b5fd" />
          <MetricCard title="Email Engagement" value={`${ov.email.avgOpenRate}%`} subtitle={`open rate · ${ov.email.avgClickRate}% click`} accentColor="#a5b4fc" />
          <MetricCard title="SMS Revenue (30d)" value={$(ov.sms.revenue)} subtitle={`${ov.sms.campaigns} campaigns · ${ov.sms.recipients.toLocaleString()} sends`} accentColor="#86efac" />
          <MetricCard title="Total Owned Revenue" value={$(ov.email.revenue + ov.sms.revenue)} subtitle="Email + SMS, last 30 days" accentColor="#f9a8d4" />
        </div>
      )}

      {/* ── Last 30 days of campaigns ── */}
      {(data?.recent?.length ?? 0) > 0 && (
        <Card accentColor="#c4b5fd" className="mb-4">
          <h2 className="text-sm font-bold text-gray-700 mb-3">📬 Campaign Performance — Last 30 Days</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2">Campaign</th>
                  <th className="text-center text-xs font-semibold text-gray-400 uppercase pb-2 px-2">Channel</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-2">Sent</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-2">Open</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-2">Click</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 pl-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data!.recent!.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-2">
                      <span className="font-medium text-gray-700 block break-words">{c.name}</span>
                      {c.sendTime && <span className="text-[10px] text-gray-400">{c.sendTime.slice(0, 10)}</span>}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${CHANNEL_BADGE[c.channel]}`}>{c.channel}</span>
                    </td>
                    <td className="py-2 px-2 text-right text-gray-600">{c.recipients?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{c.openRate !== undefined ? `${c.openRate}%` : '—'}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{c.clickRate !== undefined ? `${c.clickRate}%` : '—'}</td>
                    <td className="py-2 pl-2 text-right font-semibold text-gray-800">{c.revenue !== undefined ? $(c.revenue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Scheduled / pending ── */}
      {(data?.scheduled?.length ?? 0) > 0 && (() => {
        const visible = data!.scheduled!.filter(c => !hidden.includes(c.id));
        const hiddenItems = data!.scheduled!.filter(c => hidden.includes(c.id));
        return (
          <Card accentColor="#93c5fd" className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3">🗓 Scheduled &amp; Drafts in Klaviyo</h2>
            <div className="flex flex-col gap-1.5">
              {visible.map(c => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm border border-gray-100 rounded-lg px-3 py-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${CHANNEL_BADGE[c.channel]}`}>{c.channel}</span>
                  <span className="font-medium text-gray-700 flex-1 min-w-0 break-words">{c.name}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{c.sendTime ? `sends ${c.sendTime.slice(0, 10)}` : c.status}</span>
                  <button
                    onClick={() => hideCampaign(c.id)}
                    title="No longer relevant — hide from this list (stays in Klaviyo)"
                    className="text-gray-300 hover:text-red-500 px-1 font-bold"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {visible.length === 0 && <p className="text-xs text-gray-400 py-2">All drafts hidden as no longer relevant.</p>}
            </div>
            {hiddenItems.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowHidden(o => !o)} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600">
                  {showHidden ? '▾' : '▸'} Hidden — no longer relevant ({hiddenItems.length})
                </button>
                {showHidden && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {hiddenItems.map(c => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
                        {c.name}
                        <button onClick={() => unhideCampaign(c.id)} title="Show again" className="text-gray-400 hover:text-green-600 font-bold">↺</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })()}

      {/* ── AI campaign calendar with briefs ── */}
      <Card accentColor="#f9a8d4" className="mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h2 className="text-sm font-bold text-gray-700">💌 Next 30 Days — Campaign Calendar &amp; Briefs</h2>
          <button
            onClick={generatePlan}
            disabled={generating}
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-full bg-pink-500 hover:bg-pink-600 disabled:opacity-60 text-white"
          >
            {generating ? '✨ Cleo is planning… (~1 min)' : plan?.plan ? '↻ Regenerate plan' : '✨ Generate plan'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Cleo builds this from your upcoming launches, recent Klaviyo performance, and retention best practices — each send has copy and a design brief ready for your designer.
          {plan?.generatedAt && <> Last generated {plan.generatedAt.slice(0, 10)}.</>}
        </p>
        {genError && <p className="text-xs text-red-500 mb-2">{genError}</p>}

        {plan?.plan?.monthOverview && (
          <div className="bg-pink-50 border border-pink-100 rounded-xl px-4 py-2.5 mb-4 text-xs text-pink-800">
            {plan.plan.monthOverview}
          </div>
        )}

        {(plan?.plan?.campaigns?.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-2">
            {plan!.plan!.campaigns!.map((c, i) => {
              const key = `${c.date}-${i}`;
              const open = openBrief === key;
              return (
                <div key={key} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button onClick={() => setOpenBrief(open ? null : key)} className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left hover:bg-gray-50">
                    <span className="text-xs font-bold text-gray-500 whitespace-nowrap">{c.date?.slice(5)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${CHANNEL_BADGE[c.channel?.toLowerCase().includes('sms') ? 'sms' : 'email']}`}>{c.channel}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-gray-700" style={{ backgroundColor: TYPE_COLORS[c.type] || '#e5e7eb' }}>{c.type}</span>
                    <span className="text-sm font-semibold text-gray-800 flex-1 min-w-0 break-words">{c.title}</span>
                    <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-3 text-xs text-gray-600 space-y-2 border-t border-gray-50 pt-2.5">
                      <p><b>Goal:</b> {c.goal} · <b>Audience:</b> {c.audience}</p>
                      <div>
                        <b>{c.channel?.toLowerCase().includes('sms') ? 'Message variants:' : 'Subject lines:'}</b>
                        <ul className="list-disc ml-4 mt-0.5">{(c.subjectLines || []).map((s, j) => <li key={j}>{s}</li>)}</ul>
                      </div>
                      {c.previewText && <p><b>Preview:</b> {c.previewText}</p>}
                      {c.heroHeadline && <p><b>Hero:</b> {c.heroHeadline}</p>}
                      {c.bodyCopy && <p className="whitespace-pre-wrap"><b>Copy:</b> {c.bodyCopy}</p>}
                      {c.cta && <p><b>CTA:</b> {c.cta}</p>}
                      {c.designBrief && <p className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 whitespace-pre-wrap"><b>🎨 Design brief:</b> {c.designBrief}</p>}
                      {c.bestPractice && <p className="text-gray-400">💡 {c.bestPractice}</p>}
                      <button onClick={() => copyBrief(c)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600">
                        {copied === c.title ? '✓ Copied' : '📋 Copy full brief'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          !generating && <p className="text-sm text-gray-400 text-center py-6">No plan yet — tap ✨ Generate plan and Cleo drafts the next 30 days.</p>
        )}
      </Card>
    </div>
  );
}
