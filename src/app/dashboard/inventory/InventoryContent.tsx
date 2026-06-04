'use client';

import { inventoryData } from '@/src/lib/mockData';
import { getStockStatus } from '@/src/lib/utils';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

const STATUS_CONFIG = {
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
    bar: '#ef4444',
    label: 'Critical',
  },
  warning: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-700',
    bar: '#f59e0b',
    label: 'Low',
  },
  ok: {
    bg: 'bg-white',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-700',
    bar: '#22c55e',
    label: 'OK',
  },
};

export default function InventoryContent() {
  const critical = inventoryData.filter(i => getStockStatus(i.daysRemaining) === 'critical');
  const warning = inventoryData.filter(i => getStockStatus(i.daysRemaining) === 'warning');
  const ok = inventoryData.filter(i => getStockStatus(i.daysRemaining) === 'ok');

  return (
    <div>
      <Header
        title="Inventory & Reorder"
        subtitle="Stock levels, velocity, and predicted reorder quantities"
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total SKUs Tracked"
          value={String(inventoryData.length)}
          subtitle="Across all products"
          accentColor="#fdba74"
        />
        <MetricCard
          title="Critical Stock"
          value={String(critical.length)}
          subtitle="< 7 days remaining"
          accentColor="#fca5a5"
          valueColor="#ef4444"
        />
        <MetricCard
          title="Low Stock"
          value={String(warning.length)}
          subtitle="7-14 days remaining"
          accentColor="#fde68a"
          valueColor="#d97706"
        />
        <MetricCard
          title="Healthy Stock"
          value={String(ok.length)}
          subtitle="> 14 days remaining"
          accentColor="#86efac"
          valueColor="#16a34a"
        />
      </div>

      {/* Alerts */}
      {critical.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🚨</span>
            <h3 className="text-sm font-bold text-red-700">
              {critical.length} SKU{critical.length > 1 ? 's' : ''} critically low — reorder immediately
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {critical.map(item => (
              <span key={item.id} className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-lg">
                {item.name} ({item.daysRemaining.toFixed(1)}d)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Inventory Table */}
      <Card accentColor="#fdba74">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Inventory Levels & Reorder Forecast</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-100">
                {['Product', 'SKU', 'Stock', 'Sold/Day', 'Days Left', 'Reorder Qty', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventoryData
                .sort((a, b) => a.daysRemaining - b.daysRemaining)
                .map(item => {
                  const status = getStockStatus(item.daysRemaining);
                  const config = STATUS_CONFIG[status];
                  const barWidth = Math.min((item.daysRemaining / 60) * 100, 100);

                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-50 transition-colors ${
                        status === 'critical' ? 'bg-red-50/40' : status === 'warning' ? 'bg-yellow-50/40' : ''
                      }`}
                    >
                      <td className="py-3 pr-4 font-medium text-gray-800">{item.name}</td>
                      <td className="py-3 pr-4 text-xs font-mono text-gray-400">{item.sku}</td>
                      <td className="py-3 pr-4 font-semibold text-gray-700">
                        {item.stock.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">{item.soldPerDay.toFixed(1)}/day</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${barWidth}%`, backgroundColor: config.bar }}
                            />
                          </div>
                          <span className={`font-bold text-sm ${config.text}`}>
                            {item.daysRemaining.toFixed(1)}d
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-semibold text-gray-700">
                          {item.reorderQty} units
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${config.badge}`}>
                          {config.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span>Critical: &lt; 7 days — reorder now</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-yellow-400" />
          <span>Low: 7–14 days — plan reorder</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-green-400" />
          <span>OK: &gt; 14 days</span>
        </div>
        <div className="ml-auto text-gray-400">
          Reorder qty = 30-day demand × 1.5 safety stock multiplier
        </div>
      </div>
    </div>
  );
}
