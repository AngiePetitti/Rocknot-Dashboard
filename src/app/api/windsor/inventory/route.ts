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
  unitPrice: number;   // current listing price per unit (retail value / units)
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

// Current listing prices straight from the Shopify catalog (Admin GraphQL), so
// we can show a price even for out-of-stock items (where retail-value-on-hand
// is 0). Returns a per-variant map plus a per-product fallback, both keyed on
// normalized titles that match the ShopifyQL product/variant titles.
const priceNorm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
async function fetchVariantPrices(): Promise<{ byKey: Map<string, number>; byProduct: Map<string, number>; qtyByKey: Map<string, number> }> {
  const byKey = new Map<string, number>();
  const byProduct = new Map<string, number>();
  // Live on-hand quantities: the ShopifyQL analytics feed lags restocks by
  // hours, so current stock comes from the live catalog instead.
  const qtyByKey = new Map<string, number>();
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) { // safety cap (~5000 variants)
      const query = `query($cursor: String) {
        productVariants(first: 250, after: $cursor) {
          nodes { title price inventoryQuantity product { title } }
          pageInfo { hasNextPage endCursor }
        }
      }`;
      const res: Response = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
        body: JSON.stringify({ query, variables: { cursor } }),
        cache: 'no-store',
      });
      const json = await res.json();
      const conn = json?.data?.productVariants;
      if (!conn) break;
      for (const n of conn.nodes || []) {
        const product = n.product?.title || '';
        const vkey = `${priceNorm(product)}||${priceNorm(n.title || '')}`;
        if (typeof n.inventoryQuantity === 'number') {
          qtyByKey.set(vkey, (qtyByKey.get(vkey) ?? 0) + n.inventoryQuantity);
        }
        const price = Math.round(parseFloat(n.price || '0'));
        if (price <= 0) continue;
        byKey.set(vkey, price);
        // Per-product fallback: keep the highest variant price seen.
        const pk = priceNorm(product);
        byProduct.set(pk, Math.max(byProduct.get(pk) ?? 0, price));
      }
      if (!conn.pageInfo?.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
  } catch {
    // Non-fatal — fall back to retail-value-derived price.
  }
  return { byKey, byProduct, qtyByKey };
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
    const [{ rows, cell }, prices] = await Promise.all([
      runShopifyQL(
        `FROM inventory
         SHOW ending_inventory_units, starting_inventory_units, inventory_units_sold, sell_through_rate, ending_inventory_value, ending_inventory_retail_value
         GROUP BY product_title, product_variant_title, product_type
         SINCE ${SINCE} UNTIL ${UNTIL}
         HAVING ending_inventory_units < 50000
         ORDER BY inventory_units_sold DESC
         LIMIT 2000`
      ),
      fetchVariantPrices(),
    ]);

    // Current listing price for a (product, variant), from the live catalog;
    // falls back to the per-product price, then to retail-value-per-unit.
    const priceFor = (product: string, variant: string, retailValue: number, stock: number): number => {
      const k = `${priceNorm(product)}||${priceNorm(variant)}`;
      return prices.byKey.get(k)
        ?? prices.byProduct.get(priceNorm(product))
        ?? (stock > 0 ? Math.round(retailValue / stock) : 0);
    };

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
      _isPublicBag: boolean; _isCombo: boolean; _bagCovered: boolean; _bagBare: boolean;
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
      // The live catalog quantity wins when we have it — the analytics feed
      // lags restocks by hours (kept items showing OUT after a restock).
      const liveQty = prices.qtyByKey.get(`${priceNorm(rawProduct)}||${priceNorm(variant)}`);
      const currentStock = Math.max(0, liveQty !== undefined ? liveQty : rawStock);
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
      // Combo/set listings that pair existing products ("X + Y" titles, the
      // PHONEPACK pouch+strap+charm set): their variant counts mirror the
      // component products' stock across many variants (audited Aug 2026 —
      // e.g. every PHONEPACK strap-color variant repeats the same pouch
      // count), so counting them would duplicate stock already counted on
      // the component SKUs. Real pre-packed bundles with their own SKUs and
      // distinct per-variant counts (e.g. "Rhinestone Rope Bracelet - 6x
      // Bundle", "The Rope Set") are NOT combos and stay counted.
      const _isCombo = !_isBag && (/\bphonepack\b/i.test(rawProduct) || /\s\+\s/.test(rawProduct));
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
        // Current listing price from the live catalog (works even at 0 stock).
        unitPrice: priceFor(rawProduct, variant, retailValue, currentStock),
        _isBag,
        _isGiftCard: /gift\s*card/i.test(rawProduct),
        _isHandbag: /handbag/i.test(category),
        _isPublicBag,
        _isCombo,
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
    // Then collapse mirrored variants inside set/bundle listings: jewelry sets
    // list one shared component pool under many variants (audited Aug 2026 —
    // "The Rope Set - Crystal" carries the identical bracelet counts under both
    // its 13" and 16" necklace variants, matching the hidden "Rope Bracelet -
    // INVENTORY" listing), so identical (stock, starting, value) rows within a
    // set are one pool, counted once with sales summed — not once per variant.
    const dedupSetMirrors = (rows: RawItem[]): RawItem[] => {
      const out: RawItem[] = [];
      const setsByTitle = new Map<string, RawItem[]>();
      for (const r of rows) {
        if (!r._isBag && r.currentStock > 0 && /\b(set|bundle)\b/i.test(r._rawProduct)) {
          const g = setsByTitle.get(r._rawProduct);
          if (g) g.push(r); else setsByTitle.set(r._rawProduct, [r]);
        } else out.push(r);
      }
      setsByTitle.forEach(group => {
        const mirrors = new Map<string, RawItem[]>();
        for (const r of group) {
          const k = `${r.currentStock}|${r._startingStock}|${r.stockValue}`;
          const m = mirrors.get(k);
          if (m) m.push(r); else mirrors.set(k, [r]);
        }
        mirrors.forEach(m => {
          if (m.length === 1) { out.push(m[0]); return; }
          const rep = m[0];
          const sold = m.reduce((s, r) => s + r.unitsSold90d, 0);
          const dailyVelocity = Math.round((sold / PERIOD_DAYS) * 100) / 100;
          const daysRemaining = dailyVelocity > 0 ? Math.round(rep.currentStock / dailyVelocity) : null;
          out.push({
            ...rep,
            variant: `${rep.variant} (+${m.length - 1} mirrored)`,
            unitsSold90d: sold,
            dailyVelocity,
            daysRemaining,
            status: statusFor(rep.currentStock, daysRemaining),
            reorderQty: dailyVelocity > 0
              ? Math.max(0, Math.round(dailyVelocity * SUPPLY_TARGET_DAYS) - rep.currentStock) : 0,
          });
        });
      });
      return out;
    };
    const allRows = dedupSetMirrors(allRowsMapped.filter(r => !r._isSale));

    const strip = ({ _isBag, _isGiftCard, _isHandbag, _isPublicBag, _isCombo, _bagCovered, _bagBare, _isSale, _rawProduct, _startingStock, ...rest }: RawItem): InventoryItem => rest;

    // ── Curated Bags section ──────────────────────────────────────────────
    // The Bags section shows ONLY actual handbags in stock — one row per bag
    // per color, with no strap-type variants and no "+ strap/crown/chain"
    // bundle listings. Each bag's true on-hand is read by an explicit rule
    // confirmed listing-by-listing with the Rocknot team (June 2026). Anything
    // not matched below is intentionally excluded from the section. Rows
    // consumed as bags are also excluded from the main list and counted once
    // in valuation, so nothing double-counts.
    const consumed = new Set<string>();
    const keyOf = (r: RawItem) => `${r._rawProduct}||${r.variant}`;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const disp = (t: string) => t.replace(/\s{2,}/g, ' ').trim();
    const sumBy = (rows: RawItem[], f: (r: RawItem) => number) => rows.reduce((s, r) => s + f(r), 0);
    const maxBy = (rows: RawItem[], f: (r: RawItem) => number) => rows.reduce((a, b) => (f(b) > f(a) ? b : a));

    const byTitle = new Map<string, RawItem[]>();
    for (const r of allRows) {
      const t = norm(r._rawProduct);
      const g = byTitle.get(t);
      if (g) g.push(r); else byTitle.set(t, [r]);
    }

    // Bag listing price = the highest catalog price among the bag's source
    // rows (works even when the bag is out of stock).
    const gp = (rws: RawItem[]) => Math.max(0, ...rws.map(r => priceFor(r._rawProduct, r.variant, r.retailValue, r.currentStock)));

    const mkBag = (label: string, stock: number, sold: number, value: number, retail: number, price: number): InventoryItem => {
      const dailyVelocity = Math.round((sold / PERIOD_DAYS) * 100) / 100;
      const daysRemaining = stock <= 0
        ? (dailyVelocity > 0 ? 0 : null)
        : dailyVelocity > 0 ? Math.round(stock / dailyVelocity) : null;
      const reorderQty = dailyVelocity > 0
        ? Math.max(0, Math.round(dailyVelocity * SUPPLY_TARGET_DAYS) - stock) : 0;
      return {
        id: `bag:${label}`,
        product: label, variant: '', category: 'Handbags',
        currentStock: stock, unitsSold90d: sold, dailyVelocity, daysRemaining,
        sellThroughRate: 0, status: statusFor(stock, daysRemaining), reorderQty,
        stockValue: value, retailValue: retail,
        unitPrice: price || (stock > 0 ? Math.round(retail / stock) : 0),
      };
    };
    const consume = (rows: RawItem[]) => { for (const r of rows) consumed.add(keyOf(r)); };

    const bags: InventoryItem[] = [];

    // A) Simple bags (sold without a strap): one row per product title. Stock is
    //    the shared on-hand (MAX across variants — collapses identical strap-
    //    length repeats), sales summed across variants.
    const SIMPLE = [/^alli\b.*bucket/i, /^ariel\b.*bag/i, /^duo bag\b/i, /^evy\b/i,
      /^fia\b/i, /^infinity belt bag\b/i, /^lyla\b.*pouch/i, /^max belt bag\b/i,
      /^noa fold over\b/i, /^zuma straw tote\b/i];

    // B) Single listings counted per color variant.
    const PER_VARIANT: Array<{ test: (t: string) => boolean; label: (v: string) => string }> = [
      { test: t => /^pebble coin purse/i.test(t), label: v => `Pebble Coin Purse - ${v}` },
      { test: t => norm(t) === 'eden 2-in-1 clutch', label: v => `Eden 2-in-1 Clutch - ${v}` },
      { test: t => norm(t) === 'maya phone bag (bag only)', label: v => `MAYA Phone Bag - ${v}` },
    ];

    // F) The original Transformer — the clean "Transformer - <Color>" listings.
    const ORIG_TRANSFORMER = new Set([
      'transformer - crystal', 'transformer - gunmetal', 'transformer - champagne bubbles',
    ]);

    for (const rows of Array.from(byTitle.values())) {
      const title = rows[0]._rawProduct;
      const t = norm(title);

      // A) Simple no-strap families (skip any "+"/strap bundle listing).
      if (!/\+|strap/i.test(title) && SIMPLE.some(re => re.test(title))) {
        const rep = maxBy(rows, r => r.currentStock);
        bags.push(mkBag(disp(title), rep.currentStock, sumBy(rows, r => r.unitsSold90d), rep.stockValue, rep.retailValue, gp(rows)));
        consume(rows); continue;
      }

      // B) Per-color single listings.
      const pv = PER_VARIANT.find(s => s.test(title));
      if (pv) {
        for (const r of rows) bags.push(mkBag(pv.label(r.variant), r.currentStock, r.unitsSold90d, r.stockValue, r.retailValue, gp([r])));
        consume(rows); continue;
      }

      // C) Galaxy bag-only: sum the closure sub-variants per color.
      if (t === 'galaxy bag (bag only)') {
        const byColor = new Map<string, RawItem[]>();
        for (const r of rows) {
          const color = (r.variant.split('/')[0] || '').trim() || r.variant;
          const g = byColor.get(color); if (g) g.push(r); else byColor.set(color, [r]);
        }
        byColor.forEach((cr, color) => bags.push(mkBag(`Galaxy Bag - ${color}`,
          sumBy(cr, r => r.currentStock), sumBy(cr, r => r.unitsSold90d), sumBy(cr, r => r.stockValue), sumBy(cr, r => r.retailValue), gp(cr))));
        consume(rows); continue;
      }

      // D) Drink Bag — single bag-only listing.
      if (t === 'drink bag (bag only)') {
        bags.push(mkBag('Drink Bag', sumBy(rows, r => r.currentStock), sumBy(rows, r => r.unitsSold90d), sumBy(rows, r => r.stockValue), sumBy(rows, r => r.retailValue), gp(rows)));
        consume(rows); continue;
      }

      // E) Transformer 2 — the two "BAG ONLY - INVENTORY" listings.
      if (/^transformer2\b.*bag only/i.test(title)) {
        const color = /anti(que)?\s*gold/i.test(title) ? 'Antique Gold' : 'Crystal';
        bags.push(mkBag(`TRANSFORMER 2 - ${color}`, sumBy(rows, r => r.currentStock), sumBy(rows, r => r.unitsSold90d), sumBy(rows, r => r.stockValue), sumBy(rows, r => r.retailValue), gp(rows)));
        consume(rows); continue;
      }

      // F) The original Transformer — clean "Transformer - <Color>" listings.
      if (ORIG_TRANSFORMER.has(t)) {
        const color = (title.split(/[-–—]/)[1] || '').trim();
        const rep = maxBy(rows, r => r.currentStock);
        bags.push(mkBag(`THE TRANSFORMER - ${color}`, rep.currentStock, sumBy(rows, r => r.unitsSold90d), rep.stockValue, rep.retailValue, gp(rows)));
        consume(rows); continue;
      }

      // G) NO SWING STRAP bags (ORI Hobo, Hezi): the bare bag count per color.
      if (/^ori hobo bag\s*-/i.test(title) || /^hezi (leather )?shoulder bag\s*-/i.test(title)) {
        const nss = rows.find(r => norm(r.variant) === 'no swing strap');
        if (nss) bags.push(mkBag(disp(title), nss.currentStock, sumBy(rows, r => r.unitsSold90d), nss.stockValue, nss.retailValue, gp(rows)));
        consume(rows); continue;
      }
    }

    bags.sort((a, b) => a.currentStock - b.currentStock);

    // Main list: everything that isn't a bag (straps, inserts, jewelry, etc.).
    // Excludes gift cards, bag-ish rows, and anything consumed by the curated
    // bag list. Keep a SKU if it has stock OR sold units in the window.
    const items: InventoryItem[] = allRows
      .filter(r => !r._isGiftCard && !r._isBag && !r._isHandbag && !r._isPublicBag && !r._isCombo
        && !consumed.has(keyOf(r)) && (r.currentStock > 0 || r.unitsSold90d > 0))
      .map(strip);

    // Counts span the main list plus bags so the tiles reflect everything.
    const tileScope = [...items, ...bags];
    const outOfStock = tileScope.filter(i => i.status === 'out_of_stock').length;
    const critical = tileScope.filter(i => i.status === 'critical').length;
    const low = tileScope.filter(i => i.status === 'low').length;
    const healthy = tileScope.filter(i => i.status === 'healthy').length;

    const categories = Array.from(new Set(items.map(i => i.category))).filter(Boolean).sort();

    // ── Inventory $ insights ──────────────────────────────────────────────
    // Value everything physically on hand that has a real cost figure in
    // Shopify (stockValue 0 = no cost set, left out). Bags are counted ONCE via
    // the curated set; their source rows are excluded from normalRows via
    // `consumed`, so nothing double-counts. Gift cards and phantom bag/bundle
    // listings are excluded too.
    const normalRows = allRows.filter(r => !r._isGiftCard && !r._isBag && !r._isPublicBag && !r._isHandbag && !r._isCombo && !consumed.has(keyOf(r)));
    const valued = normalRows.filter(r => r.currentStock > 0 && r.stockValue > 0);
    const bagsValued = bags.filter(b => b.currentStock > 0 && b.stockValue > 0);
    const totalCostValue = valued.reduce((s, r) => s + r.stockValue, 0) + bagsValued.reduce((s, b) => s + b.stockValue, 0);
    const totalRetailValue = valued.reduce((s, r) => s + r.retailValue, 0) + bagsValued.reduce((s, b) => s + b.retailValue, 0);
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
    // Items marked "skipped" (seasonal — held over to sell next season, or
    // discontinued) aren't stuck capital to discount, so they leave the
    // slow/dead list AND its $ totals. Guarded: a storage hiccup just means
    // no exclusions this load.
    const skippedKeys = await import('@/src/lib/chatStore')
      .then(m => m.getDiscontinued())
      .then(list => new Set(list.map(d => `${d.product}|${d.variant}`.toLowerCase())))
      .catch(() => new Set<string>());
    const staleRows = valued.filter(isStale)
      .filter(r => !skippedKeys.has(`${r.product}|${r.variant}`.toLowerCase()));
    const slowStockCostValue = staleRows.reduce((s, r) => s + r.stockValue, 0);
    const slowStockUnits = staleRows.reduce((s, r) => s + r.currentStock, 0);

    // Poor sellers to move/discount — most cash tied up in non-moving stock,
    // worst offenders first. Exclude bags (managed in their own section).
    // Each row also carries the PRODUCT's total 90-day sales across all
    // variants: a slow 16" variant of a strap whose 20" sells briskly is a
    // "discount this length" call, not a dead product — without the product
    // total, the list reads as contradicting Shopify's product pages.
    const soldByProduct = new Map<string, number>();
    for (const r of allRows) {
      const k = norm(r._rawProduct);
      soldByProduct.set(k, (soldByProduct.get(k) ?? 0) + r.unitsSold90d);
    }
    const moveOrDiscount = staleRows
      .filter(r => !r._isBag && !r._isPublicBag && !r._isCombo)
      .map(r => ({ ...strip(r), productUnitsSold90d: soldByProduct.get(norm(r._rawProduct)) ?? r.unitsSold90d }))
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
