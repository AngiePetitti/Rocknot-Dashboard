'use client';

import { cachedJson } from '@/src/lib/clientCache';
import { useEffect, useState, useMemo } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface InventoryItem {
  productUnitsSold90d?: number;
  id: string;
  product: string;
  variant: string;
  category: string;
  currentStock: number;
  unitsSold90d: number;
  dailyVelocity: number;
  daysRemaining: number | null;
  sellThroughRate: number;
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy';
  reorderQty: number;
  stockValue: number;
  retailValue: number;
  unitPrice: number;
}

interface InventoryFinance {
  totalCostValue: number;
  totalRetailValue: number;
  potentialProfit: number;
  slowStockCostValue: number;
  slowStockUnits: number;
  slowStockCount: number;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

const STATUS_CONFIG = {
  out_of_stock: { label: 'Out of Stock', bg: '#fee2e2', text: '#dc2626', dot: '#ef4444' },
  critical:     { label: 'Critical',     bg: '#ffedd5', text: '#ea580c', dot: '#f97316' },
  low:          { label: 'Low Stock',    bg: '#fef9c3', text: '#ca8a04', dot: '#eab308' },
  healthy:      { label: 'Healthy',      bg: '#dcfce7', text: '#16a34a', dot: '#22c55e' },
};

type FilterStatus = 'all' | 'out_of_stock' | 'critical' | 'low' | 'healthy';
type SortKey = 'daysRemaining' | 'currentStock' | 'unitsSold90d' | 'sellThroughRate' | 'reorderQty' | 'unitPrice';
type BagSortKey = 'currentStock' | 'unitsSold90d' | 'daysRemaining' | 'reorderQty' | 'unitPrice';

function Collapsible({ icon, title, summary, defaultOpen = false, children }: {
  icon: string; title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-100 rounded-2xl mb-4 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors">
        <span className="text-base">{icon}</span>
        <span className="text-sm font-bold text-gray-700 whitespace-nowrap">{title}</span>
        <span className="text-xs text-gray-400 flex-1 min-w-0 truncate text-right">{summary || ''}</span>
        <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-1 pb-1">{children}</div>}
    </div>
  );
}

export default function InventoryContent() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [bags, setBags] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [counts, setCounts] = useState({ outOfStock: 0, critical: 0, low: 0, healthy: 0 });
  const [finance, setFinance] = useState<InventoryFinance | null>(null);
  const [moveOrDiscount, setMoveOrDiscount] = useState<InventoryItem[]>([]);
  const [moveExpanded, setMoveExpanded] = useState(false);
  // Tap a truncated product name (mobile) to reveal the full title.
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const toggleName = (id: string) => setExpandedNames(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('daysRemaining');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [bagSortKey, setBagSortKey] = useState<BagSortKey>('currentStock');
  const [bagSortDir, setBagSortDir] = useState<'asc' | 'desc'>('asc');
  const [bagExpanded, setBagExpanded] = useState(false);
  const [restockExpanded, setRestockExpanded] = useState(false);
  const BAG_PAGE = 10;

  // ── Purchase orders (reorders) ──
  interface Reorder { id: string; product: string; variant: string; qty: number; orderedDate: string; orderedBy: string; status: 'open' | 'received'; receivedDate?: string; eta?: string }
  const [reorders, setReorders] = useState<Reorder[]>([]);
  const [orderFormId, setOrderFormId] = useState<string | null>(null);
  const [orderQty, setOrderQty] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
  const [orderEta, setOrderEta] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  });
  const [showReceived, setShowReceived] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Discontinued (seasonal, not coming back) — skipped from order alerts ──
  interface Discontinued { product: string; variant: string; skippedBy: string; date: string }
  const [discontinued, setDiscontinued] = useState<Discontinued[]>([]);
  function loadDiscontinued() {
    fetch('/api/discontinued', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.discontinued)) setDiscontinued(d.discontinued); })
      .catch(() => {});
  }
  useEffect(() => { loadDiscontinued(); }, []);
  const discontinuedKeys = useMemo(
    () => new Set(discontinued.map(d => `${d.product}|${d.variant}`.toLowerCase())),
    [discontinued]
  );
  async function skipItem(item: { product: string; variant: string }) {
    setDiscontinued(prev => [...prev, { ...item, skippedBy: '', date: '' }]);
    try {
      await fetch('/api/discontinued', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: item.product, variant: item.variant }),
      });
    } finally {
      loadDiscontinued();
    }
  }
  async function unskipItem(item: { product: string; variant: string }) {
    setDiscontinued(prev => prev.filter(d => `${d.product}|${d.variant}`.toLowerCase() !== `${item.product}|${item.variant}`.toLowerCase()));
    try {
      await fetch('/api/discontinued', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: item.product, variant: item.variant }),
      });
    } finally {
      loadDiscontinued();
    }
  }

  function loadReorders() {
    fetch('/api/reorders', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.reorders)) setReorders(d.reorders); })
      .catch(() => {});
  }
  useEffect(() => { loadReorders(); }, []);

  const openReorders = useMemo(
    () => [...reorders.filter(r => r.status === 'open')].sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999')),
    [reorders]
  );
  const receivedReorders = useMemo(
    () => [...reorders.filter(r => r.status === 'received')].sort((a, b) => (b.receivedDate || '').localeCompare(a.receivedDate || '')).slice(0, 15),
    [reorders]
  );
  const todayStrPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  function etaBadge(eta?: string): { label: string; cls: string } {
    if (!eta) return { label: 'no ETA', cls: 'bg-gray-100 text-gray-500' };
    const days = Math.round((Date.parse(eta) - Date.parse(todayStrPst)) / 86400000);
    if (days < 0) return { label: `overdue ${-days}d`, cls: 'bg-red-100 text-red-700' };
    if (days === 0) return { label: 'arrives today', cls: 'bg-green-100 text-green-700' };
    if (days <= 7) return { label: `arrives in ${days}d`, cls: 'bg-green-100 text-green-700' };
    return { label: `arrives ${eta.slice(5)}`, cls: 'bg-blue-100 text-blue-700' };
  }
  const onOrderKeys = useMemo(
    () => new Set(openReorders.map(r => `${r.product}|${r.variant}`.toLowerCase())),
    [openReorders]
  );

  async function markOrdered(item: { id: string; product: string; variant: string; reorderQty: number; remainingQty?: number }) {
    setSavingOrder(true);
    try {
      const res = await fetch('/api/reorders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: item.product,
          variant: item.variant,
          qty: Number(orderQty) || item.remainingQty || item.reorderQty,
          orderedDate: orderDate,
          eta: orderEta,
        }),
      });
      if (res.ok) { setOrderFormId(null); loadReorders(); }
    } finally {
      setSavingOrder(false);
    }
  }

  const [editReorderId, setEditReorderId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editEta, setEditEta] = useState('');

  async function saveReorderEdit(id: string) {
    const qty = Math.round(Number(editQty) || 0);
    if (qty <= 0) return;
    setReorders(prev => prev.map(r => r.id === id ? { ...r, qty, eta: editEta || r.eta } : r));
    setEditReorderId(null);
    try {
      await fetch('/api/reorders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'edit', qty, ...(editEta ? { eta: editEta } : {}) }),
      });
    } catch { /* optimistic state stands; next load reconciles */ }
    loadReorders();
  }

  async function reorderAction(id: string, action: 'received' | 'delete') {
    setReorders(prev => action === 'delete' || action === 'received'
      ? prev.map(r => r.id === id ? { ...r, status: 'received' as const } : r).filter(r => !(action === 'delete' && r.id === id))
      : prev);
    try {
      await fetch('/api/reorders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
    } finally {
      loadReorders();
    }
  }

  function copyOrderList() {
    const lines = toOrderList.map(i => `${i.product}${i.variant ? ` – ${i.variant}` : ''}: order ${i.remainingQty}${i.incomingQty > 0 ? ` (${i.incomingQty} already incoming)` : ''}`);
    const text = `Rocknot restock order — ${new Date().toLocaleDateString()}\n${lines.join('\n')}`;
    try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  useEffect(() => {
    setStatus('loading');
    cachedJson<Record<string, unknown> & { source?: string }>(
      '/api/windsor/inventory',
      (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.source === 'shopify_live') {
          setItems(data.items || []);
          setBags(data.bags || []);
          setCategories(data.categories || []);
          setFinance(data.finance || null);
          setMoveOrDiscount(data.moveOrDiscount || []);
          setCounts({
            outOfStock: data.outOfStock ?? 0,
            critical: data.critical ?? 0,
            low: data.low ?? 0,
            healthy: data.healthy ?? 0,
          });
          setStatus('ok');
        } else {
          setStatus('error');
        }
      },
      () => setStatus('error')
    );
  }, []);

  const handleBagSort = (key: BagSortKey) => {
    if (bagSortKey === key) setBagSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setBagSortKey(key); setBagSortDir('asc'); }
  };
  const bagArrow = (key: BagSortKey) => bagSortKey === key ? (bagSortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const sortedBags = useMemo(() => {
    const sorted = [...bags].sort((a, b) => {
    if (bagSortKey === 'daysRemaining') {
      if (a.daysRemaining === null && b.daysRemaining === null) return 0;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
    }
    const av = a[bagSortKey] ?? 0;
    const bv = b[bagSortKey] ?? 0;
    return bagSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [bags, bagSortKey, bagSortDir]);
  const visibleBags = bagExpanded ? sortedBags : sortedBags.slice(0, BAG_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const filtered = useMemo(() => {
    let result = items;
    if (filterStatus !== 'all') result = result.filter(i => i.status === filterStatus);
    if (filterCategory !== 'all') result = result.filter(i => i.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.product.toLowerCase().includes(q) || i.variant.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      if (sortKey === 'daysRemaining') {
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
      }
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [items, filterStatus, filterCategory, search, sortKey, sortDir]);

  // "Restock now" = genuinely fast sellers that are running out, not just
  // anything at zero. We rank by velocity (units/day over the 90-day window)
  // and only surface items moving fast enough to matter, that are out or about
  // to be (≤ 7 days of cover left). Sorted fastest-first.
  const restockNow = useMemo(() => {
    // Bags are tracked separately from the SKU list (true bag stock), so
    // include BOTH pools in the order candidates.
    return [...bags, ...items]
      .filter(i =>
        i.dailyVelocity >= 0.25 && // ~1+ unit / 4 days — a real mover
        (i.status === 'out_of_stock' || i.status === 'critical')
      )
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity);
  }, [items, bags]);

  // The Monday order list = restock candidates minus anything already on order.
  // Skipped seasonal items leave the slow/dead list instantly (server drops
  // them from the totals on the next load).
  const visibleMove = useMemo(
    () => moveOrDiscount.filter(i => !discontinuedKeys.has(`${i.product}|${i.variant}`.toLowerCase())),
    [moveOrDiscount, discontinuedKeys]
  );

  // Units already on an open PO, per product+variant — a partial order nets
  // DOWN the recommended quantity instead of removing the item entirely.
  const incomingByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of openReorders) {
      const k = `${r.product}|${r.variant}`.toLowerCase();
      m.set(k, (m.get(k) || 0) + r.qty);
    }
    return m;
  }, [openReorders]);

  const toOrderList = useMemo(
    () => restockNow
      .filter(i => !discontinuedKeys.has(`${i.product}|${i.variant}`.toLowerCase()))
      .map(i => {
        const incoming = incomingByKey.get(`${i.product}|${i.variant}`.toLowerCase()) || 0;
        return { ...i, incomingQty: incoming, remainingQty: Math.max(0, i.reorderQty - incoming) };
      })
      // Fully covered by what's already inbound → off the list; partially
      // covered stays with the net quantity still needed.
      .filter(i => i.remainingQty > 0)
      // Alphabetical by product then variant so sizes of the same item sit
      // together — much easier to work down when placing one PO per product.
      .sort((a, b) => a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant, undefined, { numeric: true })),
    [restockNow, incomingByKey, discontinuedKeys]
  );

  return (
    <div>
      <Header
        title="Inventory & Reorder"
        subtitle="Stock levels, velocity, and reorder recommendations · 90-day velocity · 90-day supply target"
      />

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
          <span>⚠️</span>
          <span>Inventory data unavailable — Shopify query failed.</span>
        </div>
      )}

      {/* ── To Order This Monday — the weekly purchase list. Items marked
          ordered move to the "On order" section below and off this list
          (and off the Monday Slack alert). ── */}
      {status === 'ok' && toOrderList.length > 0 && (
        <div className="rounded-2xl mb-6 overflow-hidden shadow-lg shadow-orange-200/60 border-2 border-orange-400">
          <div className="bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3.5 flex items-center gap-3">
            <span className="text-2xl">🚨</span>
            <div className="flex-1 min-w-0">
              <p className="text-base font-extrabold text-white leading-tight uppercase tracking-wide">Order This Monday</p>
              <p className="text-[11px] text-orange-100">
                {toOrderList.length} item{toOrderList.length !== 1 ? 's' : ''} need ordering · quantities cover ~90 days at current pace
              </p>
            </div>
            <span className="text-2xl font-extrabold text-white bg-white/20 rounded-xl px-3 py-1">{toOrderList.length}</span>
            <button
              onClick={copyOrderList}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white text-orange-600 hover:bg-orange-50 whitespace-nowrap"
            >
              {copied ? '✓ Copied' : 'Copy list'}
            </button>
          </div>
          <div className="bg-orange-50 px-4 py-3">
          <p className="text-[11px] text-orange-600/80 mb-3">
            When an order is placed, tap <b>Ordered ✓</b> and log the quantity + dates — the item moves to the Order Tracker below and off Monday's Slack alert.
          </p>
          {/* Scrolls within the banner so a long list doesn't take over the
              page; full product names wrap on mobile instead of truncating. */}
          <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto overscroll-contain pr-0.5">
            {(restockExpanded ? toOrderList : toOrderList.slice(0, 8)).map(item => (
              <div key={item.id} className="bg-white border border-orange-200 rounded-lg px-3 py-2">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1">
                  <span
                    onClick={() => toggleName(item.id)}
                    className={`text-xs font-semibold text-gray-800 w-full sm:w-auto sm:flex-1 min-w-0 cursor-pointer break-words ${expandedNames.has(item.id) ? '' : 'sm:truncate'}`}
                  >
                    {item.product}{item.variant ? ` · ${item.variant}` : ''}
                  </span>
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">
                    {item.status === 'out_of_stock' ? 'OUT' : `${item.daysRemaining}d left`} · ~{Math.round(item.dailyVelocity * 7)}/wk
                  </span>
                  <span className="text-xs font-bold text-orange-700 whitespace-nowrap bg-orange-100 rounded-full px-2 py-0.5">
                    Order {item.remainingQty.toLocaleString()}{item.incomingQty > 0 ? ' more' : ''}
                  </span>
                  {item.incomingQty > 0 && (
                    <span className="text-[11px] font-semibold text-blue-600 whitespace-nowrap bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                      🚚 {item.incomingQty.toLocaleString()} incoming
                    </span>
                  )}
                  <button
                    onClick={() => setOrderFormId(orderFormId === item.id ? null : item.id)}
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-green-50 border border-green-200 text-green-700 whitespace-nowrap"
                  >
                    {orderFormId === item.id ? 'Cancel' : 'Ordered ✓'}
                  </button>
                  <button
                    onClick={() => skipItem(item)}
                    title="Seasonal / not coming back — remove from order alerts permanently"
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-700 whitespace-nowrap"
                  >
                    Skip ✕
                  </button>
                </div>
                {orderFormId === item.id && (
                  <form
                    onSubmit={e => { e.preventDefault(); markOrdered(item); }}
                    className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-orange-100"
                  >
                    <label className="text-[11px] text-gray-500">Qty ordered</label>
                    <input
                      type="number"
                      min={1}
                      value={orderQty}
                      onChange={e => setOrderQty(e.target.value)}
                      className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <label className="text-[11px] text-gray-500">on</label>
                    <input
                      type="date"
                      value={orderDate}
                      onChange={e => setOrderDate(e.target.value)}
                      className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <label className="text-[11px] text-gray-500">expected by</label>
                    <input
                      type="date"
                      value={orderEta}
                      onChange={e => setOrderEta(e.target.value)}
                      className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <button
                      type="submit"
                      disabled={savingOrder}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
                    >
                      {savingOrder ? 'Saving…' : 'Log order'}
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
          {toOrderList.length > 8 && (
            <button
              onClick={() => setRestockExpanded(e => !e)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 mt-2.5 flex items-center gap-1"
            >
              {restockExpanded ? '↑ Show less' : `↓ Show ${toOrderList.length - 8} more`}
            </button>
          )}
          </div>
        </div>
      )}

      {/* ── Order Tracker — every purchase order, its ETA countdown, and
          received history. This is where logged orders live. ── */}
      {status === 'ok' && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3.5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-bold text-blue-900 flex-1">
              🚚 Order Tracker{openReorders.length > 0 ? ` — ${openReorders.length} incoming` : ''}
            </p>
            {receivedReorders.length > 0 && (
              <button
                onClick={() => setShowReceived(v => !v)}
                className="text-[11px] font-semibold text-blue-500 hover:text-blue-700"
              >
                {showReceived ? 'Hide received' : `Received history (${receivedReorders.length})`}
              </button>
            )}
          </div>
          <p className="text-[11px] text-blue-500/80 mb-2.5">
            Incoming stock, soonest first — use the arrival dates to plan pre-orders and launches. Tap Received when a shipment lands.
          </p>
          {openReorders.length === 0 && (
            <p className="text-xs text-blue-400 mb-1">
              No orders in flight yet — when you tap <b>Ordered ✓</b> on an item in the order banner above, it appears here with its expected arrival date.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {openReorders.map(r => {
              const badge = etaBadge(r.eta);
              const editing = editReorderId === r.id;
              return (
                <div key={r.id} className="bg-white border border-blue-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-800 flex-1 min-w-0 truncate">
                      {r.product}{r.variant ? ` · ${r.variant}` : ''}
                    </span>
                    <span className="text-[11px] text-gray-500 whitespace-nowrap hidden sm:inline">
                      ×{r.qty.toLocaleString()} · ordered {r.orderedDate.slice(5)}{r.orderedBy ? ` by ${r.orderedBy}` : ''}
                    </span>
                    <span className="text-[11px] text-gray-500 whitespace-nowrap sm:hidden">×{r.qty.toLocaleString()}</span>
                    <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                    <button
                      onClick={() => {
                        if (editing) { setEditReorderId(null); return; }
                        setEditReorderId(r.id); setEditQty(String(r.qty)); setEditEta(r.eta || '');
                      }}
                      title="Edit quantity / arrival date"
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 whitespace-nowrap"
                    >
                      {editing ? 'Cancel' : '✏️ Edit'}
                    </button>
                    <button
                      onClick={() => reorderAction(r.id, 'received')}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-green-50 border border-green-200 text-green-700 whitespace-nowrap"
                    >
                      Received ✓
                    </button>
                    <button
                      onClick={() => reorderAction(r.id, 'delete')}
                      aria-label="Remove order"
                      className="text-gray-300 hover:text-red-500 px-1"
                    >
                      ✕
                    </button>
                  </div>
                  {editing && (
                    <form
                      onSubmit={e => { e.preventDefault(); saveReorderEdit(r.id); }}
                      className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-blue-100"
                    >
                      <label className="text-[11px] text-gray-500">Qty
                        <input
                          type="number"
                          min={1}
                          value={editQty}
                          onChange={e => setEditQty(e.target.value)}
                          className="w-20 ml-1.5 px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                        />
                      </label>
                      <label className="text-[11px] text-gray-500">Arrives
                        <input
                          type="date"
                          value={editEta}
                          onChange={e => setEditEta(e.target.value)}
                          className="ml-1.5 px-2 py-1 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-300"
                        />
                      </label>
                      <button type="submit" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                        Save
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {showReceived && receivedReorders.length > 0 && (
            <div className="mt-3 pt-2 border-t border-blue-100">
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1.5">Received</p>
              <div className="flex flex-col gap-1">
                {receivedReorders.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-[11px] text-gray-500 px-1">
                    <span className="flex-1 min-w-0 truncate">✓ {r.product}{r.variant ? ` · ${r.variant}` : ''}</span>
                    <span className="whitespace-nowrap">×{r.qty.toLocaleString()} · ordered {r.orderedDate.slice(5)} → received {(r.receivedDate || '').slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {discontinued.length > 0 && (
            <div className="mt-3 pt-2 border-t border-blue-100">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                Skipped — seasonal / not coming back ({discontinued.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {discontinued.map(d => (
                  <span key={`${d.product}|${d.variant}`} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
                    {d.product}{d.variant ? ` · ${d.variant}` : ''}
                    <button
                      onClick={() => unskipItem(d)}
                      title="Bring back — include in order alerts again"
                      className="text-gray-400 hover:text-green-600 font-bold"
                    >
                      ↺
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Inventory figures — always visible up top ── */}
      <div className="flex items-start gap-3 bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5 mb-4 text-xs text-violet-700">
        <span className="text-base mt-0.5">📦</span>
        <span>
          <strong>90-day supply target</strong> — velocity based on last 90 days of sales.
          Reorder Qty = units needed to bring stock back to 90 days of supply at current pace.
          True bag stock is shown in its own section from the hidden &quot;bag only&quot; listings; the public mix-and-match handbag listings (untracked) are excluded.
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Inventory Value (Cost)"
          value={status === 'loading' || !finance ? '—' : fmtMoney(finance.totalCostValue)}
          subtitle="Cash tied up in stock on hand"
          accentColor="#818cf8"
        />
        <MetricCard
          title="Retail Value on Hand"
          value={status === 'loading' || !finance ? '—' : fmtMoney(finance.totalRetailValue)}
          subtitle="Revenue sitting on the shelves"
          accentColor="#34d399"
        />
        <MetricCard
          title="Potential Profit"
          value={status === 'loading' || !finance ? '—' : fmtMoney(finance.potentialProfit)}
          subtitle="Retail minus cost, if it all sells"
          accentColor="#22c55e"
        />
        <MetricCard
          title="Slow / Dead Stock"
          value={status === 'loading' || !finance ? '—' : fmtMoney(finance.slowStockCostValue)}
          subtitle={finance
            ? `${finance.slowStockCount} SKUs · ${finance.slowStockUnits.toLocaleString()} units depreciating`
            : 'Cash not turning over'}
          accentColor="#f87171"
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Out of Stock"
          value={status === 'loading' ? '—' : counts.outOfStock.toString()}
          subtitle="Tracked SKUs sold to zero"
          accentColor="#fca5a5"
        />
        <MetricCard
          title="Critical Stock"
          value={status === 'loading' ? '—' : counts.critical.toString()}
          subtitle="Under 7 days remaining"
          accentColor="#fdba74"
        />
        <MetricCard
          title="Low Stock"
          value={status === 'loading' ? '—' : counts.low.toString()}
          subtitle="7–14 days remaining"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Healthy Stock"
          value={status === 'loading' ? '—' : counts.healthy.toString()}
          subtitle="14+ days remaining"
          accentColor="#86efac"
        />
      </div>

      {/* ── Bags — True Stock Levels ── */}
      {status === 'ok' && bags.length > 0 && (
        <Card accentColor="#a78bfa" className="mb-5">
          <div className="flex items-start gap-2 mb-1">
            <span className="text-base">👜</span>
            <div>
              <h2 className="text-sm font-bold text-gray-700">Bags — True Stock Levels</h2>
              <p className="text-xs text-gray-400">
                Real physical counts — bag-only listings, NO SWING STRAP variants, and per-color simple handbag listings. Straps &amp; inserts tracked separately below.
              </p>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-2.5 md:hidden mt-3">
            {visibleBags.map(bag => {
              const cfg = STATUS_CONFIG[bag.status];
              return (
                <div
                  key={bag.id}
                  onClick={() => toggleName(bag.id)}
                  className="border border-gray-100 rounded-xl p-3 bg-white flex items-center justify-between gap-3 cursor-pointer active:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold text-gray-800 leading-tight ${expandedNames.has(bag.id) ? 'break-words' : 'truncate'}`}>{bag.product}</p>
                    {bag.variant && <p className="text-xs text-gray-500 mt-0.5">{bag.variant}</p>}
                    {bag.unitPrice > 0 && <p className="text-xs font-semibold text-gray-600 mt-0.5">${bag.unitPrice.toLocaleString()}</p>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400 leading-none mb-0.5">In Stock</p>
                      <p className="text-lg font-bold leading-none" style={{ color: cfg.text }}>{bag.currentStock}</p>
                    </div>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: cfg.bg, color: cfg.text }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-3">Bag</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-3">Variant</th>
                  <th onClick={() => handleBagSort('unitPrice')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Price{bagArrow('unitPrice')}</th>
                  <th onClick={() => handleBagSort('currentStock')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">In Stock{bagArrow('currentStock')}</th>
                  <th onClick={() => handleBagSort('unitsSold90d')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Sold 90d{bagArrow('unitsSold90d')}</th>
                  <th onClick={() => handleBagSort('daysRemaining')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Days Left{bagArrow('daysRemaining')}</th>
                  <th onClick={() => handleBagSort('reorderQty')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Reorder Qty{bagArrow('reorderQty')}</th>
                  <th className="text-center text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleBags.map(bag => {
                  const cfg = STATUS_CONFIG[bag.status];
                  return (
                    <tr key={bag.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-3 font-medium text-gray-800 text-xs">{bag.product}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-500">{bag.variant || <span className="text-gray-300">—</span>}</td>
                      <td className="py-2.5 px-3 text-right text-xs font-semibold text-gray-700">
                        {bag.unitPrice > 0 ? `$${bag.unitPrice.toLocaleString()}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs font-bold" style={{ color: cfg.text }}>{bag.currentStock.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-xs text-gray-600">{bag.unitsSold90d.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-xs font-semibold">
                        {bag.daysRemaining === null
                          ? <span className="text-gray-300">—</span>
                          : <span style={{ color: bag.daysRemaining < 7 ? '#ef4444' : bag.daysRemaining < 14 ? '#eab308' : '#374151' }}>{bag.daysRemaining}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs font-semibold">
                        {bag.reorderQty > 0
                          ? <span className="text-violet-600">{bag.reorderQty.toLocaleString()}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 pl-3 text-center">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: cfg.bg, color: cfg.text }}>
                          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: cfg.dot }} />
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sortedBags.length > BAG_PAGE && (
            <button
              onClick={() => setBagExpanded(e => !e)}
              className="mt-3 w-full text-xs text-violet-500 hover:text-violet-700 font-semibold py-1.5 rounded-lg border border-violet-100 hover:border-violet-200 transition-colors bg-violet-50 hover:bg-violet-100"
            >
              {bagExpanded
                ? '↑ Show less'
                : `↓ Show all ${sortedBags.length} bags (${sortedBags.length - BAG_PAGE} more)`}
            </button>
          )}
        </Card>
      )}

      {/* ── Everything else lives in collapsible sections to keep the page scannable ── */}
      <Collapsible icon="🐌" title="Slow / Dead Stock"
        summary={finance ? `${finance.slowStockCount} SKUs · ${fmtMoney(finance.slowStockCostValue)} tied up` : ''}>
        <div className="px-3 pt-2">
      {/* ── Move or discount — dead cash on the shelf ── */}
      {status === 'ok' && moveOrDiscount.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
          <p className="text-xs font-bold text-red-700 mb-1">
            🐌 {finance?.slowStockCount ?? moveOrDiscount.length} slow / dead SKUs — move or discount
          </p>
          <p className="text-[11px] text-red-500/80 mb-2.5">
            No sales in 90 days or 180+ days of supply on hand. Most cash tied up first — discount or bundle to free it up.
          </p>
          <div className="flex flex-col gap-1.5">
            {(moveExpanded ? visibleMove : visibleMove.slice(0, 6)).map(item => (
              <div
                key={item.id}
                onClick={() => toggleName(item.id)}
                className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 bg-white border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer"
              >
                <span className={`text-xs font-semibold text-gray-800 w-full sm:w-auto sm:flex-1 min-w-0 break-words ${expandedNames.has(item.id) ? '' : 'sm:truncate'}`}>
                  {item.product}{item.variant ? ` · ${item.variant}` : ''}
                </span>
                <span className="text-[11px] text-gray-500">
                  {item.currentStock.toLocaleString()} units · {item.unitsSold90d === 0 ? 'no sales 90d' : `sold ${item.unitsSold90d}/90d`}
                  {(item.productUnitsSold90d ?? 0) > item.unitsSold90d
                    ? ` · rest of product sells ${item.productUnitsSold90d}`
                    : ''}
                </span>
                <span className="text-xs font-bold text-red-700 whitespace-nowrap bg-red-100 rounded-full px-2 py-0.5 ml-auto sm:ml-0">
                  {fmtMoney(item.stockValue)} tied up
                </span>
                <button
                  onClick={e => { e.stopPropagation(); skipItem(item); }}
                  title="Seasonal — bringing back next season, don't flag as slow/dead"
                  className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-700 whitespace-nowrap"
                >
                  Skip ✕
                </button>
              </div>
            ))}
          </div>
          {visibleMove.length > 6 && (
            <button
              onClick={() => setMoveExpanded(e => !e)}
              className="text-xs font-semibold text-red-600 hover:text-red-700 mt-2.5 flex items-center gap-1"
            >
              {moveExpanded
                ? '↑ Show less'
                : `↓ Show ${visibleMove.length - 6} more`}
            </button>
          )}
        </div>
      )}

        </div>
      </Collapsible>

      <Collapsible icon="🔎" title="All SKUs — Search & Filters"
        summary={`${items.length.toLocaleString()} SKUs · straps, inserts & every variant`}>
        <div className="px-3 pt-2">
      <Card accentColor="#fdba74">
        {/* Search + filters */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-700 flex-1">Inventory Levels & Reorder Forecast</h2>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-32 sm:w-44 focus:outline-none focus:border-violet-300"
            />
          </div>

          {/* Category filter */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterCategory('all')}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={filterCategory === 'all'
                ? { background: '#818cf8', color: '#fff', borderColor: '#818cf8' }
                : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}
            >
              All Categories
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={filterCategory === cat
                  ? { background: '#818cf8', color: '#fff', borderColor: '#818cf8' }
                  : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'out_of_stock', 'critical', 'low', 'healthy'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={filterStatus === s
                  ? { background: '#374151', color: '#fff', borderColor: '#374151' }
                  : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}
              >
                {s === 'all' ? 'All Status' : STATUS_CONFIG[s].label}
                {s !== 'all' && counts[s === 'out_of_stock' ? 'outOfStock' : s as keyof typeof counts] > 0 && (
                  <span className="ml-1 opacity-70">
                    ({counts[s === 'out_of_stock' ? 'outOfStock' : s as keyof typeof counts]})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {status === 'loading' ? (
          <p className="text-xs text-gray-400 py-8 text-center">Loading inventory…</p>
        ) : (
          <>
            {/* ── Mobile cards (hidden on md+) ── */}
            <div className="flex flex-col gap-3 md:hidden">
              {filtered.map(item => {
                const cfg = STATUS_CONFIG[item.status];
                return (
                  <div key={item.id} className="border border-gray-100 rounded-xl p-3 bg-white">
                    {/* Header row: name + status badge */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 leading-tight">{item.product}</p>
                        {item.variant && (
                          <p className="text-xs text-gray-500 mt-0.5">{item.variant}</p>
                        )}
                      </div>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                        style={{ background: cfg.bg, color: cfg.text }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: cfg.dot }} />
                        {cfg.label}
                      </span>
                    </div>

                    {/* Category pill + listing price */}
                    <div className="flex items-center gap-2 mb-2">
                      {item.category && (
                        <span className="inline-block text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                          {item.category}
                        </span>
                      )}
                      {item.unitPrice > 0 && (
                        <span className="inline-block text-xs font-semibold text-gray-600">${item.unitPrice.toLocaleString()}</span>
                      )}
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-gray-50 rounded-lg py-2">
                        <p className="text-xs text-gray-400 mb-0.5">In Stock</p>
                        <p className="text-sm font-bold text-gray-800">{item.currentStock}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg py-2">
                        <p className="text-xs text-gray-400 mb-0.5">Days Left</p>
                        <p
                          className="text-sm font-bold"
                          style={{
                            color: item.daysRemaining === null ? '#94a3b8'
                              : item.daysRemaining < 7 ? '#ef4444'
                              : item.daysRemaining < 14 ? '#eab308'
                              : '#16a34a'
                          }}
                        >
                          {item.daysRemaining === null ? '—' : item.daysRemaining}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg py-2">
                        <p className="text-xs text-gray-400 mb-0.5">Reorder</p>
                        <p className="text-sm font-bold" style={{ color: item.reorderQty > 0 ? '#818cf8' : '#94a3b8' }}>
                          {item.reorderQty > 0 ? item.reorderQty : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Secondary info */}
                    <div className="flex gap-3 mt-2 text-xs text-gray-400">
                      <span>Sold 90d: <strong className="text-gray-600">{item.unitsSold90d}</strong></span>
                      <span>Sell-through: <strong className="text-gray-600">{item.sellThroughRate > 0 ? `${item.sellThroughRate}%` : '—'}</strong></span>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">No items match the current filter.</p>
              )}
            </div>

            {/* ── Desktop table (hidden on mobile) ── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-3">Product</th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-3">Variant</th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-3">Category</th>
                    <th onClick={() => handleSort('unitPrice')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Price{arrow('unitPrice')}</th>
                    <th onClick={() => handleSort('currentStock')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Stock{arrow('currentStock')}</th>
                    <th onClick={() => handleSort('unitsSold90d')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Sold 90d{arrow('unitsSold90d')}</th>
                    <th onClick={() => handleSort('daysRemaining')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Days Left{arrow('daysRemaining')}</th>
                    <th onClick={() => handleSort('sellThroughRate')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Sell-Through{arrow('sellThroughRate')}</th>
                    <th onClick={() => handleSort('reorderQty')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Reorder Qty{arrow('reorderQty')}</th>
                    <th className="text-center text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const cfg = STATUS_CONFIG[item.status];
                    return (
                      <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 pr-3 font-medium text-gray-800 text-xs">{item.product}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-500">{item.variant || <span className="text-gray-300">—</span>}</td>
                        <td className="py-2.5 pr-3 text-xs">
                          <span className="bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{item.category}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs font-semibold text-gray-700">
                          {item.unitPrice > 0 ? `$${item.unitPrice.toLocaleString()}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs font-semibold text-gray-800">{item.currentStock.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-xs text-gray-600">{item.unitsSold90d.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-xs font-semibold">
                          {item.daysRemaining === null
                            ? <span className="text-gray-300">—</span>
                            : <span style={{ color: item.daysRemaining < 7 ? '#ef4444' : item.daysRemaining < 14 ? '#eab308' : '#374151' }}>
                                {item.daysRemaining}
                              </span>
                          }
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-gray-600">
                          {item.sellThroughRate > 0 ? `${item.sellThroughRate}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs font-semibold">
                          {item.reorderQty > 0
                            ? <span className="text-violet-600">{item.reorderQty.toLocaleString()}</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="py-2.5 pl-3 text-center">
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: cfg.bg, color: cfg.text }}
                          >
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: cfg.dot }} />
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-xs text-gray-400">
                        No items match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Reorder Qty = units needed to reach 90 days of supply at current 90-day average daily velocity.
        </p>
      </Card>
        </div>
      </Collapsible>

    </div>
  );
}
