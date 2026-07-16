// Session-scoped client cache for dashboard API responses so switching tabs
// (or timeframes you've already loaded, like YTD) shows data instantly and
// then refreshes quietly in the background (stale-while-revalidate).
//
// cachedJson(url, apply):
//   1. If a cached copy exists for this URL, apply(cached, true) runs
//      synchronously — the tab renders immediately.
//   2. The network fetch always runs; on success the cache updates and
//      apply(fresh, false) runs.
// Returns true if a cached copy was applied (caller can skip its spinner).

const memory = new Map<string, unknown>();
const PREFIX = 'rkcache:';

function readSession(key: string): unknown | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, data: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    // Session storage full — drop our cache entries and retry once.
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(PREFIX + key, JSON.stringify(data));
    } catch { /* give up quietly */ }
  }
}

export function cachedJson<T>(
  url: string,
  apply: (data: T, fromCache: boolean) => void,
  onError?: () => void
): boolean {
  const cached = (memory.has(url) ? memory.get(url) : readSession(url)) as T | undefined;
  if (cached !== undefined) apply(cached, true);

  fetch(url, { cache: 'no-store' })
    .then(r => r.json())
    .then((data: T) => {
      memory.set(url, data);
      writeSession(url, data);
      apply(data, false);
    })
    .catch(() => { if (cached === undefined) onError?.(); });

  return cached !== undefined;
}
