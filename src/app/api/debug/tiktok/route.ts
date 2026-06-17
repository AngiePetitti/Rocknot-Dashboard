import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

// Probe Windsor's live TikTok feed to find which field actually carries the
// purchase value / ROAS that TikTok Ads Manager reports. Each candidate is
// requested on its own so one invalid field name can't fail the whole call.
const CANDIDATES = [
  'complete_payment_value',
  'total_complete_payment_value',
  'complete_payment_roas',
  'total_complete_payment_rate',
  'onsite_purchases_roas',
  'onsite_shopping_roas',
  'total_purchase_value',
  'purchase_value',
  'value_per_complete_payment',
  'conversion_value',
  'total_conversion_value',
  'result_value',
  'onsite_total_purchase_value',
  'total_onsite_shopping_value',
  'roas',
];

export async function GET() {
  if (!WINDSOR_API_KEY) return NextResponse.json({ error: 'no windsor key' });

  const base = {
    api_key: WINDSOR_API_KEY,
    _renderer: 'json',
    date_preset: 'last_30d',
    select_accounts: '7331079299845357570',
  };

  const results: Record<string, unknown> = {};
  for (const field of CANDIDATES) {
    try {
      const qs = new URLSearchParams({ ...base, fields: `campaign,spend,complete_payment,${field}` });
      const res = await fetch(`https://connectors.windsor.ai/tiktok?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.error) {
        results[field] = { error: String(json.error).slice(0, 120) };
        continue;
      }
      const rows = (json.data || []) as Array<Record<string, unknown>>;
      // Sum the candidate field and grab the first non-empty value seen.
      let sum = 0;
      let firstVal: unknown = null;
      for (const r of rows) {
        const v = r[field];
        if (v !== null && v !== undefined && v !== '' && firstVal === null) firstVal = v;
        const n = Number(v);
        if (!Number.isNaN(n)) sum += n;
      }
      results[field] = { rows: rows.length, sum: Math.round(sum * 100) / 100, firstVal };
    } catch (e) {
      results[field] = { error: String(e).slice(0, 120) };
    }
  }

  return NextResponse.json({ source: 'windsor_tiktok_live', dateRange: 'last_30d', results });
}
