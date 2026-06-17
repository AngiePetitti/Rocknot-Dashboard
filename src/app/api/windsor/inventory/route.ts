import { NextResponse } from 'next/server';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

export interface InventoryItem {
  id: string;
  product: string;
  variant: string;
  currentStock: number;
  unitsSold90d: number;
  dailyVelocity: number;
  daysRemaining: number | null; // null = no recent sales (velocity = 0)
  sellThroughRate: number;
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy';
  reorderQty: number; // suggested 30-day restock
}

async function runShopifyQL(query: string) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData { rows columns { name } }
        parseErrors
      }}`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return { rows, cell };
}

function statusFor(stock: number, days: number | null): InventoryItem['status'] {
  if (stock <= 0) return 'out_of_stock';
  if (days === null) return 'healthy'; // no recent sales — not burning down
  if (days < 7) return 'critical';
  if (days < 14) return 'low';
  return 'healthy';
}

export async function GET() {
  if (!TOKEN) {
    return NextResponse.json({ source: 'error', error: 'Shopify token not configured', items: [] });
  }

  try {
    // 90-day window for velocity — longer lookback smooths seasonal spikes.
    // We exclude variants with absurdly high stock counts (e.g. non-physical
    // "Return" products) via the HAVING clause.
    const SUPPLY_TARGET_DAYS = 90;
    const SINCE = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d.toISOString().split('T')[0];
    })();
    const UNTIL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const PERIOD_DAYS = 90;

    const { rows, cell } = await runShopifyQL(
      `FROM inventory
       SHOW ending_inventory_units, inventory_units_sold, sell_through_rate
       GROUP BY product_title, product_variant_title
       SINCE ${SINCE} UNTIL ${UNTIL}
       HAVING ending_inventory_units < 50000
       ORDER BY inventory_units_sold DESC
       LIMIT 250`
    );

    const items: InventoryItem[] = rows
      .map((r, i) => {
        const product = cell(r, 'product_title') || 'Unknown';
        const variant = cell(r, 'product_variant_title') || '';
        const currentStock = Math.round(parseFloat(cell(r, 'ending_inventory_units') || '0'));
        const unitsSold = Math.round(parseFloat(cell(r, 'inventory_units_sold') || '0'));
        const sellThroughRate = Math.round(parseFloat(cell(r, 'sell_through_rate') || '0') * 1000) / 10;

        const dailyVelocity = Math.round((unitsSold / PERIOD_DAYS) * 100) / 100;
        const daysRemaining = dailyVelocity > 0
          ? Math.round(currentStock / dailyVelocity)
          : null;
        const status = statusFor(currentStock, daysRemaining);

        // Suggest enough stock to cover 90 days at current velocity, minus what's on hand.
        const reorderQty = dailyVelocity > 0
          ? Math.max(0, Math.round(dailyVelocity * SUPPLY_TARGET_DAYS) - Math.max(currentStock, 0))
          : 0;

        return {
          id: String(i),
          product,
          variant: variant === 'Default Title' ? '' : variant,
          currentStock,
          unitsSold90d: unitsSold,
          dailyVelocity,
          daysRemaining,
          sellThroughRate,
          status,
          reorderQty,
        };
      })
      // Only show SKUs that have stock or recent sales
      .filter(item => item.currentStock > 0 || item.unitsSold90d > 0);

    const outOfStock = items.filter(i => i.status === 'out_of_stock').length;
    const critical = items.filter(i => i.status === 'critical').length;
    const low = items.filter(i => i.status === 'low').length;
    const healthy = items.filter(i => i.status === 'healthy').length;

    return NextResponse.json(
      { source: 'shopify_live', items, outOfStock, critical, low, healthy },
      { headers: cacheHeaders(false) }
    );
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), items: [] });
  }
}
