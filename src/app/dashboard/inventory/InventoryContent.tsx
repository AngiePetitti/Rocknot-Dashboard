'use client';

import { useEffect, useState, useMemo } from 'react';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

interface InventoryItem {
  id: string;
  product: string;
  variant: string;
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

export default function InventoryContent() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [counts, setCounts] = useState({ outOfStock: 0, critical: 0, low: 0, healthy: 0 });
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortKey, setSortKey] = useState<SortKey>('daysRemaining');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setStatus('loading');
    fetch('/api/windsor/inventory')
      .then(r => r.json())
      .then(data => {
        if (data.source === 'shopify_live') {
          setItems(data.items || []);
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const filtered = useMemo(() => {
    let result = filterStatus === 'all' ? items : items.filter(i => i.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.product.toLowerCase().includes(q) || i.variant.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      // null daysRemaining (no velocity) sorts to the bottom for daysRemaining
      if (sortKey === 'daysRemaining') {
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
      }
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [items, filterStatus, search, sortKey, sortDir]);

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
      <div className="flex items-center gap-3 bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5 mb-5 text-xs text-violet-700">
        <span className="text-base">📦</span>
        <span>
          <strong>90-day supply target</strong> — velocity based on last 90 days of sales.
          Reorder Qty = units needed to bring stock back to 90 days of supply at current pace.
        </span>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Out of Stock"
          value={status === 'loading' ? '—' : counts.outOfStock.toString()}
          subtitle="0 units remaining"
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

      {/* Table */}
      <Card accentColor="#fdba74">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <h2 className="text-sm font-bold text-gray-700 flex-1">Inventory Levels & Reorder Forecast</h2>
          <input
            type="text"
            placeholder="Search product or variant…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-full sm:w-48 focus:outline-none focus:border-violet-300"
          />
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'out_of_stock', 'critical', 'low', 'healthy'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={filterStatus === s
                  ? { background: '#818cf8', color: '#fff', borderColor: '#818cf8' }
                  : { background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }
                }
              >
                {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        {status === 'loading' ? (
          <p className="text-xs text-gray-400 py-8 text-center">Loading inventory…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Product</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">Variant</th>
                  <th
                    onClick={() => handleSort('currentStock')}
                    className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600"
                  >Stock{arrow('currentStock')}</th>
                  <th
                    onClick={() => handleSort('unitsSold90d')}
                    className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600"
                  >Sold 90d{arrow('unitsSold90d')}</th>
                  <th
                    onClick={() => handleSort('daysRemaining')}
                    className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600"
                  >Days Left{arrow('daysRemaining')}</th>
                  <th
                    onClick={() => handleSort('sellThroughRate')}
                    className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600"
                  >Sell-Through{arrow('sellThroughRate')}</th>
                  <th
                    onClick={() => handleSort('reorderQty')}
                    className="text-right text-xs font-semibold text-gray-400 uppercase pb-2 px-3 cursor-pointer select-none hover:text-gray-600"
                  >Reorder Qty{arrow('reorderQty')}</th>
                  <th className="text-center text-xs font-semibold text-gray-400 uppercase pb-2 pl-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const cfg = STATUS_CONFIG[item.status];
                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-gray-800 text-xs max-w-[160px] truncate">{item.product}</td>
                      <td className="py-2.5 pr-4 text-xs text-gray-500">{item.variant || <span className="text-gray-300">—</span>}</td>
                      <td className="py-2.5 px-3 text-right text-xs font-semibold text-gray-800">
                        {item.currentStock <= 0
                          ? <span className="text-red-500 font-bold">0</span>
                          : item.currentStock.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs text-gray-600">{item.unitsSold90d.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-xs font-semibold">
                        {item.daysRemaining === null
                          ? <span className="text-gray-300">—</span>
                          : item.currentStock <= 0
                          ? <span className="text-red-500">0</span>
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
                {filtered.length === 0 && status === 'ok' && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-gray-400">
                      No items match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Reorder Qty = units needed to reach 90 days of supply at current 90-day average daily velocity.
        </p>
      </Card>
    </div>
  );
}
