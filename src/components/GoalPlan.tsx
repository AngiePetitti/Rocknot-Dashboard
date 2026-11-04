'use client';

// The agreed plan by month (goal, spend, gates, fully loaded CAC) and the
// dated checkpoints where it is re-read. Renders only for a client whose
// profile carries goals.plan / goals.checkpoints.
import { Fragment, useEffect, useState } from 'react';
import Card from '@/src/components/ui/Card';
import { useClient } from '@/src/components/ClientProvider';
import { formatCurrency } from '@/src/lib/utils';
import type { Checkpoint, MonthPlan } from '@/src/lib/client';

interface Actual { revenue: number; adSpend: number }
interface Review { reviewedAt: string; by?: string; note?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pstToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const fmtDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const k$ = (n?: number | null) => (n == null ? '—' : formatCurrency(n, true));

export default function GoalPlan({ actuals }: { actuals: Record<string, Actual> }) {
  const client = useClient();
  const plan: MonthPlan[] = [...(client.goals.plan || [])].sort((a, b) => a.month.localeCompare(b.month));
  const checkpoints: Checkpoint[] = [...(client.goals.checkpoints || [])].sort((a, b) => a.date.localeCompare(b.date));
  const today = pstToday();
  const thisMonth = today.slice(0, 7);

  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [configured, setConfigured] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/checkpoints', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d?.configured === false) setConfigured(false); if (d?.reviews) setReviews(d.reviews); })
      .catch(() => {});
  }, []);

  if (!plan.length && !checkpoints.length) return null;

  const save = async (id: string, clear = false) => {
    setSaving(id); setErr(null);
    try {
      const r = await fetch('/api/checkpoints', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clear ? { id, clear: true } : { id, note: draft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Could not save');
      if (d?.reviews) setReviews(d.reviews);
      setOpen(null); setDraft('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const status = (c: Checkpoint): 'done' | 'due' | 'upcoming' => (reviews[c.id] ? 'done' : c.date <= today ? 'due' : 'upcoming');
  const next = checkpoints.find(c => status(c) !== 'done');
  const doneCount = checkpoints.filter(c => status(c) === 'done').length;
  const visible = checkpoints.filter(c => showDone || status(c) !== 'done');

  return (
    <Card accentColor="#6ee7b7" className="mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-gray-700">Plan, guardrails and checkpoints</h2>
        {next && (
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${status(next) === 'due' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {status(next) === 'due' ? 'Due' : 'Next'}: {fmtDate(next.date)} · {next.title}
          </span>
        )}
      </div>

      {plan.length > 0 && (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-400 uppercase">
                <th className="pb-2 pr-4">Month</th>
                <th className="pb-2 pr-4">Revenue goal</th>
                <th className="pb-2 pr-4">Ad budget</th>
                <th className="pb-2 pr-4">Paid MER needed</th>
                <th className="pb-2 pr-4">Fully loaded CAC</th>
                <th className="pb-2 pr-4">AOV</th>
                <th className="pb-2 pr-4">Actual so far</th>
              </tr>
            </thead>
            <tbody>
              {plan.map(p => {
                const a = actuals[p.month];
                const cur = p.month === thisMonth;
                const past = p.month < thisMonth;
                const needMer = p.revenueGoal && p.adBudget ? p.revenueGoal / p.adBudget : null;
                const needMerMax = p.revenueGoal && p.adBudgetMax ? p.revenueGoal / p.adBudgetMax : null;
                const pct = a && p.revenueGoal ? Math.round((a.revenue / p.revenueGoal) * 100) : null;
                return (
                  <Fragment key={p.month}>
                    <tr className={`border-t border-gray-50 align-top ${cur ? 'bg-emerald-50/40' : ''}`}>
                      <td className="py-2 pr-4 whitespace-nowrap font-semibold text-gray-800">{monthLabel(p.month)}{cur && <span className="ml-1 text-[10px] font-semibold text-emerald-700">now</span>}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">{k$(p.revenueGoal)}{p.stretchGoal ? <span className="text-gray-400"> · stretch {k$(p.stretchGoal)}</span> : null}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">{k$(p.adBudget)}{p.adBudgetMax ? <span className="text-gray-400"> → {k$(p.adBudgetMax)} if gates pass</span> : null}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">{needMer ? `${needMer.toFixed(1)}x` : '—'}{needMerMax ? <span className="text-gray-400"> · {needMerMax.toFixed(1)}x at max</span> : null}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">{p.targetFullyLoadedCac != null ? `$${p.targetFullyLoadedCac} target` : '—'}{p.fullyLoadedCacCeiling != null ? <span className="text-gray-400"> · ${p.fullyLoadedCacCeiling} ceiling</span> : null}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">{p.aovTarget != null ? `$${p.aovTarget}` : '—'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-800">
                        {a ? (
                          <>
                            {formatCurrency(a.revenue, true)}{pct != null ? <span className={`ml-1 text-[11px] font-semibold ${pct >= 100 ? 'text-emerald-700' : past ? 'text-red-600' : 'text-gray-500'}`}>{pct}% of goal</span> : null}
                            <span className="block text-[11px] text-gray-400">{formatCurrency(a.adSpend, true)} ads{a.adSpend > 0 ? ` · ${(a.revenue / a.adSpend).toFixed(1)}x paid MER` : ''}</span>
                          </>
                        ) : <span className="text-gray-400">{past || cur ? 'loading…' : '—'}</span>}
                      </td>
                    </tr>
                    {p.rule && (
                      <tr className={`${cur ? 'bg-emerald-50/40' : ''}`}>
                        <td />
                        <td colSpan={6} className="pb-2 pr-4 text-[11px] text-gray-500 leading-snug">{p.rule}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {checkpoints.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Checkpoints</h3>
            {doneCount > 0 && (
              <button type="button" onClick={() => setShowDone(v => !v)} className="text-[11px] text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline">
                {showDone ? 'Hide reviewed' : `Show ${doneCount} reviewed`}
              </button>
            )}
          </div>
          {err && <p className="text-[11px] text-red-600 mb-1">{err}</p>}
          {!configured && <p className="text-[11px] text-gray-400 mb-1">Reviews cannot be saved on this deployment (no private sheet configured); the dates still show.</p>}
          <ul className="divide-y divide-gray-50">
            {visible.map(c => {
              const st = status(c);
              const rv = reviews[c.id];
              const dot = st === 'done' ? 'bg-emerald-500' : st === 'due' ? 'bg-amber-500' : 'bg-gray-300';
              return (
                <li key={c.id} className="py-2 flex gap-3">
                  <div className="w-24 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                      <span className={`text-xs font-semibold ${st === 'due' ? 'text-amber-700' : 'text-gray-700'}`}>{fmtDate(c.date)}</span>
                    </div>
                    {c.owner && <div className="text-[10px] text-gray-400 ml-3.5">{c.owner}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800">{c.title}</div>
                    <div className="text-xs text-gray-600">{c.check}</div>
                    {c.decision && <div className="text-xs text-gray-500 mt-0.5"><span className="font-semibold text-gray-500">Decision:</span> {c.decision}</div>}
                    {rv && (
                      <div className="mt-1 text-[11px] text-emerald-800 bg-emerald-50 rounded-lg px-2 py-1">
                        Reviewed {new Date(rv.reviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{rv.by ? ` by ${rv.by}` : ''}{rv.note ? ` — ${rv.note}` : ''}
                      </div>
                    )}
                    {open === c.id && (
                      <div className="mt-1.5 flex flex-col sm:flex-row gap-1.5">
                        <input
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          placeholder="What did we see, and what changed? (optional)"
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                        />
                        <div className="flex gap-1.5">
                          <button type="button" disabled={saving === c.id} onClick={() => save(c.id)} className="text-xs font-semibold bg-emerald-600 text-white rounded-lg px-2.5 py-1.5 disabled:opacity-50">{saving === c.id ? 'Saving…' : 'Save'}</button>
                          <button type="button" onClick={() => { setOpen(null); setDraft(''); }} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {configured && (
                    <div className="shrink-0 self-start">
                      {rv ? (
                        <button type="button" disabled={saving === c.id} onClick={() => save(c.id, true)} className="text-[11px] text-gray-400 hover:text-gray-600">Undo</button>
                      ) : open === c.id ? null : (
                        <button type="button" onClick={() => { setOpen(c.id); setDraft(''); }} className={`text-[11px] font-semibold rounded-lg px-2 py-1 ${st === 'due' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>Mark reviewed</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400 mt-2">
            One miss is a conversation; two in a row and the weakest platform loses 15% of budget to the best new-customer CAC. Paid MER and ads-only CAC are read weekly; fully loaded MER and CAC on a rolling four weeks.
          </p>
        </div>
      )}
    </Card>
  );
}
