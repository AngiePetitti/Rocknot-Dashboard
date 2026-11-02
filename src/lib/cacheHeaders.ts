// Data only changes when Windsor syncs (hourly), so let the CDN cache
// successful API responses briefly — repeat timeframe selections become
// instant instead of re-running BigQuery/Windsor each time. Intraday
// ("today") gets a shorter TTL. Error responses should NOT use this.
export function cacheHeaders(isToday = false, endsBeforeToday = false): HeadersInit {
  if (isToday) return { 'Cache-Control': 'no-store' };
  // Completed historical ranges can't change (Windsor only appends new days)
  // — cache them for hours. BigQuery charges per byte scanned, so every CDN
  // hit here is a query (and money) not spent.
  if (endsBeforeToday) return { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' };
  return { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' };
}
