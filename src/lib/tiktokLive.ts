// Per-day spend/revenue straight from Windsor's live connector API for
// platforms without (or awaiting) a direct API hookup. The BigQuery tables
// only update on Windsor's daily sync, so the most recent days understate
// spend badly — the connector endpoint is fresher.
export interface PlatformDay { date: string; spend: number; revenue: number }

async function fetchWindsorDaily(
  source: 'tiktok' | 'snapchat',
  revenueFields: string[],
  since: string,
  until: string
): Promise<PlatformDay[] | null> {
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  if (!key) return null;
  try {
    const qs = new URLSearchParams({
      api_key: key,
      date_from: since,
      date_to: until,
      fields: ['date', 'spend', ...revenueFields].join(','),
      _renderer: 'json',
    });
    // Hard timeout: this runs inside the main metrics request — a slow Windsor
    // response must degrade to "no patch", never hang the whole dashboard.
    const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return null;
    const byDate = new Map<string, PlatformDay>();
    for (const row of json.data as Array<Record<string, unknown>>) {
      const date = String(row.date || '');
      if (!date) continue;
      const d = byDate.get(date) || { date, spend: 0, revenue: 0 };
      d.spend += Number(row.spend || 0);
      d.revenue += revenueFields.reduce((s, f) => s || Number(row[f] || 0), 0);
      byDate.set(date, d);
    }
    return Array.from(byDate.values());
  } catch {
    return null;
  }
}

export function fetchTiktokDaily(since: string, until: string): Promise<PlatformDay[] | null> {
  return fetchWindsorDaily('tiktok', ['total_complete_payment_rate', 'complete_payment_value'], since, until);
}

// Fallback for Snapchat when the direct Snap Marketing API creds aren't set.
export function fetchSnapDailyFromWindsor(since: string, until: string): Promise<PlatformDay[] | null> {
  return fetchWindsorDaily('snapchat', ['conversion_purchases_value'], since, until);
}
