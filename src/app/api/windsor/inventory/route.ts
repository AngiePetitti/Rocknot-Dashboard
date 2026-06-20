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

// A row is a PUBLIC bag listing if it's a handbag, has "bag" in the name, or
// matches a known bag line. "bag" wins over "strap": e.g. "BELT BAG + CHAIN
// STRAP" is a bag, while "GEM Strap" is a real strap with its own inventory.
function isPublicBag(title: string, category: string, keys: Set<string>): boolean {
  if (/charm|keychain|key\s*ring/i.test(title)) return false; // accessory, not a bag
  if (/\bbag\b/i.test(title)) return true;       // a bag, even "... + X strap"
  if (/strap/i.test(title)) return false;        // a real strap product
  if (/handbag/i.test(category)) return true;
  // Trust only longer, unambiguous line stems (e.g. "transformer"); short stems
  // (a color name) would false-match, and those bags carry "bag" anyway.
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Array.from(keys).some(k => k.length >= 7 && norm.includes(k));
}

// Collapse a bag title to a per-color group key by stripping the "+ <X> STRAP"
// clause — Rocknot splits one physical bag across multiple listings by strap
// type (e.g. "... BELT BAG + CHAIN STRAP - Black" vs "+ LACE STRAP - Black"),
// so they must group together and be counted once, not once per strap type.
// Strip every "+ <accessory>" clause that appears BEFORE the color dash —
// covers straps (CHAIN/LACE STRAP, NO SWING STRAP), crowns (MAGNUM/PETITE
// CROWN), TWIN, CHAIN, etc. A bag's color comes after the first " - ", and may
// itself contain a "+" (e.g. "Olive + Antique Gold"), so we only strip add-on
// clauses up to that first dash and leave the color intact.
function stripBagAccessories(title: string): string {
  const dash = title.search(/[-–—]/);
  const head = dash >= 0 ? title.slice(0, dash) : title;
  const tail = dash >= 0 ? title.slice(dash) : '';
  return head.replace(/\s*\+\s*[^-–—]*/g, ' ') + tail;
}

function bagGroupKey(title: string): string {
  return stripBagAccessories(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Display name for a grouped bag: strip "+ <accessory>" clauses and tidy up.
function cleanBagDisplayName(title: string): string {
  return stripBagAccessories(title)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*([-–—])\s*/g, ' $1 ')
    .replace(/\s*[-–—·|:]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
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
      _isPublicBag: boolean; _bagCovered: boolean; _bagBare: boolean;
      _isSale: boolean; _rawProduct: string;
      _startingStock: number;
    };
    const allRowsMapped: RawItem[] = rows.map((r, i) => {
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
      // A bag line is "covered" when it has its own bag-only listing, so its
      // true count comes from there and every public variant is phantom.
      const _bagCovered = bagKeys.has(bagLineKey(rawProduct));
      const displayVariant = variant === 'Default Title' ? '' : variant;
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
        _bagCovered,
        // A "bare" bag listing has no "+ accessory" clause before the color dash
        // (the strapless / standalone bag) — its count is the true on-hand.
        _bagBare: !/\+/.test((rawProduct.split(/[-–—]/)[0] || '')),
        // Sample-sale and final-sale listings aren't regular sellable stock.
        _isSale: /\b(sample|final)\s*sale\b/i.test(rawProduct) || /\b(sample|final)\s*sale\b/i.test(category),
        _rawProduct: rawProduct,
        _startingStock: startingStock,
      };
    });
    // Drop sample-sale / final-sale listings entirely — not regular inventory.
    const allRows = allRowsMapped.filter(r => !r._isSale);

    const strip = ({ _isBag, _isGiftCard, _isHandbag, _isPublicBag, _bagCovered, _bagBare, _isSale, _rawProduct, _startingStock, ...rest }: RawItem): InventoryItem => rest;

    // ── True bag stock ────────────────────────────────────────────────────
    // Bags come in several listing shapes; we reduce each to its TRUE count:
    //  1. "bag only" listings        → every variant is a real count (keep all)
    //  2. simple handbags            → one "Default Title" variant per color
    //  3. bare-bag variant present   → "NO SWING STRAP" is the true count
    //  4. strap mix-match only       → all variants repeat the same bag count
    // Cases 2-4 are all handled by ONE rule: per color-group, the true on-hand
    // is the MAX units across that group's variants (the bare bag is never less
    // than any strap subset, and identical repeats collapse to themselves).
    // Public listings for a line that HAS a bag-only listing are skipped — the
    // bag-only listing is the source of truth (avoids double counting).
    const bagOnlyRows = allRows.filter(r => r._isBag && !r._isGiftCard);

    const publicBagGroups = new Map<string, RawItem[]>();
    for (const r of allRows) {
      if (!r._isPublicBag || r._isGiftCard || r._bagCovered) continue;
      const key = bagGroupKey(r._rawProduct);
      const g = publicBagGroups.get(key);
      if (g) g.push(r); else publicBagGroups.set(key, [r]);
    }
    const representativeBags: RawItem[] = [];
    publicBagGroups.forEach(grp => {
      // The true count comes from the bare (strapless) listing — the standalone
      // bag whose title has no "+ accessory" clause (its highest-stock variant,
      // e.g. ORI Hobo's "NO SWING STRAP", is the real on-hand). Bags that exist
      // ONLY as "+ strap/crown/chain" mix-and-match combos have no trustworthy
      // count (per-combo numbers are inconsistent) and aren't true bags, so they
      // are excluded from the section entirely.
      const bareRows = grp.filter(r => r._bagBare);
      if (!bareRows.length) return;
      const rep = bareRows.reduce((a, b) =>
        (b.currentStock > a.currentStock ||
          (b.currentStock === a.currentStock && b.stockValue > a.stockValue)) ? b : a);
      // Sum sales across all variants in the group — individual variants each
      // only capture a slice of total bag sales (one strap option at a time).
      const totalSold = grp.reduce((s, r) => s + r.unitsSold90d, 0);
      const totalDailyVelocity = Math.round((totalSold / PERIOD_DAYS) * 100) / 100;
      const daysRem = rep.currentStock <= 0
        ? (totalDailyVelocity > 0 ? 0 : null)
        : totalDailyVelocity > 0
          ? Math.round(rep.currentStock / totalDailyVelocity)
          : null;
      const reorderQty = totalDailyVelocity > 0
        ? Math.max(0, Math.round(totalDailyVelocity * SUPPLY_TARGET_DAYS) - rep.currentStock)
        : 0;
      representativeBags.push({
        ...rep,
        product: cleanBagDisplayName(rep._rawProduct),
        variant: '',
        unitsSold90d: totalSold,
        dailyVelocity: totalDailyVelocity,
        daysRemaining: daysRem,
        status: statusFor(rep.currentStock, daysRem),
        reorderQty,
      });
    });

    // Bags section — true stock, always shown (even at zero), lowest first.
    const bags: InventoryItem[] = [...bagOnlyRows, ...representativeBags]
      .map(strip)
      .sort((a, b) => a.currentStock - b.currentStock);

    // Main list: straps, inserts, jewelry, accessories, etc. (everything that
    // isn't a bag). Keep a SKU if it has stock OR sold units in the window.
    // Gift cards and ALL bag listings are excluded (bags have their own section).
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
    //  - PHANTOM public bag variants — bags are counted ONCE via the true-bag
    //    set (bag-only listings + one representative per public color-group).
    const normalRows = allRows.filter(r => !r._isGiftCard && !r._isBag && !r._isPublicBag);
    const valued = [...normalRows, ...bagOnlyRows, ...representativeBags]
      .filter(r => r.currentStock > 0 && r.stockValue > 0);
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
      .filter(r => !r._isBag && !r._isPublicBag)
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
