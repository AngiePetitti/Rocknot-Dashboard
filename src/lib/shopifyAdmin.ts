// Read-only Shopify Admin GraphQL access for Cleo: collections (with the
// products in each), product search with tags and collection membership,
// discounts, and a guarded free-form query for anything else in the store.
import { shopifyDomain } from '@/src/lib/client';
import { shopifyToken, shopifyConfigured } from '@/src/lib/shopifyAuth';

const API = '2026-04';
type J = Record<string, unknown>;

export async function adminGraphql<T = J>(query: string, variables: J = {}, timeoutMs = 20000): Promise<T> {
  if (!shopifyConfigured()) throw new Error('Shopify is not configured on this dashboard');
  const res = await fetch(`https://${shopifyDomain()}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await shopifyToken() },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> } | null;
  if (!json) throw new Error(`Shopify answered HTTP ${res.status} with no JSON`);
  if (json.errors?.length) {
    const msgs = json.errors.map(e => e.message).join('; ');
    if (/access denied|not approved|scope/i.test(msgs)) throw new Error(`Shopify refused: ${msgs}. The app's Admin API token needs the matching read scope (e.g. read_products, read_discounts) — add it in the Shopify app settings and reinstall.`);
    throw new Error(`Shopify GraphQL error: ${msgs}`);
  }
  if (!json.data) throw new Error('Shopify returned no data');
  return json.data;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v: unknown) => `$${num(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const storeUrl = (path: string) => `https://${shopifyDomain().replace(/\.myshopify\.com$/, '')}${path}`;

export interface CollectionRow { id: string; title: string; handle: string; count: number; kind: 'automated' | 'manual'; rules: string; updatedAt: string; description: string }

export async function listCollections(): Promise<CollectionRow[]> {
  const out: CollectionRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    type Page = { collections: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: J[] } };
    const data: Page = await adminGraphql<Page>(`
      query($cursor: String) { collections(first: 250, after: $cursor, sortKey: TITLE) {
        pageInfo { hasNextPage endCursor }
        nodes { id title handle updatedAt description productsCount { count }
          ruleSet { appliedDisjunctively rules { column relation condition } } }
      } }`, { cursor });
    for (const c of data.collections.nodes) {
      const rs = c.ruleSet as { appliedDisjunctively?: boolean; rules?: Array<{ column: string; relation: string; condition: string }> } | null;
      const rules = rs?.rules?.length ? rs.rules.map(r => `${r.column.toLowerCase()} ${r.relation.toLowerCase().replace(/_/g, ' ')} "${r.condition}"`).join(rs.appliedDisjunctively ? ' OR ' : ' AND ') : '';
      out.push({
        id: String(c.id), title: String(c.title), handle: String(c.handle), updatedAt: String(c.updatedAt || '').slice(0, 10),
        count: num((c.productsCount as J | null)?.count), kind: rs?.rules?.length ? 'automated' : 'manual', rules,
        description: String(c.description || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      });
    }
    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }
  return out;
}

export function collectionsText(rows: CollectionRow[]): string {
  if (!rows.length) return 'No collections found.';
  return `COLLECTIONS (${rows.length}) — title · handle · products · how it is built · link:\n` + rows.map(c =>
    `• ${c.title} · /collections/${c.handle} · ${c.count} products · ${c.kind === 'automated' ? `automated: ${c.rules}` : 'manual'} · ${storeUrl(`/collections/${c.handle}`)}${c.description ? ` — ${c.description}` : ''}`
  ).join('\n');
}

const PRODUCT_FIELDS = `id title handle productType vendor status tags totalInventory createdAt
  priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
  collections(first: 10) { nodes { title } }
  variants(first: 40) { nodes { title availableForSale inventoryQuantity price } }`;

interface ProductNode { id: string; title: string; handle: string; productType: string; vendor: string; status: string; tags: string[]; totalInventory: number | null; createdAt: string; priceRangeV2: { minVariantPrice: { amount: string }; maxVariantPrice: { amount: string } }; collections: { nodes: Array<{ title: string }> }; variants: { nodes: Array<{ title: string; availableForSale: boolean; inventoryQuantity: number | null; price: string }> } }

export function productLine(p: ProductNode): string {
  const min = num(p.priceRangeV2?.minVariantPrice?.amount), max = num(p.priceRangeV2?.maxVariantPrice?.amount);
  const vs = p.variants?.nodes || [];
  const named = vs.filter(v => v.title && !/^Default Title$/i.test(v.title));
  const sellable = (v: { availableForSale: boolean; inventoryQuantity: number | null }) => v.availableForSale !== false && (v.inventoryQuantity == null || v.inventoryQuantity > 0);
  const inStock = named.filter(sellable).map(v => `${v.title}${v.inventoryQuantity != null ? ` (${v.inventoryQuantity})` : ''}`);
  const oos = named.filter(v => !sellable(v)).map(v => v.title);
  const soldOut = vs.length > 0 && !vs.some(sellable);
  const bits = [`${p.title}${p.status !== 'ACTIVE' ? ` [${p.status}]` : ''}${soldOut ? ' ⛔ SOLD OUT' : ''}`];
  if (p.productType) bits.push(`type: ${p.productType}`);
  bits.push(min === max ? money(min) : `${money(min)}–${money(max)}`);
  if (p.totalInventory != null) bits.push(`${p.totalInventory} units`);
  if (p.collections?.nodes?.length) bits.push(`collections: ${p.collections.nodes.map(c => c.title).join(', ')}`);
  if (p.tags?.length) bits.push(`tags: ${p.tags.slice(0, 15).join(', ')}`);
  if (inStock.length) bits.push(`in stock: ${inStock.join(', ')}`);
  if (oos.length) bits.push(`out of stock: ${oos.join(', ')}`);
  bits.push(storeUrl(`/products/${p.handle}`));
  return `• ${bits.join(' · ')}`;
}

export async function collectionProducts(ref: string, limit = 150): Promise<{ collection: { title: string; handle: string; count: number } | null; products: ProductNode[] }> {
  // Accept a handle, a title, or a storefront URL.
  const handle = ref.includes('/collections/') ? ref.split('/collections/')[1].split(/[/?#]/)[0] : ref.trim();
  const byHandle = await adminGraphql<{ collectionByHandle: { id: string; title: string; handle: string; productsCount: { count: number } } | null }>(
    `query($h: String!) { collectionByHandle(handle: $h) { id title handle productsCount { count } } }`, { h: handle });
  let col = byHandle.collectionByHandle;
  if (!col) {
    const search = await adminGraphql<{ collections: { nodes: Array<{ id: string; title: string; handle: string; productsCount: { count: number } }> } }>(
      `query($q: String!) { collections(first: 5, query: $q) { nodes { id title handle productsCount { count } } } }`, { q: `title:*${ref.replace(/"/g, '')}*` });
    const nodes = search.collections.nodes;
    col = nodes.find(n => n.title.toLowerCase() === ref.trim().toLowerCase()) || nodes[0] || null;
  }
  if (!col) return { collection: null, products: [] };
  const products: ProductNode[] = [];
  let cursor: string | null = null;
  while (products.length < limit) {
    type Page = { collection: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ProductNode[] } } };
    const data: Page = await adminGraphql<Page>(`
      query($id: ID!, $cursor: String, $n: Int!) { collection(id: $id) { products(first: $n, after: $cursor) {
        pageInfo { hasNextPage endCursor } nodes { ${PRODUCT_FIELDS} } } } }`, { id: col.id, cursor, n: Math.min(50, limit - products.length) });
    products.push(...data.collection.products.nodes);
    if (!data.collection.products.pageInfo.hasNextPage) break;
    cursor = data.collection.products.pageInfo.endCursor;
  }
  return { collection: { title: col.title, handle: col.handle, count: num(col.productsCount?.count) }, products };
}

export async function searchProducts(query: string, limit = 60): Promise<ProductNode[]> {
  const data = await adminGraphql<{ products: { nodes: ProductNode[] } }>(
    `query($q: String!, $n: Int!) { products(first: $n, query: $q, sortKey: TITLE) { nodes { ${PRODUCT_FIELDS} } } }`, { q: query, n: Math.min(100, limit) });
  return data.products.nodes;
}

export async function listDiscounts(activeOnly = true): Promise<string> {
  const data = await adminGraphql<{ discountNodes: { nodes: Array<{ id: string; discount: J }> } }>(`
    query($q: String) { discountNodes(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id discount {
      __typename
      ... on DiscountCodeBasic { title status startsAt endsAt summary usageLimit asyncUsageCount codes(first: 3) { nodes { code } } combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
      ... on DiscountCodeBxgy { title status startsAt endsAt summary asyncUsageCount codes(first: 3) { nodes { code } } }
      ... on DiscountCodeFreeShipping { title status startsAt endsAt summary asyncUsageCount codes(first: 3) { nodes { code } } }
      ... on DiscountAutomaticBasic { title status startsAt endsAt summary asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
      ... on DiscountAutomaticBxgy { title status startsAt endsAt summary asyncUsageCount }
      ... on DiscountAutomaticFreeShipping { title status startsAt endsAt summary asyncUsageCount }
    } } } }`, { q: activeOnly ? 'status:active' : null });
  // Klaviyo/flow apps mint a unique single-use code per email, titled like
  // "Welcome10 (2026-10-20 11:05)". They are not promotions; hide them.
  const FLOW_STAMP = /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\s*$/;
  const all = data.discountNodes.nodes;
  const flowCodes = all.filter(n => FLOW_STAMP.test(String((n.discount as { title?: string }).title || '')));
  const rows = all.filter(n => !flowCodes.includes(n)).slice(0, 40).map(n => {
    const d = n.discount as { __typename: string; title?: string; status?: string; startsAt?: string; endsAt?: string | null; summary?: string; usageLimit?: number | null; asyncUsageCount?: number; codes?: { nodes: Array<{ code: string }> }; combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean } };
    const kind = String(d.__typename || '').replace('Discount', '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    const codes = d.codes?.nodes?.map(c => c.code).join(', ');
    const combos = d.combinesWith ? Object.entries(d.combinesWith).filter(([, v]) => v).map(([k]) => k.replace('Discounts', '')).join('/') : '';
    return `• ${d.title}${codes ? ` (code ${codes})` : ' (automatic)'} · ${kind} · ${d.status?.toLowerCase()} · ${d.summary || ''} · ${d.startsAt?.slice(0, 10)}${d.endsAt ? ` → ${d.endsAt.slice(0, 10)}` : ' → no end'} · used ${d.asyncUsageCount ?? 0}${d.usageLimit ? `/${d.usageLimit}` : ''} times${combos ? ` · combines with ${combos}` : ''}`;
  });
  const hidden = flowCodes.length ? `\n(${flowCodes.length} single-use flow codes from email automations hidden — e.g. ${flowCodes.slice(0, 3).map(n => String((n.discount as { title?: string }).title || '').replace(FLOW_STAMP, '').trim()).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')})` : '';
  return rows.length ? `DISCOUNTS (${activeOnly ? 'active' : 'all'}, newest first):\n${rows.join('\n')}${hidden}` : `No ${activeOnly ? 'active ' : ''}promotional discounts.${hidden}`;
}

/** Free-form read-only query. Mutations are refused; results are trimmed. */
export async function guardedQuery(query: string, variables: J = {}): Promise<string> {
  const q = query.trim();
  if (/^\s*mutation\b/i.test(q) || /\bmutation\s*[{(]/i.test(q)) throw new Error('Only read queries are allowed here — mutations are refused.');
  const data = await adminGraphql<J>(q, variables, 25000);
  const text = JSON.stringify(data);
  return text.length > 14000 ? `${text.slice(0, 14000)}\n…(truncated: ${text.length.toLocaleString()} chars — narrow the query with first: N, a query: filter, or fewer fields)` : text;
}
