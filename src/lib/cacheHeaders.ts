// Data only changes when Windsor syncs (hourly), so let the CDN cache
// successful API responses briefly — repeat timeframe selections become
// instant instead of re-running BigQuery/Windsor each time. Intraday
// ("today") gets a shorter TTL. Error responses should NOT use this.
export function cacheHeaders(isToday = false): HeadersInit {
  const maxAge = isToday ? 60 : 300;
  return { 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=3600` };
}
