import { NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';

export const dynamic = 'force-dynamic';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;

// One-off probe to identify how each client's account is labelled in the
// facebook_ads BigQuery table and in the Windsor REST feed, so ad queries can
// be scoped to Rocknot only.
export async function GET() {
  const out: Record<string, unknown> = {};

  // --- BigQuery: list columns + distinct account values with spend ---
  if (isBigQueryConfigured()) {
    const ds = getDataset();
    out.bqColumns = await runQuery(`
      SELECT column_name, data_type
      FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'facebook_ads'
      ORDER BY ordinal_position
    `).catch(e => ({ error: String(e) }));

    // Try the likely account-identifying columns; whichever exists will return.
    for (const col of ['account_id', 'account_name', 'account']) {
      out[`bqDistinct_${col}`] = await runQuery(`
        SELECT ${col} AS account, COUNT(*) AS rows, ROUND(SUM(CAST(spend AS FLOAT64)),2) AS spend
        FROM \`${ds}.facebook_ads\`
        GROUP BY account ORDER BY spend DESC
      `).catch(e => ({ error: String(e) }));
    }
  } else {
    out.bq = 'not configured';
  }

  // --- Windsor REST: what accounts does the facebook feed return? ---
  if (WINDSOR_API_KEY) {
    try {
      const qs = new URLSearchParams({
        api_key: WINDSOR_API_KEY,
        fields: 'account_id,account_name,source,spend',
        _renderer: 'json',
        date_preset: 'last_30d',
      });
      const res = await fetch(`https://connectors.windsor.ai/facebook?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      const rows = (json.data || []) as Array<Record<string, unknown>>;
      const byAccount: Record<string, { rows: number; spend: number; name: string }> = {};
      for (const r of rows) {
        const id = String(r.account_id ?? '');
        if (!byAccount[id]) byAccount[id] = { rows: 0, spend: 0, name: String(r.account_name ?? '') };
        byAccount[id].rows += 1;
        byAccount[id].spend += Number(r.spend || 0);
      }
      out.windsorAccounts = byAccount;
      out.windsorError = json.error ?? null;
    } catch (e) {
      out.windsorError = String(e);
    }
  }

  return NextResponse.json(out);
}
