'use client';

import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import MetricCard from '@/src/components/ui/MetricCard';

export default function InventoryContent() {
  return (
    <div>
      <Header
        title="Inventory & Reorder"
        subtitle="Stock levels, velocity, and predicted reorder quantities"
      />

      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-700">
        <span>⚠️</span>
        <span>
          Inventory data is unavailable — the Shopify connection isn&apos;t authorized for
          product/inventory access (<code>read_products</code> / <code>read_inventory</code> scopes)
          yet, and no inventory sync has been set up.
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total SKUs Tracked"
          value="—"
          subtitle="Across all products"
          accentColor="#fdba74"
        />
        <MetricCard
          title="Critical Stock"
          value="—"
          subtitle="< 7 days remaining"
          accentColor="#fca5a5"
        />
        <MetricCard
          title="Low Stock"
          value="—"
          subtitle="7-14 days remaining"
          accentColor="#fde68a"
        />
        <MetricCard
          title="Healthy Stock"
          value="—"
          subtitle="> 14 days remaining"
          accentColor="#86efac"
        />
      </div>

      <Card accentColor="#fdba74">
        <h2 className="text-sm font-bold text-gray-700 mb-1">Inventory Levels & Reorder Forecast</h2>
        <p className="text-xs text-gray-400">
          Connect a Shopify Admin API scope with <code>read_products</code> and{' '}
          <code>read_inventory</code> (or a Windsor inventory sync into BigQuery) to populate
          stock levels, sell-through velocity, and reorder recommendations here.
        </p>
      </Card>
    </div>
  );
}
