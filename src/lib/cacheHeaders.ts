// Data only changes when Windsor syncs (hourly), so let the CDN cache
// successful API responses briefly — repeat timeframe selections become
// instant instead of re-running BigQuery/Windsor each time. Intraday
// ("today") gets a shorter TTL. Error responses should NOT use this.
export function cacheHeaders(isToday = false, settled = false): HeadersInit {
  if (isToday) return { 'Cache-Control': 'no-store' };
  // Settled historical ranges can't change (Windsor only appends new days)
  // — cache them for hours. BigQuery charges per byte scanned, so every CDN
  // hit here is a query (and money) not spent.
  if (settled) return { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' };
  return { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' };
}

/**
 * True when a range ending on dateTo is safe for the long cache tier.
 * A range ending YESTERDAY is not: Windsor backfills yesterday's Shopify
 * rows over the course of today, so a response cached in the morning shows
 * a partial day for 6 hours (Nov 15, 2026: the Overview's "Yesterday"
 * showed $10K against a real $26K). Only ranges ending 2+ days ago settle.
 */
export function settledEnd(dateTo: string | undefined | null): boolean {
  if (!dateTo) return false;
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [y, m, d] = today.split('-').map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d));
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterday = yest.toISOString().slice(0, 10);
  return dateTo < yesterday;
}
