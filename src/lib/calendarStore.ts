// Persistence for the Marketing Calendar. Stores the events array as a single
// JSON metafield on the Shopify shop, so it reuses the Shopify Admin token the
// dashboard already has — no separate database/KV to provision. Shared across
// everyone who loads the dashboard, and survives deploys.

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

const NAMESPACE = 'dashboard';
const KEY = 'marketing_calendar';

export interface MarketingEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  type: 'deadline' | 'launch' | 'sale' | 'influencer' | 'content' | 'photo_shoot' | 'other';
  description?: string;
  color: string;
}

export const TYPE_COLORS: Record<MarketingEvent['type'], string> = {
  deadline: '#ef4444',
  launch: '#8b5cf6',
  sale: '#f59e0b',
  influencer: '#ec4899',
  content: '#3b82f6',
  photo_shoot: '#06b6d4',
  other: '#6b7280',
};

async function adminGraphQL<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error('Shopify access token not configured');
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.errors) {
    // Surface Shopify's access-scope errors clearly (e.g. missing write_metafields).
    throw new Error(json.errors.map((e: { message: string }) => e.message).join('; '));
  }
  return json.data as T;
}

export async function getEvents(): Promise<MarketingEvent[]> {
  const data = await adminGraphQL<{ shop: { metafield: { value: string } | null } }>(
    `{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`
  );
  const value = data?.shop?.metafield?.value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as MarketingEvent[] : [];
  } catch {
    return [];
  }
}

export async function saveEvents(events: MarketingEvent[]): Promise<void> {
  const shop = await adminGraphQL<{ shop: { id: string } }>(`{ shop { id } }`);
  const ownerId = shop.shop.id;
  const data = await adminGraphQL<{ metafieldsSet: { userErrors: { field: string[]; message: string }[] } }>(
    `mutation Save($mfs: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $mfs) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    { mfs: [{ ownerId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(events) }] }
  );
  const errs = data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map(e => e.message).join('; '));
}
