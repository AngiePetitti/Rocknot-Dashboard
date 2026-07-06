// Persistence for the Marketing Calendar — a small key-value store (Redis).
// Works with either a Vercel-connected Redis/KV store or an Upstash Redis
// database, by reading whichever REST credentials are present. No SDK needed:
// both speak the Upstash REST protocol, so we call it directly.
//
// To connect one (once): Vercel project → Storage → Create/Connect a Redis
// (Upstash) database → it injects the env vars below → redeploy.

const REST_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
const REST_TOKEN = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

const STORAGE_KEY = 'marketing_calendar_events';

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

export function isStorageConfigured(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

// Run a single Redis command via the Upstash-compatible REST API.
async function redis(command: (string)[]): Promise<unknown> {
  if (!isStorageConfigured()) {
    throw new Error('Calendar storage is not connected yet — add a Redis (Upstash) database to the project in Vercel → Storage.');
  }
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

export async function getEvents(): Promise<MarketingEvent[]> {
  const value = await redis(['GET', STORAGE_KEY]);
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as MarketingEvent[] : [];
  } catch {
    return [];
  }
}

export async function saveEvents(events: MarketingEvent[]): Promise<void> {
  await redis(['SET', STORAGE_KEY, JSON.stringify(events)]);
}
