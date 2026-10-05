import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';
import { windsorParams } from '@/src/lib/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin-only Pinterest audit (/api/debug/pinterest?days=7): what the
// dashboard sums from BigQuery for the last N days, every candidate
// conversion / value column side by side, per account and per day, plus
// Windsor's live feed for the same window with every conversion field it
// offers — so the one that matches Ads Manager's "Total conversions /
// order value (Checkout)" can be identified instead of guessed.
export async function GET(request: NextRequest) {
  const days = Math.max(1, Math.min(60, Number(request.nextUrl.searchParams.get('days') || 7)));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const out: Record<string, unknown> = { range: { from, to: today } };

  if (isBigQueryConfigured()) {
    const ds = getDataset();
    try {
      const cols = await runQuery<{ column_name: string }>(
        `SELECT column_name FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'pinterest_ads' ORDER BY ordinal_position`);
      const names = cols.map(c => c.column_name);
      out.columns = names;
      const numeric = names.filter(n => /checkout|conversion|purchase|value|roas|spend|clicks|impressions/i.test(n) && !/date|id|name/i.test(n));
      const sums = numeric.map(n => `SUM(SAFE_CAST(\`${n}\` AS FLOAT64)) AS \`${n}\``).join(', ');
      const acct = names.includes('account_id') ? 'CAST(account_id AS STRING)' : names.includes('advertiser_id') ? 'CAST(advertiser_id AS STRING)' : "'(no account column)'";
      out.byAccount = await runQuery(
        `SELECT ${acct} AS account, COUNT(*) AS row_count, ${sums}
         FROM \`${ds}.pinterest_ads\` WHERE DATE(date) BETWEEN @f AND @t GROUP BY account`, { f: from, t: today });
      out.byDay = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS d, COUNT(*) AS row_count, ${sums}
         FROM \`${ds}.pinterest_ads\` WHERE DATE(date) BETWEEN @f AND @t GROUP BY d ORDER BY d`, { f: from, t: today });
      out.latestDay = await runQuery(`SELECT FORMAT_DATE('%Y-%m-%d', MAX(DATE(date))) AS latest FROM \`${ds}.pinterest_ads\``);
    } catch (e) { out.bigqueryError = String(e instanceof Error ? e.message : e); }
  } else {
    out.bigquery = 'not configured';
  }

  // Windsor live, every conversion-ish field the connector will give us.
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  const scoped = key ? windsorParams('pinterest', { date_from: from, date_to: today }) : null;
  if (scoped) {
    const fields = ['account_id', 'spend', 'total_checkout', 'total_checkout_value', 'checkout', 'checkout_value', 'total_conversions', 'total_conversions_value',
      'conversions', 'conversion_value', 'checkout_roas', 'total_checkout_roas', 'web_checkout', 'web_checkout_value'];
    try {
      const qs = new URLSearchParams({ api_key: key, fields: fields.join(','), _renderer: 'json', ...scoped });
      const res = await fetch(`https://connectors.windsor.ai/pinterest?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (json.error) {
        out.windsorError = json.error;
      } else {
        const rows = (json.data || []) as Array<Record<string, unknown>>;
        const totals: Record<string, number> = {};
        for (const r of rows) for (const f of fields.slice(1)) totals[f] = (totals[f] || 0) + Number(r[f] || 0);
        out.windsorLive = { rows: rows.length, totals, sample: rows.slice(0, 2) };
      }
    } catch (e) { out.windsorError = String(e instanceof Error ? e.message : e); }
  }
  return NextResponse.json(out);
}
