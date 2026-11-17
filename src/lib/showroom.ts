// Showroom tab (e.g. L&A Showroom, Dallas): the wholesale orders an outside
// sales team has written, and the draft orders still waiting to become
// orders. Both are read live from Shopify by the showroom's tag.
import { showroomByKey, Showroom } from '@/src/lib/client';
import { adminGraphql } from '@/src/lib/shopifyAdmin';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const amount = (set: { shopMoney?: { amount?: string } } | null | undefined) => num(set?.shopMoney?.amount);
/** Shopify search literal for a tag (tags may hold & and spaces). */
const tagQuery = (tag: string) => `tag:'${tag.replace(/['\\]/g, '\\$&')}'`;
const hasTag = (tags: string[] | undefined, tag: string) => (tags || []).some(t => t.toLowerCase() === tag.toLowerCase());

interface Address { company: string | null; city: string | null; provinceCode: string | null }

/**
 * The retailer an order is for: the ship-to company, else the name the
 * wholesale app writes into the note ("Wholesale Order: <store>"), else the
 * buyer's name.
 */
function accountName(addr: Address | null, note: string | null, customer: string | null): string {
  const company = (addr?.company || '').trim();
  if (company) return company;
  const m = /Wholesale Order:\s*(.+)/i.exec(note || '');
  if (m && m[1].trim()) return m[1].trim();
  return (customer || '').trim() || 'Unknown account';
}
/** Same store typed two ways ("JUJU B'S", "Ju Ju B’s") rolls up as one account. */
const accountKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const place = (a: Address | null) => [a?.city?.trim(), a?.provinceCode].filter(Boolean).join(', ');
/** The buyer's own words, without the wholesale app's "Wholesale Order: <store>" header line. */
const cleanNote = (note: string | null) => (note || '').split('\n').filter(l => !/^\s*Wholesale Order\b/i.test(l)).join('\n').replace(/^Customer Note:\s*/i, '').trim();

export interface ShowroomOrder {
  id: string; name: string; createdAt: string;
  account: string; accountKey: string; buyer: string; place: string;
  /** What the order stands at today (after edits and refunds). */
  total: number;
  /** What it was written for. */
  originalTotal: number;
  refunded: number;
  units: number;
  financial: string; fulfillment: string;
  cancelled: boolean; firstOrder: boolean;
  note: string;
}
export interface ShowroomLine {
  title: string; variant: string; sku: string; quantity: number; total: number;
  /** Units on hand in Shopify right now (drafts only; null = not tracked). */
  onHand?: number | null;
  /** Units this line is still short of (drafts only). */
  short?: number;
  /** Units not yet shipped (orders only). */
  unfulfilled?: number;
}
export interface ShowroomDraft {
  id: string; name: string; createdAt: string; updatedAt: string;
  account: string; accountKey: string; buyer: string; place: string;
  total: number; units: number;
  status: 'OPEN' | 'INVOICE_SENT';
  invoiceSentAt: string | null;
  note: string;
  lines: ShowroomLine[];
  moreLines: boolean;
  /** Units across all lines that Shopify has no stock for today. */
  unitsShort: number;
}
export interface ShowroomAccount {
  key: string; account: string; place: string;
  orders: number; total: number; units: number; lastOrder: string | null;
  pendingDrafts: number; pendingTotal: number;
}
export interface ShowroomMonth { month: string; orders: number; total: number }
export interface ShowroomData {
  showroom: Showroom;
  totals: {
    orders: number; total: number; units: number; aov: number; accounts: number;
    unshippedOrders: number;
    pendingDrafts: number; pendingTotal: number; pendingUnits: number; pendingUnitsShort: number;
  };
  drafts: ShowroomDraft[];
  orders: ShowroomOrder[];
  accounts: ShowroomAccount[];
  monthly: ShowroomMonth[];
  /** True when the store holds more tagged orders than the tab reads (oldest are left out). */
  truncated: boolean;
  fetchedAt: string;
}

const ORDERS_Q = `query ShowroomOrders($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus note tags
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      subtotalLineItemsQuantity currentSubtotalLineItemsQuantity
      customer { displayName }
      shippingAddress { company city provinceCode }
    }
  }
}`;

const DRAFTS_Q = `query ShowroomDrafts($q: String!, $after: String) {
  draftOrders(first: 10, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt status tags note2 invoiceSentAt
      totalPriceSet { shopMoney { amount } }
      totalQuantityOfLineItems
      customer { displayName }
      shippingAddress { company city provinceCode }
      lineItems(first: 80) {
        pageInfo { hasNextPage }
        nodes { title variantTitle sku quantity discountedTotalSet { shopMoney { amount } } variant { inventoryQuantity } }
      }
    }
  }
}`;

const ORDER_LINES_Q = `query ShowroomOrderLines($id: ID!) {
  order(id: $id) {
    tags
    lineItems(first: 150) {
      nodes { title variantTitle sku quantity currentQuantity unfulfilledQuantity discountedTotalSet { shopMoney { amount } } }
    }
  }
}`;

type Money = { shopMoney?: { amount?: string } };
interface OrderNode {
  id: string; name: string; createdAt: string; cancelledAt: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null; note: string | null; tags: string[];
  totalPriceSet: Money; currentTotalPriceSet: Money; totalRefundedSet: Money;
  subtotalLineItemsQuantity: number; currentSubtotalLineItemsQuantity: number;
  customer: { displayName: string | null } | null; shippingAddress: Address | null;
}
interface DraftNode {
  id: string; name: string; createdAt: string; updatedAt: string; status: string; tags: string[]; note2: string | null; invoiceSentAt: string | null;
  totalPriceSet: Money; totalQuantityOfLineItems: number;
  customer: { displayName: string | null } | null; shippingAddress: Address | null;
  lineItems: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; discountedTotalSet: Money; variant: { inventoryQuantity: number | null } | null }> };
}
interface Page<T> { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }

const MAX_ORDER_PAGES = 10; // 1,000 orders
const MAX_DRAFT_PAGES = 5;  // 50 pending drafts

async function allPages<T>(query: string, field: string, q: string, maxPages: number): Promise<{ nodes: T[]; truncated: boolean }> {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const data: Record<string, Page<T>> = await adminGraphql<Record<string, Page<T>>>(query, { q, after }, 30000);
    const page: Page<T> = data[field];
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return { nodes, truncated: false };
    after = page.pageInfo.endCursor;
  }
  return { nodes, truncated: true };
}

export async function fetchShowroom(key: string): Promise<ShowroomData> {
  const showroom = showroomByKey(key);
  if (!showroom) throw new Error('No such showroom on this dashboard.');
  const tq = tagQuery(showroom.tag);
  const [o, d] = await Promise.all([
    allPages<OrderNode>(ORDERS_Q, 'orders', tq, MAX_ORDER_PAGES),
    // Completed drafts already appear as orders; only the waiting ones are fetched.
    allPages<DraftNode>(DRAFTS_Q, 'draftOrders', `${tq} AND NOT status:completed`, MAX_DRAFT_PAGES),
  ]);

  // Shopify's tag search is a prefix-tolerant text match; keep exact tag matches only.
  const orders: ShowroomOrder[] = o.nodes.filter(n => hasTag(n.tags, showroom.tag)).map(n => {
    const buyer = n.customer?.displayName || '';
    const account = accountName(n.shippingAddress, n.note, buyer);
    return {
      id: n.id, name: n.name, createdAt: n.createdAt,
      account, accountKey: accountKey(account), buyer, place: place(n.shippingAddress),
      total: amount(n.currentTotalPriceSet), originalTotal: amount(n.totalPriceSet), refunded: amount(n.totalRefundedSet),
      units: num(n.currentSubtotalLineItemsQuantity),
      financial: n.displayFinancialStatus || '', fulfillment: n.displayFulfillmentStatus || '',
      cancelled: Boolean(n.cancelledAt), firstOrder: hasTag(n.tags, 'First Order'),
      note: cleanNote(n.note),
    };
  });

  const drafts: ShowroomDraft[] = d.nodes
    .filter(n => hasTag(n.tags, showroom.tag) && (n.status === 'OPEN' || n.status === 'INVOICE_SENT'))
    .map(n => {
      const buyer = n.customer?.displayName || '';
      const account = accountName(n.shippingAddress, n.note2, buyer);
      const lines: ShowroomLine[] = n.lineItems.nodes.map(l => {
        // Custom lines and untracked variants have no stock figure.
        const onHand = l.variant?.inventoryQuantity == null ? null : num(l.variant.inventoryQuantity);
        const short = onHand === null ? 0 : Math.max(0, l.quantity - Math.max(0, onHand));
        return { title: l.title, variant: l.variantTitle || '', sku: l.sku || '', quantity: l.quantity, total: amount(l.discountedTotalSet), onHand, short };
      });
      return {
        id: n.id, name: n.name, createdAt: n.createdAt, updatedAt: n.updatedAt,
        account, accountKey: accountKey(account), buyer, place: place(n.shippingAddress),
        total: amount(n.totalPriceSet), units: num(n.totalQuantityOfLineItems),
        status: n.status as 'OPEN' | 'INVOICE_SENT', invoiceSentAt: n.invoiceSentAt,
        note: cleanNote(n.note2),
        lines, moreLines: n.lineItems.pageInfo.hasNextPage,
        unitsShort: lines.reduce((s, l) => s + (l.short || 0), 0),
      };
    })
    // Oldest first: the longest-waiting backorder leads.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const live = orders.filter(x => !x.cancelled);
  const byAccount = new Map<string, ShowroomAccount>();
  const acct = (k: string, account: string, pl: string) => {
    let a = byAccount.get(k);
    if (!a) { a = { key: k, account, place: pl, orders: 0, total: 0, units: 0, lastOrder: null, pendingDrafts: 0, pendingTotal: 0 }; byAccount.set(k, a); }
    if (!a.place && pl) a.place = pl;
    return a;
  };
  const byMonth = new Map<string, ShowroomMonth>();
  for (const x of live) {
    const a = acct(x.accountKey, x.account, x.place);
    a.orders += 1; a.total += x.total; a.units += x.units;
    if (!a.lastOrder || x.createdAt > a.lastOrder) a.lastOrder = x.createdAt;
    const month = x.createdAt.slice(0, 7);
    const m = byMonth.get(month) || { month, orders: 0, total: 0 };
    m.orders += 1; m.total += x.total;
    byMonth.set(month, m);
  }
  for (const x of drafts) {
    const a = acct(x.accountKey, x.account, x.place);
    a.pendingDrafts += 1; a.pendingTotal += x.total;
  }

  const total = live.reduce((s, x) => s + x.total, 0);
  const pendingTotal = drafts.reduce((s, x) => s + x.total, 0);
  return {
    showroom,
    totals: {
      orders: live.length, total, units: live.reduce((s, x) => s + x.units, 0),
      aov: live.length ? total / live.length : 0,
      accounts: new Set(live.map(x => x.accountKey)).size,
      unshippedOrders: live.filter(x => x.fulfillment && x.fulfillment !== 'FULFILLED').length,
      pendingDrafts: drafts.length, pendingTotal,
      pendingUnits: drafts.reduce((s, x) => s + x.units, 0),
      pendingUnitsShort: drafts.reduce((s, x) => s + x.unitsShort, 0),
    },
    drafts, orders,
    accounts: Array.from(byAccount.values()).sort((a, b) => (b.total + b.pendingTotal) - (a.total + a.pendingTotal)),
    monthly: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
    truncated: o.truncated || d.truncated,
    fetchedAt: new Date().toISOString(),
  };
}

/** Line items of one order, only when that order carries the showroom's tag. */
export async function fetchShowroomOrderLines(key: string, orderId: string): Promise<ShowroomLine[]> {
  const showroom = showroomByKey(key);
  if (!showroom) throw new Error('No such showroom on this dashboard.');
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId)) throw new Error('Not an order id.');
  const data = await adminGraphql<{ order: { tags: string[]; lineItems: { nodes: Array<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; currentQuantity: number; unfulfilledQuantity: number; discountedTotalSet: Money }> } } | null }>(ORDER_LINES_Q, { id: orderId });
  if (!data.order || !hasTag(data.order.tags, showroom.tag)) throw new Error('That order is not one of this showroom\'s.');
  return data.order.lineItems.nodes.map(l => ({
    title: l.title, variant: l.variantTitle || '', sku: l.sku || '',
    quantity: l.currentQuantity, total: amount(l.discountedTotalSet), unfulfilled: l.unfulfilledQuantity,
  }));
}
