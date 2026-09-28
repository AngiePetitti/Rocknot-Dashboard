// The real product catalog from Shopify — titles, variants, prices, and a
// short description per product. This is what grounds AI-written copy:
// campaign copy may only reference products/variants/features that exist
// here (Cleo once invented an "Eden 2-in-1 Clutch" with finishes and a
// strap that aren't real products).
import { shopifyDomain } from '@/src/lib/client';

export interface CatalogProduct {
  title: string;
  type: string;
  status: string;
  price: string;
  variants: string[];
  /** Variant names that are sold out — must never appear in promo copy. */
  oosVariants: string[];
  /** True when no variant is available to sell. */
  soldOut: boolean;
  description: string;
}

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();

let cache: { at: number; items: CatalogProduct[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export async function fetchCatalog(): Promise<CatalogProduct[]> {
  if (!TOKEN) return [];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;

  const items: CatalogProduct[] = [];
  let cursor: string | null = null;
  // inventoryQuantity needs the read_inventory scope; if the token lacks it,
  // retry without that field rather than losing the whole catalog.
  let inventoryField = 'inventoryQuantity';
  for (let page = 0; page < 3; page++) {
    const buildQuery = (): string => `{
      products(first: 100${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}, query: "status:active", sortKey: TITLE) {
        pageInfo { hasNextPage endCursor }
        nodes {
          title
          productType
          status
          description
          priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
          variants(first: 30) { nodes { title availableForSale ${inventoryField} } }
        }
      }
    }`;
    const run = async () => {
      const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
        body: JSON.stringify({ query: buildQuery() }),
        cache: 'no-store',
      });
      return res.json();
    };
    let json = await run();
    if (!json?.data?.products && inventoryField) {
      inventoryField = '';
      json = await run();
    }
    const prods = json?.data?.products;
    if (!prods) break;
    for (const p of prods.nodes || []) {
      const min = Number(p?.priceRangeV2?.minVariantPrice?.amount || 0);
      const max = Number(p?.priceRangeV2?.maxVariantPrice?.amount || 0);
      const vnodes = (p?.variants?.nodes || []) as Array<{ title?: string; availableForSale?: boolean; inventoryQuantity?: number }>;
      // A variant is sellable only if Shopify says available AND it has
      // units (inventoryQuantity can be null when untracked — trust
      // availableForSale then).
      const sellable = (v: { availableForSale?: boolean; inventoryQuantity?: number }) =>
        v.availableForSale !== false && (v.inventoryQuantity == null || v.inventoryQuantity > 0);
      const named = (v: { title?: string }) => v?.title && !/^Default Title$/i.test(v.title);
      items.push({
        title: p?.title || '',
        type: p?.productType || '',
        status: p?.status || '',
        price: min === max ? `$${min}` : `$${min}-$${max}`,
        variants: vnodes.filter(v => named(v) && sellable(v)).map(v => v.title!),
        oosVariants: vnodes.filter(v => named(v) && !sellable(v)).map(v => v.title!),
        soldOut: vnodes.length > 0 && !vnodes.some(sellable),
        description: String(p?.description || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      });
    }
    if (!prods.pageInfo?.hasNextPage) break;
    cursor = prods.pageInfo.endCursor;
  }
  if (items.length) cache = { at: Date.now(), items };
  return items;
}

/** Compact text rendering for AI prompts/tool results. */
export function catalogText(items: CatalogProduct[]): string {
  if (!items.length) return 'Catalog unavailable (Shopify not configured or no active products).';
  return items
    .map(p => {
      const bits = [p.title];
      if (p.soldOut) bits.push('⛔ SOLD OUT — do NOT feature or mention in any campaign');
      if (p.type) bits.push(`[${p.type}]`);
      bits.push(p.price);
      if (p.variants.length) bits.push(`in-stock variants: ${p.variants.join(', ')}`);
      if (p.oosVariants.length) bits.push(`OUT OF STOCK (never mention): ${p.oosVariants.join(', ')}`);
      if (p.description) bits.push(`— ${p.description}`);
      return `• ${bits.join(' · ')}`;
    })
    .join('\n');
}
