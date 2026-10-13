'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import { useClient } from '@/src/components/ClientProvider';
import { formatCurrency } from '@/src/lib/utils';
import type { BfcmPlan, BfcmCheck, BfcmLink } from '@/src/lib/bfcm';

interface Store { revenue: number; netSales: number; orders: number; aov: number; spend: number; mer: number; newCustomers: number; returningCustomers: number; sessions: number; cvr: number }
interface Creative { id: string; name: string; platform: string; thumbnailUrl: string | null; adUrl: string | null; campaign: string; spend: number; revenue: number; roas: number; conversions: number; costPerConversion: number; ctr: number }
interface Campaign { id: string; name: string; channel: 'email' | 'sms'; sendTime: string | null; recipients?: number; openRate?: number; clickRate?: number; revenue?: number }
interface Perf {
  year: number; phase: 'before' | 'early_access' | 'live' | 'after'; previewLastYear: boolean;
  window: { from: string; to: string }; priorYearWindow: { from: string; to: string };
  store: Store | null; priorYear: Store | null;
  daily: Array<{ date: string; revenue: number; netSales?: number; orders: number; adSpend: number }>;
  platforms: Array<{ platform: string; spend: number; revenue: number; roas: number; conversions: number; costPerConversion: number; color: string }>;
  creatives: { best: Creative[]; worst: Creative[]; total: number; error: string | null };
  products: Array<{ id: string; name: string; unitsSold: number; revenue: number; percentOfTotal: number }>; productsError: string | null;
  owned: { overview?: { email: { revenue: number; campaigns: number }; sms: { revenue: number; campaigns: number } }; flows?: { revenue?: number; flows?: number }; email: Campaign[]; sms: Campaign[]; error: string | null } | null;
  error?: string;
}

const $ = (v: number) => formatCurrency(v);
const n = (v: number) => Math.round(v || 0).toLocaleString();
const pct = (a: number, b: number) => (b > 0 ? `${(((a - b) / b) * 100).toFixed(0)}%` : '—');
const uid = () => Math.random().toString(36).slice(2, 10);

export default function BfcmContent() {
  const client = useClient();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const [plan, setPlan] = useState<BfcmPlan | null>(null);
  const [draft, setDraft] = useState<BfcmPlan | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [perfErr, setPerfErr] = useState<string | null>(null);
  const [showLastYear, setShowLastYear] = useState(false);
  const [newCheck, setNewCheck] = useState('');

  useEffect(() => {
    fetch('/api/bfcm', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.plan) setPlan(d.plan); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!plan) return;
    setPerf(null); setPerfErr(null);
    fetch(`/api/bfcm/performance?year=${plan.year}${showLastYear ? '&window=last_year' : ''}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d?.error) setPerfErr(String(d.error)); else setPerf(d); })
      .catch(e => setPerfErr(String(e)));
  }, [plan?.year, plan?.window.from, plan?.window.to, plan?.earlyAccessFrom, showLastYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const daysToGo = plan ? Math.round((Date.parse(plan.window.from) - Date.parse(today)) / 86400000) : 0;
  const phase: Perf['phase'] = !plan ? 'before' : today > plan.window.to ? 'after' : today >= plan.window.from ? 'live' : plan.earlyAccessFrom && today >= plan.earlyAccessFrom ? 'early_access' : 'before';

  async function savePlan(next: BfcmPlan) {
    setSaving(true);
    try {
      const r = await fetch('/api/bfcm', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: next }) });
      const d = await r.json();
      if (d?.plan) { setPlan(d.plan); setDraft(null); setEditing(false); } else alert(d?.error || 'Could not save');
    } finally { setSaving(false); }
  }
  async function toggleCheck(c: BfcmCheck) {
    if (!plan) return;
    const optimistic = { ...plan, checklist: plan.checklist.map(x => (x.id === c.id ? { ...x, done: !x.done } : x)) };
    setPlan(optimistic);
    const r = await fetch('/api/bfcm', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: plan.year, id: c.id, done: !c.done }) });
    const d = await r.json().catch(() => null);
    if (d?.plan) setPlan(d.plan);
  }
  async function addCheck() {
    if (!plan || !newCheck.trim()) return;
    const next = { ...plan, checklist: [...plan.checklist, { id: uid(), text: newCheck.trim(), done: false }] };
    setNewCheck('');
    await savePlan(next);
  }
  async function removeCheck(id: string) {
    if (!plan || !confirm('Remove this checklist item?')) return;
    await savePlan({ ...plan, checklist: plan.checklist.filter(c => c.id !== id) });
  }

  const done = plan ? plan.checklist.filter(c => c.done).length : 0;
  const overdue = plan ? plan.checklist.filter(c => !c.done && c.due && c.due < today) : [];
  const st = perf?.store; const py = perf?.priorYear;
  const goalRev = plan?.goals.revenue || 0; const goalSpend = plan?.goals.adSpend || 0;
  const impliedMer = goalSpend > 0 ? goalRev / goalSpend : null;
  const revPct = st && goalRev > 0 ? Math.min(100, (st.revenue / goalRev) * 100) : 0;
  const spendPct = st && goalSpend > 0 ? Math.min(100, (st.spend / goalSpend) * 100) : 0;
  const phaseLabel = phase === 'live' ? '🔴 Sale is live' : phase === 'early_access' ? '🟠 Early access' : phase === 'after' ? '✅ Sale finished' : `⏳ ${daysToGo} days to go`;

  const Delta = ({ cur, prev, lowerBetter }: { cur: number; prev: number; lowerBetter?: boolean }) => {
    if (!prev) return null;
    const d = ((cur - prev) / prev) * 100;
    const good = lowerBetter ? d <= 0 : d >= 0;
    return <span className={`text-xs font-semibold ml-1 ${good ? 'text-green-500' : 'text-red-500'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(0)}% vs last year</span>;
  };

  const d = draft || plan;

  return (
    <div>
      <Header title={plan?.name || 'BFCM'} subtitle={`Black Friday / Cyber Monday plan and live tracking · ${client.name}`} />
      {!plan && <p className="text-xs text-gray-400 mb-4">Loading the plan…</p>}

      {plan && (
        <>
          {/* ── Plan at the top ── */}
          <Card accentColor="#f59e0b" className="mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">The plan</p>
                <p className="text-sm text-gray-700 mt-1">
                  <b>{phaseLabel}</b> · sale {plan.window.from} → {plan.window.to}{plan.earlyAccessFrom ? ` · early access from ${plan.earlyAccessFrom}` : ''}
                </p>
              </div>
              {isAdmin && !editing && <button onClick={() => { setDraft(JSON.parse(JSON.stringify(plan))); setEditing(true); }} className="text-xs font-semibold text-violet-600 hover:text-violet-800">✏️ Edit plan</button>}
              {isAdmin && editing && d && (
                <div className="flex gap-2">
                  <button disabled={saving} onClick={() => savePlan(d)} className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-3 py-1.5">{saving ? 'Saving…' : 'Save'}</button>
                  <button disabled={saving} onClick={() => { setDraft(null); setEditing(false); }} className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2">Cancel</button>
                </div>
              )}
            </div>

            {editing && d ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs text-gray-500">Name<input value={d.name} onChange={e => setDraft({ ...d, name: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" /></label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-gray-500">Early access<input type="date" value={d.earlyAccessFrom || ''} onChange={e => setDraft({ ...d, earlyAccessFrom: e.target.value || undefined })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                  <label className="text-xs text-gray-500">Sale starts<input type="date" value={d.window.from} onChange={e => setDraft({ ...d, window: { ...d.window, from: e.target.value } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                  <label className="text-xs text-gray-500">Sale ends<input type="date" value={d.window.to} onChange={e => setDraft({ ...d, window: { ...d.window, to: e.target.value } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                </div>
                <label className="text-xs text-gray-500 md:col-span-2">The plan (audiences, cadence, what we are doing differently this year)<textarea value={d.summary} onChange={e => setDraft({ ...d, summary: e.target.value })} rows={4} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" /></label>
                <label className="text-xs text-gray-500 md:col-span-2">Offers (sitewide %, tiers, gift with purchase, codes, exclusions)<textarea value={d.offers} onChange={e => setDraft({ ...d, offers: e.target.value })} rows={3} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" /></label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:col-span-2">
                  <label className="text-xs text-gray-500">Revenue goal $<input type="number" value={d.goals.revenue || ''} onChange={e => setDraft({ ...d, goals: { ...d.goals, revenue: Number(e.target.value) || 0 } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                  <label className="text-xs text-gray-500">Ad spend goal $<input type="number" value={d.goals.adSpend || ''} onChange={e => setDraft({ ...d, goals: { ...d.goals, adSpend: Number(e.target.value) || 0 } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                  <label className="text-xs text-gray-500">Orders goal<input type="number" value={d.goals.orders || ''} onChange={e => setDraft({ ...d, goals: { ...d.goals, orders: Number(e.target.value) || undefined } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                  <label className="text-xs text-gray-500">Email + SMS revenue goal $<input type="number" value={d.goals.emailRevenue || ''} onChange={e => setDraft({ ...d, goals: { ...d.goals, emailRevenue: Number(e.target.value) || undefined } })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2" /></label>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Collection pages</p>
                  {d.collections.map((c, i) => (
                    <div key={i} className="flex gap-2 mb-1.5">
                      <input placeholder="Label" value={c.label} onChange={e => setDraft({ ...d, collections: d.collections.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="w-40 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                      <input placeholder={`https://${client.siteDomain}/collections/…`} value={c.url} onChange={e => setDraft({ ...d, collections: d.collections.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                      <button onClick={() => setDraft({ ...d, collections: d.collections.filter((_, j) => j !== i) })} className="text-xs text-red-500 px-1">Remove</button>
                    </div>
                  ))}
                  <button onClick={() => setDraft({ ...d, collections: [...d.collections, { label: '', url: '' } as BfcmLink] })} className="text-xs font-semibold text-violet-600">+ Add collection link</button>
                </div>
                <label className="text-xs text-gray-500 md:col-span-2">Notes<textarea value={d.notes} onChange={e => setDraft({ ...d, notes: e.target.value })} rows={2} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" /></label>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{plan.summary || <span className="text-gray-400">No plan written yet{isAdmin ? ' — tap Edit plan.' : '.'}</span>}</p>
                  {plan.offers && <p className="text-sm text-gray-700 mt-3"><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-0.5">Offers</span><span className="whitespace-pre-wrap">{plan.offers}</span></p>}
                  {plan.collections.filter(c => c.url).length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Collection pages</p>
                      <div className="flex flex-wrap gap-2">
                        {plan.collections.filter(c => c.url).map((c, i) => (
                          <a key={i} href={c.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg px-2.5 py-1">🔗 {c.label || c.url.replace(/^https?:\/\//, '')}</a>
                        ))}
                      </div>
                    </div>
                  )}
                  {plan.notes && <p className="text-xs text-gray-500 mt-3 whitespace-pre-wrap">{plan.notes}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 content-start">
                  <Tile label="Revenue goal" value={goalRev ? $(goalRev) : '—'} sub={st && goalRev ? `${$(st.revenue)} so far · ${revPct.toFixed(0)}%` : 'net of the sale window'} bar={st && goalRev ? revPct : undefined} tone="violet" />
                  <Tile label="Ad spend goal" value={goalSpend ? $(goalSpend) : '—'} sub={st && goalSpend ? `${$(st.spend)} so far · ${spendPct.toFixed(0)}%` : impliedMer ? `implies ${impliedMer.toFixed(1)}x MER` : 'all platforms'} bar={st && goalSpend ? spendPct : undefined} tone="amber" />
                  {plan.goals.orders ? <Tile label="Orders goal" value={n(plan.goals.orders)} sub={st ? `${n(st.orders)} so far` : ''} /> : null}
                  {plan.goals.emailRevenue ? <Tile label="Email + SMS goal" value={$(plan.goals.emailRevenue)} sub={perf?.owned?.overview ? `${$(perf.owned.overview.email.revenue + perf.owned.overview.sms.revenue)} so far` : ''} /> : null}
                </div>
              </div>
            )}
          </Card>

          {/* ── Checklist ── */}
          <Card className="mb-6">
            <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
              <h3 className="text-sm font-bold text-gray-800">Checklist · {done}/{plan.checklist.length} done{overdue.length ? <span className="text-red-500 font-semibold"> · {overdue.length} overdue</span> : null}</h3>
              <p className="text-[11px] text-gray-400">Anyone on the team can tick items · admins add and remove them · due dates count back from Black Friday</p>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${plan.checklist.length ? (done / plan.checklist.length) * 100 : 0}%` }} /></div>
            <ul className="divide-y divide-gray-50">
              {[...plan.checklist].sort((a, b) => (a.done === b.done ? (a.due || '9999').localeCompare(b.due || '9999') : a.done ? 1 : -1)).map(c => {
                const late = !c.done && c.due && c.due < today;
                return (
                  <li key={c.id} className="flex items-start gap-3 py-2">
                    <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c)} className="mt-0.5 rounded border-gray-300" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${c.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{c.text}</p>
                      <p className="text-[11px] text-gray-400">
                        {c.due && <span className={late ? 'text-red-500 font-semibold' : ''}>{late ? 'Overdue · ' : 'Due '}{c.due}</span>}
                        {c.owner && <span> · {c.owner}</span>}
                        {c.done && c.doneBy && <span> · done by {c.doneBy.split('@')[0]}</span>}
                      </p>
                    </div>
                    {isAdmin && <button onClick={() => removeCheck(c.id)} className="text-[11px] text-gray-300 hover:text-red-500">remove</button>}
                  </li>
                );
              })}
            </ul>
            {isAdmin && (
              <div className="flex gap-2 mt-3">
                <input value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCheck(); }} placeholder="Add an item…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2" />
                <button onClick={addCheck} disabled={!newCheck.trim() || saving} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4">Add</button>
              </div>
            )}
          </Card>

          {/* ── Performance ── */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-base font-bold text-gray-800">{perf?.previewLastYear ? `Last year's BFCM · ${perf.window.from} → ${perf.window.to}` : `Sale performance · ${perf ? `${perf.window.from} → ${perf.window.to}` : ''}`}</h2>
            {phase !== 'before' && <label className="text-xs text-gray-500 inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showLastYear} onChange={e => setShowLastYear(e.target.checked)} className="rounded border-gray-300" />Show last year&apos;s window instead</label>}
            {phase === 'before' && <p className="text-xs text-gray-400">Live tracking switches on automatically when the sale starts. Until then this shows last year&apos;s same dates as the baseline.</p>}
          </div>
          {perfErr && <Card className="mb-6"><p className="text-xs text-red-600">{perfErr}</p></Card>}
          {!perf && !perfErr && <p className="text-xs text-gray-400 mb-6">Loading sale performance…</p>}
          {perf && st && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
                <MetricCard title="Revenue" value={$(st.revenue)} accentColor="#c4b5fd" subtitle={`net sales ${$(st.netSales)} · ${n(st.orders)} orders`} comparison={py ? { current: st.revenue, prior: py.revenue, label: 'vs last year' } : undefined} />
                <MetricCard title="MER" value={st.mer ? `${st.mer.toFixed(2)}x` : '—'} accentColor="#a7f3d0" subtitle={`net sales ÷ ad spend${impliedMer ? ` · goal ${impliedMer.toFixed(1)}x` : ''}`} comparison={py && py.mer ? { current: st.mer, prior: py.mer, label: 'vs last year' } : undefined} />
                <MetricCard title="Ad spend" value={$(st.spend)} accentColor="#fdba74" subtitle={goalSpend ? `${spendPct.toFixed(0)}% of the ${$(goalSpend)} budget` : 'all platforms'} comparison={py ? { current: st.spend, prior: py.spend, label: 'vs last year' } : undefined} />
                <MetricCard title="AOV" value={$(st.aov)} accentColor="#f9a8d4" subtitle={`${n(st.newCustomers)} new · ${n(st.returningCustomers)} returning customers${st.cvr ? ` · CVR ${st.cvr.toFixed(1)}%` : ''}`} comparison={py ? { current: st.aov, prior: py.aov, label: 'vs last year' } : undefined} />
              </div>
              {py && (
                <p className="text-[11px] text-gray-400 mb-4">Last year&apos;s same dates ({perf.priorYearWindow.from} → {perf.priorYearWindow.to}): revenue {$(py.revenue)} · orders {n(py.orders)} · ad spend {$(py.spend)} · MER {py.mer.toFixed(2)}x · new customers {n(py.newCustomers)}</p>
              )}

              {/* Daily */}
              {perf.daily.length > 1 && (
                <Card className="mb-4">
                  <h3 className="text-sm font-bold text-gray-800 mb-2">Day by day</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase"><th className="text-left pb-2">Day</th><th className="text-right pb-2">Revenue</th><th className="text-right pb-2">Orders</th><th className="text-right pb-2">Ad spend</th><th className="text-right pb-2">MER</th></tr></thead>
                    <tbody>{perf.daily.map(r => (
                      <tr key={r.date} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{r.date}{r.date === plan.window.from ? ' · Black Friday' : r.date === plan.window.to ? ' · Cyber Monday' : ''}</td><td className="py-1.5 text-right tabular-nums font-semibold">{$(r.revenue)}</td><td className="py-1.5 text-right tabular-nums">{n(r.orders)}</td><td className="py-1.5 text-right tabular-nums text-gray-600">{$(r.adSpend)}</td><td className="py-1.5 text-right tabular-nums text-gray-600">{r.adSpend > 0 ? `${((r.netSales ?? r.revenue) / r.adSpend).toFixed(2)}x` : '—'}</td></tr>
                    ))}</tbody>
                  </table></div>
                </Card>
              )}

              {/* Platforms */}
              <Card className="mb-4">
                <h3 className="text-sm font-bold text-gray-800 mb-2">Platforms</h3>
                {perf.platforms.length === 0 ? <p className="text-xs text-gray-400">No ad spend in this window.</p> : (
                  <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
                    <thead><tr className="border-b border-gray-100 text-xs text-gray-400 uppercase"><th className="text-left pb-2">Platform</th><th className="text-right pb-2">Spend</th><th className="text-right pb-2">Revenue</th><th className="text-right pb-2">ROAS</th><th className="text-right pb-2">Purchases</th><th className="text-right pb-2">Cost / purchase</th></tr></thead>
                    <tbody>{[...perf.platforms].sort((a, b) => b.spend - a.spend).map(p => (
                      <tr key={p.platform} className="border-b border-gray-50"><td className="py-1.5 font-semibold text-gray-700"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: p.color }} />{p.platform}</td><td className="py-1.5 text-right tabular-nums">{$(p.spend)}</td><td className="py-1.5 text-right tabular-nums">{$(p.revenue)}</td><td className={`py-1.5 text-right tabular-nums font-semibold ${p.roas >= (client.goals.targetRoas || 3) ? 'text-green-600' : 'text-red-500'}`}>{p.roas.toFixed(2)}x</td><td className="py-1.5 text-right tabular-nums">{n(p.conversions)}</td><td className="py-1.5 text-right tabular-nums text-gray-600">{p.costPerConversion ? $(p.costPerConversion) : '—'}</td></tr>
                    ))}</tbody>
                  </table></div>
                )}
              </Card>

              {/* Creatives */}
              <div className="grid gap-4 lg:grid-cols-2 mb-4">
                <CreativeList title="Creatives that worked" items={perf.creatives.best} tone="good" error={perf.creatives.error} />
                <CreativeList title="Creatives that did not" items={perf.creatives.worst} tone="bad" error={perf.creatives.error} />
              </div>

              {/* Products + owned */}
              <div className="grid gap-4 lg:grid-cols-2 mb-6">
                <Card>
                  <h3 className="text-sm font-bold text-gray-800 mb-2">Top products</h3>
                  {perf.productsError && <p className="text-xs text-red-500">{perf.productsError}</p>}
                  {perf.products.length === 0 ? <p className="text-xs text-gray-400">No product sales in this window.</p> : (
                    <table className="w-full text-sm"><tbody>{perf.products.map((p, i) => (
                      <tr key={p.id} className="border-b border-gray-50"><td className="py-1.5 text-gray-400 w-6">{i + 1}</td><td className="py-1.5 text-gray-700">{p.name}</td><td className="py-1.5 text-right tabular-nums font-semibold">{$(p.revenue)}</td><td className="py-1.5 text-right tabular-nums text-gray-500 w-20">{n(p.unitsSold)} units</td></tr>
                    ))}</tbody></table>
                  )}
                </Card>
                <Card>
                  <h3 className="text-sm font-bold text-gray-800 mb-2">Email &amp; SMS</h3>
                  {!perf.owned ? <p className="text-xs text-gray-400">Klaviyo is not connected for this client.</p> : (
                    <>
                      {perf.owned.error && <p className="text-xs text-amber-600 mb-2">{perf.owned.error}</p>}
                      {perf.owned.overview && (
                        <p className="text-xs text-gray-500 mb-2">Email {$(perf.owned.overview.email.revenue)} from {perf.owned.overview.email.campaigns} campaigns · SMS {$(perf.owned.overview.sms.revenue)} from {perf.owned.overview.sms.campaigns}{perf.owned.flows?.revenue != null ? ` · flows ${$(perf.owned.flows.revenue)}` : ''}</p>
                      )}
                      <CampaignList label="Best emails" items={perf.owned.email} />
                      <CampaignList label="Best SMS" items={perf.owned.sms} />
                    </>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, bar, tone }: { label: string; value: string; sub?: string; bar?: number; tone?: 'violet' | 'amber' }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-xl font-bold text-gray-800 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      {bar != null && <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2"><div className={`h-full rounded-full ${tone === 'amber' ? 'bg-amber-400' : 'bg-violet-500'}`} style={{ width: `${bar}%` }} /></div>}
    </div>
  );
}

function CreativeList({ title, items, tone, error }: { title: string; items: Creative[]; tone: 'good' | 'bad'; error: string | null }) {
  return (
    <Card>
      <h3 className="text-sm font-bold text-gray-800 mb-2">{title}</h3>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {items.length === 0 ? <p className="text-xs text-gray-400">Nothing with meaningful spend in this window yet.</p> : (
        <ul className="divide-y divide-gray-50">
          {items.map(c => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0">{c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-700 truncate">{c.adUrl ? <a href={c.adUrl} target="_blank" rel="noreferrer" className="hover:underline">{c.name}</a> : c.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{c.platform} · {c.campaign}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold tabular-nums ${tone === 'good' ? 'text-green-600' : 'text-red-500'}`}>{c.roas.toFixed(2)}x</p>
                <p className="text-[11px] text-gray-400 tabular-nums">{formatCurrency(c.spend)} · {Math.round(c.conversions)} purch.</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CampaignList({ label, items }: { label: string; items: Campaign[] }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      {items.length === 0 ? <p className="text-xs text-gray-400">None sent in this window.</p> : (
        <table className="w-full text-sm"><tbody>{items.map(c => (
          <tr key={c.id} className="border-b border-gray-50">
            <td className="py-1.5 text-gray-700"><span className="block truncate max-w-[260px]">{c.name}</span><span className="text-[11px] text-gray-400">{c.sendTime ? c.sendTime.slice(0, 10) : ''}{c.recipients ? ` · ${Math.round(c.recipients).toLocaleString()} sent` : ''}{c.openRate != null ? ` · ${(c.openRate * 100).toFixed(0)}% open` : ''}{c.clickRate != null ? ` · ${(c.clickRate * 100).toFixed(1)}% click` : ''}</span></td>
            <td className="py-1.5 text-right tabular-nums font-semibold">{formatCurrency(c.revenue || 0)}</td>
          </tr>
        ))}</tbody></table>
      )}
    </div>
  );
}
