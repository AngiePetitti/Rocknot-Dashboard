'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import type { ReleaseRow } from '@/src/lib/wholesaleRelease';

interface Resp { rows?: ReleaseRow[]; reserveWeeks?: number; rep?: { name: string; email: string }; copied?: string[]; emailReady?: boolean; error?: string }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const name = (r: { product: string; variant: string }) => `${r.product}${r.variant && !/^default title$/i.test(r.variant) ? ` · ${r.variant}` : ''}`;
// Same arithmetic as the alert email (src/lib/wholesaleRelease.ts).
const hold = (weekly: number, weeks: number) => Math.ceil(Math.max(0, weekly) * Math.max(0, weeks));
const suggest = (stock: number, weekly: number, weeks: number) => Math.max(0, Math.floor(stock) - hold(weekly, weeks));

export default function ReleaseContent() {
  const [data, setData] = useState<Resp | null>(null);
  const [weeks, setWeeks] = useState(8);
  // Per item: is it going out, and a quantity the owner typed (otherwise the suggestion is used).
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => fetch('/api/wholesale-release', { cache: 'no-store' }).then(r => r.json()).then((j: Resp) => {
    setData(j);
    if (typeof j.reserveWeeks === 'number') setWeeks(j.reserveWeeks);
    if (j.rep?.email) setTo(j.rep.email);
  }).catch(() => setData({ error: 'Failed to load' }));
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => (data?.rows || []).map(r => {
    const suggestion = suggest(r.stock, r.weeklySales, weeks);
    const raw = typed[r.key];
    // `qty` on the row is the units seen when it came back; `offer` is what goes to the rep.
    const offer = raw === undefined ? suggestion : Math.max(0, Math.floor(Number(raw) || 0));
    // Until the owner ticks or unticks a row, it goes out when DTC leaves something over and it has not been sent before.
    const on = picked[r.key] ?? (suggestion > 0 && !r.releasedAt);
    return { ...r, suggestion, offer, on, over: offer > r.stock };
  }), [data, weeks, typed, picked]);
  const sending = rows.filter(r => r.on && r.offer > 0);
  const anyOver = sending.some(r => r.over);
  const repName = data?.rep?.name || 'the sales rep';

  const send = async () => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/wholesale-release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, note, items: sending.map(r => ({ key: r.key, qty: r.offer })) }) });
      const j = await res.json() as { ok?: boolean; sent?: number; to?: string; saved?: boolean; error?: string };
      if (j.ok) {
        setResult({ ok: true, text: `Sent ${j.sent} item${j.sent === 1 ? '' : 's'} to ${j.to}.${j.saved === false ? ' The email went out, but the list below could not be marked as sent.' : ''}` });
        setPicked({}); setTyped({});
        await load();
      } else setResult({ ok: false, text: j.error || 'The email was not sent.' });
    } catch { setResult({ ok: false, text: 'The email was not sent: the dashboard could not be reached.' }); }
    setBusy(false);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header title="Wholesale Release" subtitle={`Items back in stock in the last 30 days · decide what opens to wholesale, then send the list to ${repName}`} />
      {!data && <p className="text-xs text-gray-400 mb-4">Loading restocked items and current stock…</p>}
      {data?.error && <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>}

      {data && !data.error && (
        <>
          <Card className="mb-6" accentColor="#34d399">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-800">DTC first</h2>
                <p className="text-xs text-gray-400 max-w-2xl">Each item holds back enough units to cover the store&apos;s own sales for the number of weeks set here. Only what is left is suggested for wholesale. Change any quantity before sending.</p>
              </div>
              <label htmlFor="release-weeks" className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                Hold for DTC
                <input id="release-weeks" type="number" min={0} max={52} step={1} value={weeks} onChange={e => setWeeks(Math.max(0, Math.min(52, Number(e.target.value) || 0)))} className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-violet-300" />
                weeks of sales
              </label>
            </div>

            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                      <th className="py-2 pr-2 font-semibold">Send</th><th className="py-2 pr-3 font-semibold">Item</th><th className="py-2 pr-3 font-semibold">Back on</th>
                      <th className="py-2 pr-3 font-semibold text-right">On hand</th><th className="py-2 pr-3 font-semibold text-right">Selling / wk</th>
                      <th className="py-2 pr-3 font-semibold text-right">Hold for DTC</th><th className="py-2 font-semibold text-right">Open to wholesale</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {rows.map(r => (
                      <tr key={r.key} className="border-t border-gray-100">
                        <td className="py-2 pr-2">
                          <input id={`release-pick-${r.key}`} type="checkbox" checked={r.on} disabled={r.stock <= 0} onChange={e => setPicked(p => ({ ...p, [r.key]: e.target.checked }))} aria-label={`Send ${name(r)}`} className="w-4 h-4 accent-violet-600" />
                        </td>
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-800">{name(r)}</p>
                          {r.releasedAt && <p className="text-[11px] text-emerald-700">Sent to {repName} {day(r.releasedAt)} · {r.releasedQty} units</p>}
                          {r.stock <= 0 && <p className="text-[11px] text-red-600">Sold out again</p>}
                        </td>
                        <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{day(r.detectedAt)} <span className="text-[11px] text-gray-400">· {r.qty} then</span></td>
                        <td className="py-2 pr-3 text-right font-semibold text-gray-800">{r.stock.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{r.weeklySales >= 0.05 ? r.weeklySales.toFixed(1) : '—'}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{Math.min(r.stock, hold(r.weeklySales, weeks)).toLocaleString()}</td>
                        <td className="py-2 text-right">
                          <input
                            id={`release-qty-${r.key}`} type="number" min={0} max={r.stock} step={1} value={typed[r.key] ?? String(r.suggestion)} disabled={!r.on}
                            onChange={e => setTyped(t => ({ ...t, [r.key]: e.target.value }))} aria-label={`Units of ${name(r)} open to wholesale`}
                            className={`w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50 disabled:text-gray-400 ${r.on && r.over ? 'border-red-400' : 'border-gray-200'}`}
                          />
                          {r.on && r.over && <p className="text-[11px] text-red-600">only {r.stock} on hand</p>}
                          {r.on && !r.over && r.offer > r.suggestion && <p className="text-[11px] text-amber-700">cuts into the DTC hold</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 py-3">Nothing has come back in stock in the last 30 days. The dashboard checks every morning and emails you when an out-of-stock item has units again; it will then appear here.</p>
            )}
          </Card>

          {rows.length > 0 && (
            <Card accentColor="#818cf8">
              <h2 className="text-sm font-bold text-gray-800 mb-1">Send to {repName}</h2>
              <p className="text-xs text-gray-400 mb-3">{repName} gets the item names and the units open to wholesale. Stock on hand, sales pace and the DTC hold are not included.{data.copied?.length ? ` Copied: ${data.copied.join(', ')}.` : ''}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <label htmlFor="release-to" className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                  {repName}&apos;s email
                  <input id="release-to" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@showroom.com" className="text-sm font-normal border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </label>
                <label htmlFor="release-note" className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                  Note (optional)
                  <textarea id="release-note" value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Hoodies ship the week of Dec 1." className="text-sm font-normal border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </label>
              </div>
              {data.emailReady === false && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">Email is not set up on this dashboard yet (RESEND_API_KEY in Vercel), so nothing can be sent.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={send} disabled={busy || !sending.length || anyOver || !to.trim() || data.emailReady === false} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300">
                  {busy ? 'Sending…' : `Send ${sending.length} item${sending.length === 1 ? '' : 's'} to ${repName}`}
                </button>
                <p className="text-xs text-gray-400">{sending.reduce((s, r) => s + r.offer, 0).toLocaleString()} units across {sending.length} item{sending.length === 1 ? '' : 's'}</p>
              </div>
              {result && <p role="status" className={`text-sm mt-3 ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.text}</p>}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
