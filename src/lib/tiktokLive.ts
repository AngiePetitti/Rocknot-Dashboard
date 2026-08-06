// Per-day TikTok spend/revenue straight from Windsor's live connector API.
// The BigQuery tiktok_ads table only updates on Windsor's daily sync, so the
// most recent days understate spend badly (TikTok has no direct API hookup
// here yet — Windsor's connector endpoint is the freshest source we have).
export interface TiktokDay { date: string; spend: number; revenue: number }

export async function fetchTiktokDaily(since: string, until: string): Promise<TiktokDay[] | null> {
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  if (!key) return null;
  try {
    const qs = new URLSearchParams({
      api_key: key,
      date_from: since,
      date_to: until,
      fields: 'date,spend,total_complete_payment_rate,complete_payment_value',
      _renderer: 'json',
    });
    const res = await fetch(`https://connectors.windsor.ai/tiktok?${qs}`, { cache: 'no-store' });
    const json = await res.json();
    if (json.error || !Array.isArray(json.data)) return null;
    const byDate = new Map<string, TiktokDay>();
    for (const row of json.data as Array<Record<string, unknown>>) {
      const date = String(row.date || '');
      if (!date) continue;
      const d = byDate.get(date) || { date, spend: 0, revenue: 0 };
      d.spend += Number(row.spend || 0);
      d.revenue += Number(row.total_complete_payment_rate || row.complete_payment_value || 0);
      byDate.set(date, d);
    }
    return Array.from(byDate.values());
  } catch {
    return null;
  }
}
