// Session-scoped client cache for dashboard API responses so switching tabs
// (or timeframes you've already loaded, like YTD) shows data instantly and
// then refreshes quietly in the background (stale-while-revalidate).
//
// cachedJson(url, apply):
//   1. If a cached copy exists for this URL and is younger than MAX_AGE_MS,
//      apply(cached, true) runs synchronously — the tab renders immediately.
//      Older copies are NOT shown (users read the stale numbers as wrong when
//      the fresh ones swap in) — the caller's loading state shows instead.
//   2. The network fetch always runs; on success the cache updates and
//      apply(fresh, false) runs.
// Returns true if a cached copy was applied (caller can skip its spinner).

const memory = new Map<string, { t: number; data: unknown }>();
const PREFIX = 'rkcache:';
const MAX_AGE_MS = 5 * 60 * 1000;

interface Entry { t: number; data: unknown }

function readSession(key: string): Entry | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    // Legacy entries were the bare payload with no timestamp — treat as expired.
    if (parsed && typeof parsed === 'object' && typeof parsed.t === 'number' && 'data' in parsed) return parsed as Entry;
    return undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, entry: Entry): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Session storage full — drop our cache entries and retry once.
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch { /* give up quietly */ }
  }
}

export function cachedJson<T>(
  url: string,
  apply: (data: T, fromCache: boolean) => void,
  onError?: () => void
): boolean {
  const entry = memory.get(url) ?? readSession(url);
  const fresh = entry !== undefined && Date.now() - entry.t < MAX_AGE_MS;
  if (fresh) apply(entry!.data as T, true);

  fetch(url, { cache: 'no-store' })
    .then(r => r.json())
    .then((data: T) => {
      const e = { t: Date.now(), data };
      memory.set(url, e);
      writeSession(url, e);
      apply(data, false);
    })
    .catch(() => { if (!fresh) onError?.(); });

  return fresh;
}
