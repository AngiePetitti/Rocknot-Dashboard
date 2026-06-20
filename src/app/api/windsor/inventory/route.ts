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

// Strip the "bag only" / "bag only inventory" marker (in any of its messy
// forms — "(BAG ONLY)", "BAG ONLY - INVENTORY", etc.) so the section reads as
// the real bag name, cleaning up stray parens and separators left behind.
function cleanBagName(title: string): string {
  let s = title;
  s = s.replace(/bag\s*only/ig, ' ');     // the marker itself
  s = s.replace(/\binventory\b/ig, ' ');  // trailing "- INVENTORY"
  s = s.replace(/\(\s*\)/g, ' ');         // empty parens left behind
  s = s.replace(/[()]/g, ' ');            // stray single parens
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/^\s*[-–—·|:]\s*/, '');   // leading separator
  s = s.replace(/\s*[-–—·|:]\s*$/, '');   // trailing separator
  return s.trim() || title.trim();
}

// Build the set of bag "line keys" from the bag-only listings — the brand/line
// stem (digits stripped, so "transformer2" → "transformer") — so we can spot
// the PUBLIC mix-and-match versions of the same bag and exclude their phantom,
// strap-multiplied inventory from the dollar totals. Bags are counted ONLY
// from the bag-only listings (the true physical counts).
const BAG_STOPWORDS = new Set(['the', 'a', 'an', 'new', 'phone', 'bag', 'mini']);
function bagLineKey(title: string): string {
  const cleaned = cleanBagName(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  const stem = tokens.find(t => !BAG_STOPWORDS.has(t)) || tokens[0] || '';
  return stem.replace(/\d+$/, ''); // drop trailing digits: transformer2 -> transformer
}

// Some bag lines (e.g. ORI Hobo, Hezi) have NO separate "bag only" listing.
// Instead the true bag count for each color lives in the "NO SWING STRAP"
// variant of the public listing — the bare bag with no strap attached. The
// other (strap) variants just repeat that bag's count, so they're phantom.
function isNoStrapVariant(variant: string): boolean {
  return /\bno\s+(swing\s+)?strap\b/i.test(variant);
}

// A non-bag-only row is a PUBLIC bag listing (phantom inventory) if it's a
// handbag, has "bag" in the name, or matches a known bag line — but never if
// it's a strap (straps have their own real, tracked inventory).
function isPublicBag(title: string, category: string, keys: Set<string>): boolean {
  if (/strap/i.test(title)) return false;
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/handbag/i.test(category)) return true;
  if (/\bbag\b/i.test(title)) return true;
  // Only trust longer, unambiguous line stems here (e.g. "transformer"); short
  // stems like a color name would cause false matches, and those bags already
  // carry "bag" in their public title so they're caught above.
  return Array.from(keys).some(k => k.length >= 7 && norm.includes(k));
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
       SHOW ending_inventory_units, starting_inventory_units, inventory_units_sold, sell_through_rate, ending_inventory_value, ending_inventory_retail_value
       GROUP BY product_title, product_variant_title, product_type
       SINCE ${SINCE} UNTIL ${UNTIL}
       HAVING ending_inventory_units < 50000
       ORDER BY inventory_units_sold DESC
       LIMIT 2000`
    );

    // First pass: collect bag line keys from the bag-only listings so we can
    // identify and drop the public mix-and-match versions below.
    const bagKeys = new Set<string>();
    for (const r of rows) {
      const t = cell(r, 'product_title') || '';
      if (isBagOnly(t)) {
        const k = bagLineKey(t);
        if (k) bagKeys.add(k);
      }
    }

    type RawItem = InventoryItem & {
      _isBag: boolean; _isGiftCard: boolean; _isHandbag: boolean;
      _isPublicBag: boolean; _isTrueBag: boolean; _startingStock: number;
    };
    const allRows: RawItem[] = rows.map((r, i) => {
      const rawProduct = cell(r, 'product_title') || 'Unknown';
      const variant = cell(r, 'product_variant_title') || '';
      const category = cell(r, 'product_type') || 'Other';
      // Clamp oversold (negative) inventory to 0 — a SKU can't physically have
      // negative units on hand; negative just means it oversold past its count.
      const rawStock = Math.round(parseFloat(cell(r, 'ending_inventory_units') || '0'));
      const currentStock = Math.max(0, rawStock);
      const startingStock = Math.max(0, Math.round(parseFloat(cell(r, 'starting_inventory_units') || '0')));
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
      const _isPublicBag = !_isBag && isPublicBag(rawProduct, category, bagKeys);
      // A bag line is "covered" when it has its own bag-only listing (so its
      // true count comes from there). If it's NOT covered, the bare-bag count
      // lives in the "NO SWING STRAP" variant of the public listing instead.
      const _bagCovered = bagKeys.has(bagLineKey(rawProduct));
      const _isNoStrap = isNoStrapVariant(variant);
      const _isTrueBag = _isBag || (_isPublicBag && !_bagCovered && _isNoStrap);
      // For a NO SWING STRAP true-bag row, the color is already in the product
      // title (e.g. "ORI Hobo Bag - Black"), so blank the variant label.
      const displayVariant = (variant === 'Default Title' || _isNoStrap) ? '' : variant;
      return {
        id: String(i),
        product: _isBag ? cleanBagName(rawProduct) : rawProduct,
        variant: displayVariant,
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
        _isPublicBag,
        _isTrueBag,
        _startingStock: startingStock,
      };
    });

    const strip = ({ _isBag, _isGiftCard, _isHandbag, _isPublicBag, _isTrueBag, _startingStock, ...rest }: RawItem): InventoryItem => rest;

    // Bags = true physical stock: the "bag only" listings PLUS the "NO SWING
    // STRAP" variants of bag lines that have no bag-only listing. Always shown,
    // even at zero, sorted lowest stock first so attention items surface on top.
    const bags: InventoryItem[] = allRows
      .filter(r => r._isTrueBag && !r._isGiftCard)
      .map(strip)
      .sort((a, b) => a.currentStock - b.currentStock);

    // Main list: straps, inserts, jewelry, accessories, etc. Keep a SKU if it
    // has stock OR sold units in the window. Excluded:
    //  - bag-only listings (shown in the Bags section above)
    //  - gift cards (not physical inventory)
    //  - public bag listings (mix-and-match parents — each bag is repeated once
    //    per strap/length combo, so their inventory is phantom-inflated; the
    //    true stock is the "bag only" listings)
    const items: InventoryItem[] = allRows
      .filter(r => !r._isBag && !r._isGiftCard && !r._isHandbag && !r._isPublicBag && (r.currentStock > 0 || r.unitsSold90d > 0))
      .map(strip);

    // Counts span the main list plus bags so the tiles reflect everything.
    const tileScope = [...items, ...bags];
    const outOfStock = tileScope.filter(i => i.status === 'out_of_stock').length;
    const critical = tileScope.filter(i => i.status === 'critical').length;
    const low = tileScope.filter(i => i.status === 'low').length;
    const healthy = tileScope.filter(i => i.status === 'healthy').length;

    const categories = Array.from(new Set(items.map(i => i.category))).filter(Boolean).sort();

    // ── Inventory $ insights ──────────────────────────────────────────────
    // Value over everything physically on hand that has a real cost figure
    // entered in Shopify (stockValue 0 = no cost set, left out so totals only
    // reflect known costs). Excluded:
    //  - gift cards (not physical inventory)
    //  - PHANTOM public bag variants (each bag counted once per strap combo).
    // True bags ARE counted: the "bag only" listings and the "NO SWING STRAP"
    // bare-bag variants both carry the real per-bag counts and cost.
    const valued = allRows.filter(r =>
      !r._isGiftCard && !(r._isPublicBag && !r._isTrueBag) && r.currentStock > 0 && r.stockValue > 0);
    const totalCostValue = valued.reduce((s, r) => s + r.stockValue, 0);
    const totalRetailValue = valued.reduce((s, r) => s + r.retailValue, 0);
    const potentialProfit = Math.max(0, totalRetailValue - totalCostValue);

    // Slow / dead stock = capital genuinely stuck on the shelf.
    //
    // CRITICAL: only count items that actually HAD stock available to sell.
    // A SKU with zero sales that was out of stock all period isn't "dead" —
    // it just had nothing to sell. We require stock at the START of the window
    // (it was on the shelf and available) as well as on hand now, so what's
    // left is genuinely "in stock the whole time and still not moving."
    //
    // Two tiers:
    //  "Dead"  — was in stock at the start, still in stock now, and sold
    //            nothing in 90 days (no velocity at all).
    //  "Slow"  — selling but at such a glacial pace there's more than 365
    //            days of supply on hand (over a full year to sell through).
    const isStale = (r: RawItem) =>
      r.currentStock > 0 && r.stockValue > 0 && (
        (r._startingStock > 0 && r.unitsSold90d === 0 && r.daysRemaining === null) || // dead despite being in stock
        (r.daysRemaining !== null && r.daysRemaining > 365)                            // >1 yr supply, clearly slow
      );
    const staleRows = valued.filter(isStale);
    const slowStockCostValue = staleRows.reduce((s, r) => s + r.stockValue, 0);
    const slowStockUnits = staleRows.reduce((s, r) => s + r.currentStock, 0);

    // Poor sellers to move/discount — most cash tied up in non-moving stock,
    // worst offenders first. Exclude bags (managed in their own section).
    const moveOrDiscount = staleRows
      .filter(r => !r._isTrueBag)
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
