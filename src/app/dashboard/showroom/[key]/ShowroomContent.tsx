'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';
import type { ShowroomData, ShowroomDraft, ShowroomLine, ShowroomOrder } from '@/src/lib/showroom';

interface Resp extends Partial<ShowroomData> { source?: string; error?: string }

const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const $c = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number) => Math.round(v).toLocaleString();
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

// Status chips carry a word as well as a colour.
function Chip({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info' | 'mute'; children: React.ReactNode }) {
  const cls = {
    good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-800', bad: 'bg-red-50 text-red-700',
    info: 'bg-blue-50 text-blue-700', mute: 'bg-gray-100 text-gray-600',
  }[tone];
  return <span className={`inline-block whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

function fulfillmentChip(o: ShowroomOrder) {
  if (o.cancelled) return <Chip tone="mute">Cancelled</Chip>;
  if (o.fulfillment === 'FULFILLED') return <Chip tone="good">Shipped</Chip>;
  if (o.fulfillment === 'PARTIALLY_FULFILLED') return <Chip tone="warn">Partly shipped</Chip>;
  if (o.fulfillment === 'UNFULFILLED') return <Chip tone="warn">Not shipped yet</Chip>;
  return <Chip tone="info">{words(o.fulfillment || 'Unknown')}</Chip>;
}
function paymentChip(o: ShowroomOrder) {
  const f = o.financial;
  if (f === 'PAID') return <Chip tone="good">Paid</Chip>;
  if (f === 'PARTIALLY_REFUNDED' || f === 'REFUNDED') return <Chip tone="bad">{words(f)}</Chip>;
  if (f === 'PENDING' || f === 'PARTIALLY_PAID' || f === 'AUTHORIZED') return <Chip tone="warn">{words(f)}</Chip>;
  return <Chip tone="mute">{words(f || 'Unknown')}</Chip>;
}

function Lines({ lines, kind }: { lines: ShowroomLine[]; kind: 'draft' | 'order' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
            <th className="py-1.5 pr-3 font-semibold">Item</th>
            <th className="py-1.5 pr-3 font-semibold">SKU</th>
            <th className="py-1.5 pr-3 font-semibold text-right">Qty</th>
            {kind === 'draft' && <th className="py-1.5 pr-3 font-semibold text-right">On hand</th>}
            <th className="py-1.5 pr-3 font-semibold">{kind === 'draft' ? 'Stock' : 'Shipping'}</th>
            <th className="py-1.5 font-semibold text-right">Line total</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 text-gray-800">{l.title}{l.variant && <span className="text-gray-400"> · {l.variant}</span>}</td>
              <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{l.sku || '—'}</td>
              <td className="py-1.5 pr-3 text-right text-gray-800">{l.quantity}</td>
              {kind === 'draft' && <td className="py-1.5 pr-3 text-right text-gray-500">{l.onHand == null ? '—' : n(l.onHand)}</td>}
              <td className="py-1.5 pr-3">
                {kind === 'draft'
                  ? l.onHand == null ? <Chip tone="mute">Not tracked</Chip>
                    : l.short ? <Chip tone="bad">Short {l.short}</Chip> : <Chip tone="good">In stock</Chip>
                  : l.quantity === 0 ? <Chip tone="mute">Removed</Chip>
                    : l.unfulfilled ? <Chip tone="warn">{l.unfulfilled} to ship</Chip> : <Chip tone="good">Shipped</Chip>}
              </td>
              <td className="py-1.5 text-right text-gray-800">{$c(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Expander({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-expanded={open} aria-label={label} className="w-6 h-6 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300">
      <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
    </button>
  );
}

function DraftRow({ d }: { d: ShowroomDraft }) {
  const [open, setOpen] = useState(false);
  const age = daysSince(d.createdAt);
  return (
    <Fragment>
      <tr className="border-t border-gray-100 align-top">
        <td className="py-2.5 pr-1"><Expander open={open} onClick={() => setOpen(o => !o)} label={`Items on ${d.name}`} /></td>
        <td className="py-2.5 pr-3 font-semibold whitespace-nowrap"><a href={d.url} target="_blank" rel="noopener noreferrer" title="Open in Shopify" className="text-violet-700 underline decoration-violet-200 underline-offset-2 hover:decoration-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300 rounded">{d.name}</a></td>
        <td className="py-2.5 pr-3">
          <p className="font-medium text-gray-800">{d.account}</p>
          <p className="text-[11px] text-gray-400">{[d.buyer !== d.account ? d.buyer : '', d.place].filter(Boolean).join(' · ')}</p>
        </td>
        <td className="py-2.5 pr-3 whitespace-nowrap text-gray-600">{day(d.createdAt)}<p className={`text-[11px] ${age >= 14 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>waiting {age} day{age === 1 ? '' : 's'}</p></td>
        <td className="py-2.5 pr-3">{d.status === 'INVOICE_SENT' ? <Chip tone="info">Invoice sent</Chip> : <Chip tone="warn">Open draft</Chip>}</td>
        <td className="py-2.5 pr-3">{d.unitsShort ? <Chip tone="bad">{d.unitsShort} unit{d.unitsShort === 1 ? '' : 's'} short</Chip> : <Chip tone="good">All in stock</Chip>}</td>
        <td className="py-2.5 pr-3 text-right text-gray-600">{n(d.units)}</td>
        <td className="py-2.5 text-right font-semibold text-gray-800">{$c(d.total)}</td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={7} className="pb-4">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              {d.note && <p className="text-xs text-gray-600 whitespace-pre-line mb-2"><span className="font-semibold">Note:</span> {d.note}</p>}
              <Lines lines={d.lines} kind="draft" />
              {d.moreLines && <p className="text-[11px] text-gray-400 mt-2">Showing the first {d.lines.length} lines; open the draft in Shopify for the rest.</p>}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function OrderRow({ o, showroomKey }: { o: ShowroomOrder; showroomKey: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ShowroomLine[] | null>(null);
  const [err, setErr] = useState('');
  const toggle = () => {
    setOpen(v => !v);
    if (lines || open) return;
    fetch(`/api/showroom/${showroomKey}?order=${encodeURIComponent(o.id)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { lines?: ShowroomLine[]; error?: string }) => (j.lines ? setLines(j.lines) : setErr(j.error || 'Could not load the items.')))
      .catch(() => setErr('Could not load the items.'));
  };
  return (
    <Fragment>
      <tr className={`border-t border-gray-100 align-top ${o.cancelled ? 'opacity-60' : ''}`}>
        <td className="py-2.5 pr-1"><Expander open={open} onClick={toggle} label={`Items on ${o.name}`} /></td>
        <td className="py-2.5 pr-3 font-semibold whitespace-nowrap"><a href={o.url} target="_blank" rel="noopener noreferrer" title="Open in Shopify" className="text-violet-700 underline decoration-violet-200 underline-offset-2 hover:decoration-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300 rounded">{o.name}</a></td>
        <td className="py-2.5 pr-3">
          <p className="font-medium text-gray-800">{o.account} {o.firstOrder && <Chip tone="info">First order</Chip>}</p>
          <p className="text-[11px] text-gray-400">{[o.buyer !== o.account ? o.buyer : '', o.place].filter(Boolean).join(' · ')}</p>
        </td>
        <td className="py-2.5 pr-3 whitespace-nowrap text-gray-600">{day(o.createdAt)}</td>
        <td className="py-2.5 pr-3">{paymentChip(o)}</td>
        <td className="py-2.5 pr-3">{fulfillmentChip(o)}</td>
        <td className="py-2.5 pr-3 text-right text-gray-600">{n(o.units)}</td>
        <td className="py-2.5 text-right font-semibold text-gray-800">
          {$c(o.total)}
          {Math.abs(o.originalTotal - o.total) >= 0.01 && <p className="text-[11px] font-normal text-gray-400">written for {$c(o.originalTotal)}</p>}
        </td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={7} className="pb-4">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              {o.note && <p className="text-xs text-gray-600 whitespace-pre-line mb-2"><span className="font-semibold">Note:</span> {o.note}</p>}
              {err ? <p className="text-xs text-red-600">{err}</p> : lines ? <Lines lines={lines} kind="order" /> : <p className="text-xs text-gray-400">Loading items…</p>}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

const TH = 'py-2 pr-3 font-semibold';

export default function ShowroomContent({ showroomKey }: { showroomKey: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [search, setSearch] = useState('');
  const { data: session } = useSession();

  useEffect(() => {
    setData(null);
    fetch(`/api/showroom/${showroomKey}`, { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ source: 'error', error: 'Failed to load' }));
  }, [showroomKey]);

  const t = data?.totals;
  const q = search.trim().toLowerCase();
  const orders = useMemo(() => (data?.orders || []).filter(o => !q || `${o.name} ${o.account} ${o.buyer} ${o.place}`.toLowerCase().includes(q)), [data, q]);
  // Orders grouped under month headings, newest month first.
  const months = useMemo(() => {
    const out: Array<{ month: string; rows: ShowroomOrder[]; total: number }> = [];
    for (const o of orders) {
      const m = o.createdAt.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.month !== m) { g = { month: m, rows: [], total: 0 }; out.push(g); }
      g.rows.push(o);
      if (!o.cancelled) g.total += o.total;
    }
    return out;
  }, [orders]);
  const label = data?.showroom?.label || 'Showroom';
  const tag = data?.showroom?.tag;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Header
        title={label}
        subtitle={data?.showroom ? `${data.showroom.city ? `${data.showroom.city} · ` : ''}wholesale orders and draft orders tagged "${tag}" in Shopify · live` : 'Wholesale showroom'}
      >
        {/* Team only: the showroom's own logins cannot open the release page. */}
        {session?.user?.role !== 'sales' && session?.user?.role !== 'partner' && (
          <Link href="/dashboard/wholesale-release" className="inline-block text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-2">Back in stock: choose what opens to wholesale →</Link>
        )}
      </Header>
      {!data && <p className="text-xs text-gray-400 mb-4">Loading orders and drafts from Shopify…</p>}
      {data?.error && <Card className="mb-6 border-red-100"><p className="text-sm text-red-600">{data.error}</p></Card>}

      {data && !data.error && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <MetricCard title="Orders Placed" value={$(t.total)} subtitle={`${n(t.orders)} order${t.orders === 1 ? '' : 's'} · ${n(t.units)} units · all time`} accentColor="#818cf8" />
            <MetricCard title="Backorders Pending" value={$(t.pendingTotal)} subtitle={`${n(t.pendingDrafts)} draft${t.pendingDrafts === 1 ? '' : 's'} · ${n(t.pendingUnits)} units not yet ordered`} accentColor="#fbbf24" />
            <MetricCard title="Accounts" value={n(t.accounts)} subtitle="stores with at least one order" accentColor="#34d399" />
            <MetricCard title="Average Order" value={$(t.aov)} subtitle={t.unshippedOrders ? `${n(t.unshippedOrders)} order${t.unshippedOrders === 1 ? '' : 's'} not fully shipped` : 'every order shipped'} accentColor="#f9a8d4" />
          </div>

          {/* Backorders: drafts that have not become orders yet */}
          <Card className="mb-6" accentColor="#fbbf24">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
              <h2 className="text-sm font-bold text-gray-800">Backorders pending in draft</h2>
              <p className="text-xs text-gray-400">{n(t.pendingDrafts)} draft{t.pendingDrafts === 1 ? '' : 's'} · {$c(t.pendingTotal)}{t.pendingUnitsShort ? ` · ${n(t.pendingUnitsShort)} units short of stock` : ''}</p>
            </div>
            <p className="text-xs text-gray-400 mb-3">Draft orders that have not been completed, longest-waiting first. Open a row to see each item against the stock on hand right now.</p>
            {data.drafts?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                      <th className="w-7" /><th className={TH}>Draft</th><th className={TH}>Account</th><th className={TH}>Created</th><th className={TH}>Status</th><th className={TH}>Stock</th>
                      <th className={`${TH} text-right`}>Units</th><th className="py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">{data.drafts.map(d => <DraftRow key={d.id} d={d} />)}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-400 py-3">No drafts waiting. Every {label} draft has become an order.</p>}
          </Card>

          {/* Order history */}
          <Card className="mb-6" accentColor="#818cf8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-bold text-gray-800">Orders placed</h2>
                <p className="text-xs text-gray-400">Every order tagged &quot;{tag}&quot;, newest first. Totals are what each order stands at today, after edits and refunds.</p>
              </div>
              <input
                id="showroom-order-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search account, buyer or order #" aria-label="Search orders"
                className="w-full sm:w-64 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            {data.truncated && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">Showing the most recent 1,000 orders; older ones are left out of this list and the totals above.</p>}
            {orders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                      <th className="w-7" /><th className={TH}>Order</th><th className={TH}>Account</th><th className={TH}>Date</th><th className={TH}>Payment</th><th className={TH}>Shipping</th>
                      <th className={`${TH} text-right`}>Units</th><th className="py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {months.map(g => (
                      <Fragment key={g.month}>
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-2 py-1.5 text-xs font-bold text-gray-600">{monthLabel(g.month)} <span className="font-normal text-gray-400">· {g.rows.length} order{g.rows.length === 1 ? '' : 's'}</span></td>
                          <td className="py-1.5 text-right text-xs font-bold text-gray-600">{$c(g.total)}</td>
                        </tr>
                        {g.rows.map(o => <OrderRow key={o.id} o={o} showroomKey={showroomKey} />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-400 py-3">{q ? 'No orders match that search.' : `No orders tagged "${tag}" yet.`}</p>}
          </Card>

          {/* Accounts roll-up */}
          {Boolean(data.accounts?.length) && (
            <Card accentColor="#34d399">
              <h2 className="text-sm font-bold text-gray-800 mb-1">Accounts</h2>
              <p className="text-xs text-gray-400 mb-3">Each store&apos;s orders to date and what is still waiting in draft.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                      <th className={TH}>Account</th><th className={`${TH} text-right`}>Orders</th><th className={`${TH} text-right`}>Units</th><th className={`${TH} text-right`}>Ordered</th>
                      <th className={`${TH} text-right`}>Pending in draft</th><th className="py-2 font-semibold text-right">Last order</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.accounts!.map(a => (
                      <tr key={a.key} className="border-t border-gray-100">
                        <td className="py-2 pr-3"><span className="font-medium text-gray-800">{a.account}</span>{a.place && <span className="text-[11px] text-gray-400"> · {a.place}</span>}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{n(a.orders)}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{n(a.units)}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-gray-800">{$c(a.total)}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{a.pendingDrafts ? `${$c(a.pendingTotal)} · ${a.pendingDrafts} draft${a.pendingDrafts === 1 ? '' : 's'}` : '—'}</td>
                        <td className="py-2 text-right text-gray-600 whitespace-nowrap">{a.lastOrder ? day(a.lastOrder) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <p className="text-[11px] text-gray-300 mt-4">Read live from Shopify · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) : ''} Central</p>
        </>
      )}
    </div>
  );
}
