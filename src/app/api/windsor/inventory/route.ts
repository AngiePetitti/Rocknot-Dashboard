import { NextResponse } from 'next/server';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

export interface InventoryItem {
  id: string;
  product: string;
  variant: string;
  category: string;
  currentStock: number;
  unitsSold90d: number;
  dailyVelocity: number;
  daysRemaining: number | null; // null = no recent sales (velocity = 0)
  sellThroughRate: number;
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy';
  reorderQty: number; // suggested 30-day restock
  stockValue: number;  // cash tied up at cost (ending inventory value)
  retailValue: number; // potential revenue on shelves (retail value)
}

// Hidden "bag only" listings hold the TRUE physical bag stock (the public
// handbag listings are untracked because each bag can be mixed-and-matched
// with many strap/insert variants). They all carry "bag only" in the title,
// sometimes "bag only inventory".
function isBagOnly(title: string): boolean {
  return /bag\s*only/i.test(title);
}

// Strip the "bag only" / "bag only inventory" marker so the section reads as
// the real bag name, then clean up any trailing separators left behind.
function cleanBagName(title: string): string {
  return title
    .replace(/\s*[-–—·|:]?\s*bag\s*only(\s+inventory)?\b/i, '')
    .replace(/[-–—·|:]\s*$/, '')
    .replace(/\s*\(\s*\)\s*$/, '')
    .trim() || title.trim();
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

    // No "> 0" guard here: we want SKUs that sold out to zero to come through
    // so genuine sellouts can be flagged. The < 50000 cap still drops junk rows
    // (e.g. non-physical "Return" products). High LIMIT so the hidden "bag only"
    // listings — which have zero direct sales and therefore sort to the very
    // bottom of the units-sold ordering — are never truncated off.
    const { rows, cell } = await runShopifyQL(
      `FROM inventory
       SHOW ending_inventory_units, inventory_units_sold, sell_through_rate, ending_inventory_value, ending_inventory_retail_value
       GROUP BY product_title, product_variant_title, product_type
       SINCE ${SINCE} UNTIL ${UNTIL}
       HAVING ending_inventory_units < 50000
       ORDER BY inventory_units_sold DESC
       LIMIT 2000`
    );

    type RawItem = InventoryItem & { _isBag: boolean; _isGiftCard: boolean; _isHandbag: boolean };
    const allRows: RawItem[] = rows.map((r, i) => {
      const rawProduct = cell(r, 'product_title') || 'Unknown';
      const variant = cell(r, 'product_variant_title') || '';
      const category = cell(r, 'product_type') || 'Other';
      // Clamp oversold (negative) inventory to 0 — a SKU can't physically have
      // negative units on hand; negative just means it oversold past its count.
      const rawStock = Math.round(parseFloat(cell(r, 'ending_inventory_units') || '0'));
      const currentStock = Math.max(0, rawStock);
      const unitsSold = Math.round(parseFloat(cell(r, 'inventory_units_sold') || '0'));
      const sellThroughRate = Math.round(parseFloat(cell(r, 'sell_through_rate') || '0') * 1000) / 10;
      const stockValue = Math.max(0, Math.round(parseFloat(cell(r, 'ending_inventory_value') || '0')));
      const retailValue = Math.max(0, Math.round(parseFloat(cell(r, 'ending_inventory_retail_value') || '0')));

      const dailyVelocity = Math.round((unitsSold / PERIOD_DAYS) * 100) / 100;
      // Days remaining only makes sense with stock on hand; zero/oversold = 0 days.
      const daysRemaining = currentStock <= 0
        ? (dailyVelocity > 0 ? 0 : null)
        : dailyVelocity > 0
          ? Math.round(currentStock / dailyVelocity)
          : null;
      const status = statusFor(currentStock, daysRemaining);

      // Suggest enough stock to cover 90 days at current velocity, minus what's on hand.
      const reorderQty = dailyVelocity > 0
        ? Math.max(0, Math.round(dailyVelocity * SUPPLY_TARGET_DAYS) - currentStock)
        : 0;

      const _isBag = isBagOnly(rawProduct);
      return {
        id: String(i),
        product: _isBag ? cleanBagName(rawProduct) : rawProduct,
        variant: variant === 'Default Title' ? '' : variant,
        category,
        currentStock,
        unitsSold90d: unitsSold,
        dailyVelocity,
        daysRemaining,
        sellThroughRate,
        status,
        reorderQty,
        stockValue,
        retailValue,
        _isBag,
        _isGiftCard: /gift\s*card/i.test(rawProduct),
        _isHandbag: /handbag/i.test(category),
      };
    });

    const strip = ({ _isBag, _isGiftCard, _isHandbag, ...rest }: RawItem): InventoryItem => rest;

    // Bags ("bag only" listings) are the true physical stock — always show them,
    // even at zero and even with no recent sales, sorted lowest stock first so
    // the ones that need attention surface at the top.
    const bags: InventoryItem[] = allRows
      .filter(r => r._isBag && !r._isGiftCard)
      .map(strip)
      .sort((a, b) => a.currentStock - b.currentStock);

    // Main list: straps, inserts, jewelry, accessories, etc. Keep a SKU if it
    // has stock OR sold units in the window. Excluded:
    //  - bag-only listings (shown in the Bags section above)
    //  - gift cards (not physical inventory)
    //  - public handbag listings (untracked mix-and-match parents — their true
    //    stock is the "bag only" listings, so the public ones are misleading)
    const items: InventoryItem[] = allRows
      .filter(r => !r._isBag && !r._isGiftCard && !r._isHandbag && (r.currentStock > 0 || r.unitsSold90d > 0))
      .map(strip);

    // Counts span the main list plus bags so the tiles reflect everything.
    const tileScope = [...items, ...bags];
    const outOfStock = tileScope.filter(i => i.status === 'out_of_stock').length;
    const critical = tileScope.filter(i => i.status === 'critical').length;
    const low = tileScope.filter(i => i.status === 'low').length;
    const healthy = tileScope.filter(i => i.status === 'healthy').length;

    const categories = Array.from(new Set(items.map(i => i.category))).filter(Boolean).sort();

    // ── Inventory $ insights ──────────────────────────────────────────────
    // Value over everything physically on hand (main items + bags), excluding
    // gift cards. Bag value lives on the "bag only" listings; public handbag
    // listings are untracked (0 value) so there's no double counting.
    const valued = allRows.filter(r => !r._isGiftCard && r.currentStock > 0);
    const totalCostValue = valued.reduce((s, r) => s + r.stockValue, 0);
    const totalRetailValue = valued.reduce((s, r) => s + r.retailValue, 0);
    const potentialProfit = Math.max(0, totalRetailValue - totalCostValue);

    // Slow / dead stock = cash that's depreciating on the shelf. "Dead" sold
    // nothing in 90 days; "slow" is sitting on 180+ days of supply at its
    // current pace. Either way it's money not turning over.
    const isStale = (r: RawItem) =>
      r.currentStock > 0 && (r.unitsSold90d === 0 || (r.daysRemaining !== null && r.daysRemaining > 180));
    const staleRows = valued.filter(isStale);
    const slowStockCostValue = staleRows.reduce((s, r) => s + r.stockValue, 0);
    const slowStockUnits = staleRows.reduce((s, r) => s + r.currentStock, 0);

    // Poor sellers to move/discount — most cash tied up in non-moving stock,
    // worst offenders first. Exclude bags (managed in their own section).
    const moveOrDiscount = staleRows
      .filter(r => !r._isBag)
      .map(strip)
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 25);

    const finance = {
      totalCostValue,
      totalRetailValue,
      potentialProfit,
      slowStockCostValue,
      slowStockUnits,
      slowStockCount: staleRows.length,
    };

    return NextResponse.json(
      { source: 'shopify_live', items, bags, outOfStock, critical, low, healthy, categories, finance, moveOrDiscount },
      { headers: cacheHeaders(false) }
    );
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), items: [] });
  }
}
