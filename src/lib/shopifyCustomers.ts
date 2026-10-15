// Customer Intel straight from Shopify (clients with direct data — no Windsor
// order table in BigQuery). Two Shopify facts make this possible without the
// full order history:
//   • each order's customerJourneySummary.customerOrderIndex says whether it
//     was the customer's 1st, 2nd, 3rd… order (first / repeat order values);
//   • each customer's numberOfOrders and amountSpent are LIFETIME figures
//     (tiers and lifetime value for everyone who bought in the period).
// Shopify only returns orders from the last 60 days unless the app has the
// read_all_orders scope, so without it older ranges come back partial —
// `partial` says so (the scope is checked on the installed app, not assumed).
import { shopifyDomain } from '@/src/lib/client';
import { shopifyToken } from '@/src/lib/shopifyAuth';

export interface DirectCustomerMetrics {
  avgLTV: number;
  firstOrderAvg: number;
  secondOrderAvg: number;
  thirdPlusOrderAvg: number;
  activeCustomers: number;
  oneOrderCount: number;
  twoOrderCount: number;
  threePlusCount: number;
  ltvOneOrder: number;
  ltvTwoOrders: number;
  ltvThreePlus: number;
  firstOrderNet: number;
  secondOrderNet: number;
  thirdPlusOrderNet: number;
  ordersRead: number;
  /** Why the range is incomplete: the 6,000-order cap, the 60-day limit (no read_all_orders), or null when complete. */
  partial: 'cap' | 'sixty-days' | null;
}

interface OrderNode {
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
  currentTotalPriceSet: { shopMoney: { amount: string } };
  customerJourneySummary: { customerOrderIndex: number | null } | null;
  customer: { id: string; numberOfOrders: string; amountSpent: { amount: string } } | null;
}

const QUERY = `query Orders($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      customerJourneySummary { customerOrderIndex }
      customer { id numberOfOrders amountSpent { amount } }
    }
  }
}`;

// Whether the installed app holds read_all_orders (orders older than 60 days).
async function hasAllOrdersScope(): Promise<boolean> {
  try {
    const res = await fetch(`https://${shopifyDomain()}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await shopifyToken() },
      body: JSON.stringify({ query: '{ currentAppInstallation { accessScopes { handle } } }' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json() as { data?: { currentAppInstallation?: { accessScopes?: Array<{ handle: string }> } } };
    return Boolean(json.data?.currentAppInstallation?.accessScopes?.some(s => s.handle === 'read_all_orders'));
  } catch {
    return false;
  }
}

const GRAPHQL_URL = () => `https://${shopifyDomain()}/admin/api/2026-04/graphql.json`;

async function adminGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GRAPHQL_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await shopifyToken() },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json() as { data?: T; errors?: Array<{ message?: string }> | string };
  if (json.errors || !json.data) {
    const msg = Array.isArray(json.errors) ? json.errors.map(e => e.message).join('; ') : String(json.errors || `HTTP ${res.status}`);
    throw new Error(`Shopify query failed: ${msg}`);
  }
  return json.data;
}

// Up to this many orders are read page by page (fast, no waiting). Larger
// ranges use a bulk operation: Shopify packages every matching order into one
// file, with no cap.
const PAGED_LIMIT = 2500;
const MAX_PAGES = 60;

async function pagedOrders(q: string): Promise<{ orders: OrderNode[]; hitCap: boolean }> {
  const orders: OrderNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } =
      await adminGql(QUERY, { q, after });
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) return { orders, hitCap: false };
    after = data.orders.pageInfo.endCursor;
  }
  return { orders, hitCap: true };
}

const BULK_FIELDS = `createdAt
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      customerJourneySummary { customerOrderIndex }
      customer { id numberOfOrders amountSpent { amount } }`;

// Shopify usually finishes a bulk export of a few thousand orders in seconds;
// stay well inside the route's time limit.
const BULK_WAIT_MS = 45000;

async function bulkOrders(q: string): Promise<OrderNode[]> {
  const inner = `{ orders(query: ${JSON.stringify(q)}) { edges { node { ${BULK_FIELDS} } } } }`;
  const started: { bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: Array<{ message: string }> } } =
    await adminGql(`mutation Run($q: String!) { bulkOperationRunQuery(query: $q, groupObjects: false) { bulkOperation { id } userErrors { message } } }`, { q: inner });
  const op = started.bulkOperationRunQuery;
  if (!op.bulkOperation) throw new Error(`Shopify bulk export refused: ${op.userErrors.map(e => e.message).join('; ') || 'unknown reason'}`);

  const deadline = Date.now() + BULK_WAIT_MS;
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    const polled: { node: { status: string; errorCode: string | null; url: string | null } | null } =
      await adminGql(`query Poll($id: ID!) { node(id: $id) { ... on BulkOperation { status errorCode url } } }`, { id: op.bulkOperation.id });
    const n = polled.node;
    if (n?.status === 'COMPLETED') {
      if (!n.url) return []; // no matching orders
      const text = await (await fetch(n.url, { cache: 'no-store', signal: AbortSignal.timeout(20000) })).text();
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as OrderNode);
    }
    if (n && ['FAILED', 'CANCELED', 'EXPIRED'].includes(n.status)) throw new Error(`Shopify bulk export ${n.status.toLowerCase()}${n.errorCode ? ` (${n.errorCode})` : ''}`);
    if (Date.now() > deadline) throw new Error('Shopify is still preparing the order export for this range — reload the page in a minute.');
  }
}

export async function fetchDirectCustomerMetrics(from: string, to: string): Promise<DirectCustomerMetrics> {
  const allOrdersScope = hasAllOrdersScope();
  const q = `created_at:>=${from} created_at:<=${to}T23:59:59`;
  const counted: { ordersCount: { count: number } | null } = await adminGql(`query Count($q: String!) { ordersCount(query: $q, limit: null) { count } }`, { q });
  const expected = counted.ordersCount?.count ?? 0;
  let orders: OrderNode[];
  let hitCap = false;
  if (expected > PAGED_LIMIT) {
    orders = await bulkOrders(q);
  } else {
    ({ orders, hitCap } = await pagedOrders(q));
  }

  const num = (s: string | undefined) => parseFloat(s || '0') || 0;
  const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0;

  // Order value by purchase number.
  const byIndex: Record<1 | 2 | 3, { gross: number[]; net: number[] }> = { 1: { gross: [], net: [] }, 2: { gross: [], net: [] }, 3: { gross: [], net: [] } };
  // Lifetime tiers for each customer who bought in the period.
  const customers = new Map<string, { orders: number; spent: number }>();
  for (const o of orders) {
    const lifetimeOrders = Math.round(num(o.customer?.numberOfOrders));
    const idx = o.customerJourneySummary?.customerOrderIndex ?? (lifetimeOrders === 1 ? 1 : null);
    if (idx) {
      const b = byIndex[(idx >= 3 ? 3 : idx) as 1 | 2 | 3];
      b.gross.push(num(o.totalPriceSet.shopMoney.amount));
      b.net.push(num(o.currentTotalPriceSet.shopMoney.amount));
    }
    if (o.customer) customers.set(o.customer.id, { orders: lifetimeOrders, spent: num(o.customer.amountSpent.amount) });
  }
  const all = Array.from(customers.values());
  const tier = (f: (c: { orders: number }) => boolean) => all.filter(f);
  const one = tier(c => c.orders <= 1), two = tier(c => c.orders === 2), three = tier(c => c.orders >= 3);

  // Shopify serves only ~60 days of orders without read_all_orders.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  return {
    avgLTV: avg(all.map(c => c.spent)),
    firstOrderAvg: avg(byIndex[1].gross), secondOrderAvg: avg(byIndex[2].gross), thirdPlusOrderAvg: avg(byIndex[3].gross),
    firstOrderNet: avg(byIndex[1].net), secondOrderNet: avg(byIndex[2].net), thirdPlusOrderNet: avg(byIndex[3].net),
    activeCustomers: all.length,
    oneOrderCount: one.length, twoOrderCount: two.length, threePlusCount: three.length,
    ltvOneOrder: avg(one.map(c => c.spent)), ltvTwoOrders: avg(two.map(c => c.spent)), ltvThreePlus: avg(three.map(c => c.spent)),
    ordersRead: orders.length,
    partial: hitCap ? 'cap' : (from < sixtyDaysAgo && !(await allOrdersScope)) ? 'sixty-days' : null,
  };
}
