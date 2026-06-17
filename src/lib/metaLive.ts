// Today's Meta numbers straight from the Graph API — the same source Ads
// Manager reads — bypassing Windsor's refresh lag for the live view.

export interface MetaToday {
  spend: number;
  revenue: number;
  purchases: number;
  clicks: number;
}

export async function fetchMetaToday(): Promise<MetaToday | null> {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const accountId = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');
  if (!token || !accountId) return null;

  try {
    // level=account forces a single aggregated row for the whole account.
    const fields = 'spend,clicks,actions,action_values';
    const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&date_preset=today&level=account&access_token=${token}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json.error || !json.data?.length) return null;

    // Sum all rows in case the API returns more than one (e.g. paged results)
    const pick = (arr: Array<{ action_type: string; value: string }> | undefined) =>
      arr?.find(a => a.action_type === 'omni_purchase')?.value ??
      arr?.find(a => a.action_type === 'purchase')?.value;

    let spend = 0, revenue = 0, purchases = 0, clicks = 0;
    for (const d of json.data) {
      spend += parseFloat(d.spend || '0');
      revenue += parseFloat(pick(d.action_values) || '0');
      purchases += parseInt(pick(d.actions) || '0', 10);
      clicks += parseInt(d.clicks || '0', 10);
    }

    return { spend, revenue, purchases, clicks };
  } catch {
    return null;
  }
}
