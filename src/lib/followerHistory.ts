// The dashboard's own follower history. Instagram's API serves daily
// follower counts for the last 30 days only and Windsor keeps a snapshot per
// day from the date the account was connected, so anything older is gone
// unless we keep it. Every Organic Content load records today's count per
// platform in the Settings KV; the growth chart merges that in wherever the
// feed has no point for a day.

import { getKV, setKV, isChatStoreConfigured } from '@/src/lib/chatStore';
import { getClientId } from '@/src/lib/client';
import type { Audience, AudiencePoint, OrganicPlatform } from '@/src/lib/organic';

type Store = Partial<Record<OrganicPlatform, Record<string, { followers: number; newFollowers?: number | null }>>>;
const key = () => `follower_history_${getClientId()}`;
let cache: { t: number; store: Store } | null = null;

export async function loadFollowerHistory(): Promise<Store> {
  if (!isChatStoreConfigured()) return {};
  if (cache && Date.now() - cache.t < 60_000) return cache.store;
  try {
    const raw = await getKV(key());
    const store = raw ? (JSON.parse(raw) as Store) : {};
    cache = { t: Date.now(), store };
    return store;
  } catch { return cache?.store ?? {}; }
}

/** Record the newest dated point of each platform (no-op when nothing new). */
export async function recordFollowerSnapshots(audience: Record<OrganicPlatform, Audience>): Promise<void> {
  if (!isChatStoreConfigured()) return;
  try {
    const store = await loadFollowerHistory();
    let changed = false;
    (Object.keys(audience) as OrganicPlatform[]).forEach(platform => {
      const a = audience[platform];
      if (a.status !== 'ok') return;
      const pts = a.series.filter(p => p.followers != null);
      const latest = pts[pts.length - 1];
      const date = latest?.date || (a.asOf ?? null) || null;
      const followers = latest?.followers ?? a.followers;
      if (!date || followers == null) return;
      const cur = store[platform] || {};
      if (cur[date]?.followers === followers) return;
      cur[date] = { followers, newFollowers: latest?.newFollowers ?? null };
      store[platform] = cur; changed = true;
    });
    if (changed) { await setKV(key(), JSON.stringify(store)); cache = { t: Date.now(), store }; }
  } catch { /* history is best-effort */ }
}

/** Fill days in [from, to] that the feed's series lacks with stored snapshots; day-over-day change derived. */
export function mergeFollowerHistory(platform: OrganicPlatform, series: AudiencePoint[], store: Store, from: string, to: string): AudiencePoint[] {
  const own = store[platform] || {};
  const byDate = new Map<string, AudiencePoint>(series.map(p => [p.date, p]));
  Object.entries(own).forEach(([date, v]) => {
    if (date < from || date > to) return;
    const existing = byDate.get(date);
    if (existing && existing.followers != null) return;
    byDate.set(date, { ...(existing || { date, newFollowers: null }), date, followers: v.followers, newFollowers: existing?.newFollowers ?? v.newFollowers ?? null });
  });
  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  let prev: number | null = null;
  for (const p of merged) {
    if (p.newFollowers == null && p.followers != null && prev != null) p.newFollowers = p.followers - prev;
    if (p.followers != null) prev = p.followers;
  }
  return merged;
}
