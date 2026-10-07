'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/src/components/ui/Card';
import { useClient } from '@/src/components/ClientProvider';
import type { Brief } from '@/src/lib/brief';

/**
 * The morning brief at the top of the Overview: what moved yesterday, why,
 * and what to do — written from computed facts, so every number is real.
 * Built once per day on the first load; later loads read the cached copy.
 */
export default function DailyBrief({ isAdmin = false }: { isAdmin?: boolean }) {
  const client = useClient();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [state, setState] = useState<'loading' | 'building' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const [showFacts, setShowFacts] = useState(false);
  const [more, setMore] = useState(false);

  async function load(refresh = false) {
    setState(refresh ? 'building' : 'loading'); setError('');
    try {
      if (!refresh) {
        const c = await fetch('/api/brief?cached=1', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        if (c?.brief) { setBrief(c.brief); setState('ok'); return; }
        setState('building');
      }
      const r = await fetch(`/api/brief${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      setBrief(d.brief); setState('ok');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setState('error'); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pretty = brief ? new Date(`${brief.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  const pctTone = (p: number | null | undefined, invert = false) => (p == null ? 'text-gray-400' : (invert ? p <= 0 : p >= 0) ? 'text-green-600' : 'text-red-500');
  const fmtPct = (p: number | null | undefined) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`);

  return (
    <Card className="mb-4" accentColor="#8b5cf6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-lg shrink-0">✦</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">{client.analyst.name}&apos;s morning brief{pretty ? ` · ${pretty}` : ''}</p>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
              {brief && <span>updated {new Date(brief.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
              {isAdmin && state === 'ok' && <button onClick={() => load(true)} className="text-violet-600 font-semibold hover:underline">Rebuild</button>}
            </div>
          </div>
          {state === 'loading' && <p className="text-sm text-gray-400 mt-1">Loading…</p>}
          {state === 'building' && <p className="text-sm text-gray-500 mt-1">Reading yesterday against the last four weeks… about a minute the first time each day.</p>}
          {state === 'error' && <p className="text-sm text-red-600 mt-1">Couldn&apos;t build today&apos;s brief: {error} <button onClick={() => load(true)} className="underline ml-1">Try again</button></p>}
          {state === 'ok' && brief && (
            <>
              <h2 className="text-base md:text-lg font-bold text-gray-900 mt-1 leading-snug">{brief.headline}</h2>
              {brief.facts.decisions?.some(dc => dc.verdict === 'scale' || dc.verdict === 'cut' || dc.verdict === 'investigate') && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {brief.facts.decisions.filter(dc => dc.verdict === 'scale' || dc.verdict === 'cut' || dc.verdict === 'investigate').map(dc => {
                    const tone = dc.verdict === 'scale' ? 'bg-green-50 text-green-700 border-green-200' : dc.verdict === 'cut' ? 'bg-red-50 text-red-700 border-red-200' : dc.verdict === 'investigate' ? 'bg-amber-50 text-amber-700 border-amber-200' : dc.verdict === 'fine' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-500 border-gray-200';
                    const label = { scale: 'Scale', cut: 'Cut', investigate: 'Investigate', fine: 'Fine', hold: 'Hold', unknown: 'n/a' }[dc.verdict];
                    return (
                      <span key={dc.key} title={`${dc.reason}\n\nRule: ${dc.rule}`} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tone}`}>
                        {dc.question.replace(/\?$/, '')}: {label}{dc.subject ? ` · ${dc.subject}` : ''}
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{brief.summary}</p>
              <p className="text-sm mt-2"><span className="font-semibold text-gray-800">Recommendation: </span><span className="text-gray-700">{brief.recommendation}</span></p>
              {more && brief.drivers.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {brief.drivers.map((d, i) => <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-violet-400">•</span><span>{d}</span></li>)}
                </ul>
              )}
              {more && brief.watch && <p className="text-xs text-gray-500 mt-1.5"><span className="font-semibold">Watch: </span>{brief.watch}</p>}
              <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px]">
                <span className={`font-semibold ${pctTone(brief.facts.revenue.pct)}`}>Revenue {fmtPct(brief.facts.revenue.pct)}</span>
                {brief.facts.netSales && <span className={`font-semibold ${pctTone(brief.facts.netSales.pct)}`}>Net sales {fmtPct(brief.facts.netSales.pct)}</span>}
                <span className={`font-semibold ${pctTone(brief.facts.sessions.pct)}`}>Sessions {fmtPct(brief.facts.sessions.pct)}</span>
                <span className={`font-semibold ${pctTone(brief.facts.cvr.pct)}`}>CVR {fmtPct(brief.facts.cvr.pct)}</span>
                <span className={`font-semibold ${pctTone(brief.facts.aov.pct)}`}>AOV {fmtPct(brief.facts.aov.pct)}</span>
                {brief.facts.cac && <span className={`font-semibold ${pctTone(brief.facts.cac.blended.pct, true)}`}>Blended nCAC (7d) {fmtPct(brief.facts.cac.blended.pct)}</span>}
                <span className="text-gray-400">vs same weekday, prior 4 weeks</span>
                {(brief.drivers.length > 0 || brief.watch) && <button onClick={() => setMore(v => !v)} className="text-violet-600 font-semibold hover:underline">{more ? 'Less' : 'More'}</button>}
                <button onClick={() => setShowFacts(v => !v)} className="text-violet-600 font-semibold hover:underline">{showFacts ? 'Hide the numbers' : 'Show the numbers'}</button>
                <Link href="/dashboard/insights" className="text-violet-600 font-semibold hover:underline">Ask {client.analyst.name} →</Link>
              </div>
              {showFacts && brief.facts.decisions?.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {brief.facts.decisions.map(dc => (
                    <div key={dc.key} className="rounded-xl bg-gray-50 p-2.5 text-xs">
                      <p className="font-semibold text-gray-800">{dc.question} <span className="uppercase text-[10px] tracking-wide text-violet-700 ml-1">{dc.verdict}{dc.subject ? ` · ${dc.subject}` : ''}</span></p>
                      <p className="text-gray-600 mt-0.5">{dc.reason}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Rule: {dc.rule}</p>
                    </div>
                  ))}
                </div>
              )}
              {showFacts && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[['Total revenue', brief.facts.revenue, '$'], ['Net sales', brief.facts.netSales || brief.facts.revenue, '$'], ['Orders', brief.facts.orders, ''], ['AOV', brief.facts.aov, '$'], ['Sessions', brief.facts.sessions, ''], ['Conversion (Shopify)', brief.facts.cvr, '%'], ['Ad spend', brief.facts.spendYesterday.total, '$']].map(([label, d, unit]) => {
                    const x = d as { current: number; baseline: number; pct: number | null };
                    const f = (v: number) => (unit === '$' ? `$${Math.round(v).toLocaleString()}` : unit === '%' ? `${v.toFixed(1)}%` : Math.round(v).toLocaleString());
                    return (
                      <div key={String(label)} className="rounded-xl bg-gray-50 p-2">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">{String(label)}</p>
                        <p className="font-bold text-gray-800">{f(x.current)} <span className={`text-[11px] ${pctTone(x.pct, String(label) === 'Ad spend')}`}>{fmtPct(x.pct)}</span></p>
                        <p className="text-[10px] text-gray-400">typical {f(x.baseline)}</p>
                      </div>
                    );
                  })}
                  {brief.facts.devices.map(dv => (
                    <div key={dv.device} className="rounded-xl bg-gray-50 p-2">
                      <p className="text-[10px] uppercase text-gray-400 font-semibold">{dv.device} CVR</p>
                      <p className="font-bold text-gray-800">{dv.cvr.current.toFixed(1)}% <span className={`text-[11px] ${pctTone(dv.cvr.pct)}`}>{fmtPct(dv.cvr.pct)}</span></p>
                      <p className="text-[10px] text-gray-400">{dv.sessions.toLocaleString()} sessions · typical {dv.cvr.baseline.toFixed(1)}%</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
