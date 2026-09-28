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
  for (let page = 0; page < 3; page++) {
    const query: string = `{
      products(first: 100${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}, query: "status:active", sortKey: TITLE) {
        pageInfo { hasNextPage endCursor }
        nodes {
          title
          productType
          status
          description
          priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
          variants(first: 30) { nodes { title } }
        }
      }
    }`;
    const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    });
    const json = await res.json();
    const prods = json?.data?.products;
    if (!prods) break;
    for (const p of prods.nodes || []) {
      const min = Number(p?.priceRangeV2?.minVariantPrice?.amount || 0);
      const max = Number(p?.priceRangeV2?.maxVariantPrice?.amount || 0);
      items.push({
        title: p?.title || '',
        type: p?.productType || '',
        status: p?.status || '',
        price: min === max ? `$${min}` : `$${min}-$${max}`,
        variants: ((p?.variants?.nodes || []) as Array<{ title?: string }>)
          .map(v => v?.title || '')
          .filter(t => t && !/^Default Title$/i.test(t)),
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
      if (p.type) bits.push(`[${p.type}]`);
      bits.push(p.price);
      if (p.variants.length) bits.push(`variants: ${p.variants.join(', ')}`);
      if (p.description) bits.push(`— ${p.description}`);
      return `• ${bits.join(' · ')}`;
    })
    .join('\n');
}
