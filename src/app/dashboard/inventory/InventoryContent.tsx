'use client';

import { useEffect, useState, useMemo } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface InventoryItem {
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
}

const STATUS_CONFIG = {
  out_of_stock: { label: 'Out of Stock', bg: '#fee2e2', text: '#dc2626', dot: '#ef4444' },
  critical:     { label: 'Critical',     bg: '#ffedd5', text: '#ea580c', dot: '#f97316' },
  low:          { label: 'Low Stock',    bg: '#fef9c3', text: '#ca8a04', dot: '#eab308' },
  healthy:      { label: 'Healthy',      bg: '#dcfce7', text: '#16a34a', dot: '#22c55e' },
};

type FilterStatus = 'all' | 'out_of_stock' | 'critical' | 'low' | 'healthy';
type SortKey = 'daysRemaining' | 'currentStock' | 'unitsSold90d' | 'sellThroughRate' | 'reorderQty';
type BagSortKey = 'currentStock' | 'unitsSold90d' | 'daysRemaining' | 'reorderQty';

export default function InventoryContent() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [bags, setBags] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [counts, setCounts] = useState({ outOfStock: 0, critical: 0, low: 0, healthy: 0 });
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('daysRemaining');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [bagSortKey, setBagSortKey] = useState<BagSortKey>('currentStock');
  const [bagSortDir, setBagSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    setStatus('loading');
    fetch('/api/windsor/inventory')
      .then(r => r.json())
      .then(data => {
        if (data.source === 'shopify_live') {
          setItems(data.items || []);
          setBags(data.bags || []);
          setCategories(data.categories || []);
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
      })
      .catch(() => setStatus('error'));
  }, []);

  const handleBagSort = (key: BagSortKey) => {
    if (bagSortKey === key) setBagSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setBagSortKey(key); setBagSortDir('asc'); }
  };
  const bagArrow = (key: BagSortKey) => bagSortKey === key ? (bagSortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const sortedBags = useMemo(() => [...bags].sort((a, b) => {
    if (bagSortKey === 'daysRemaining') {
      if (a.daysRemaining === null && b.daysRemaining === null) return 0;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
    }
    const av = a[bagSortKey] ?? 0;
    const bv = b[bagSortKey] ?? 0;
    return bagSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  }), [bags, bagSortKey, bagSortDir]);

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

  const urgentItems = items.filter(i => i.status === 'out_of_stock' || i.status === 'critical');

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

      {/* Supply target callout */}
      <div className="flex items-start gap-3 bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5 mb-5 text-xs text-violet-700">
        <span className="text-base mt-0.5">📦</span>
        <span>
          <strong>90-day supply target</strong> — velocity based on last 90 days of sales.
          Reorder Qty = units needed to bring stock back to 90 days of supply at current pace.
          True bag stock is shown in its own section from the hidden &quot;bag only&quot; listings; the public mix-and-match handbag listings (untracked) are excluded.
        </span>
      </div>

      {/* Metric cards */}
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

      {/* Urgent reorder alert */}
      {status === 'ok' && urgentItems.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-5">
          <p className="text-xs font-bold text-orange-700 mb-2">
            🚨 {urgentItems.length} SKU{urgentItems.length !== 1 ? 's' : ''} need immediate reorder
          </p>
          <div className="flex flex-wrap gap-2">
            {urgentItems.slice(0, 8).map(item => (
              <span key={item.id} className="text-xs bg-white border border-orange-200 rounded-full px-2.5 py-0.5 text-orange-700 font-medium">
                {item.product}{item.variant ? ` · ${item.variant}` : ''}
                {item.status === 'out_of_stock' ? ' (OUT)' : ` · ${item.daysRemaining}d left`}
              </span>
            ))}
            {urgentItems.length > 8 && (
              <span className="text-xs text-orange-500 py-0.5">+{urgentItems.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* ── Bags — True Stock Levels ── */}
      {status === 'ok' && bags.length > 0 && (
        <Card accentColor="#a78bfa" className="mb-5">
          <div className="flex items-start gap-2 mb-1">
            <span className="text-base">👜</span>
            <div>
              <h2 className="text-sm font-bold text-gray-700">Bags — True Stock Levels</h2>
              <p className="text-xs text-gray-400">
                Real physical bag counts from the hidden &quot;bag only&quot; listings. Straps &amp; inserts are tracked separately in the main list below.
              </p>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-2.5 md:hidden mt-3">
            {sortedBags.map(bag => {
              const cfg = STATUS_CONFIG[bag.status];
              return (
                <div key={bag.id} className="border border-gray-100 rounded-xl p-3 bg-white flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{bag.product}</p>
                    {bag.variant && <p className="text-xs text-gray-500 mt-0.5">{bag.variant}</p>}
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
                  <th onClick={() => handleBagSort('currentStock')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">In Stock{bagArrow('currentStock')}</th>
                  <th onClick={() => handleBagSort('unitsSold90d')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Sold 90d{bagArrow('unitsSold90d')}</th>
                  <th onClick={() => handleBagSort('daysRemaining')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Days Left{bagArrow('daysRemaining')}</th>
                  <th onClick={() => handleBagSort('reorderQty')} className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600">Reorder Qty{bagArrow('reorderQty')}</th>
                  <th className="text-center text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedBags.map(bag => {
                  const cfg = STATUS_CONFIG[bag.status];
                  return (
                    <tr key={bag.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-3 font-medium text-gray-800 text-xs">{bag.product}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-500">{bag.variant || <span className="text-gray-300">—</span>}</td>
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
        </Card>
      )}

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

                    {/* Category pill */}
                    {item.category && (
                      <span className="inline-block text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 mb-2">
                        {item.category}
                      </span>
                    )}

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
  );
}
