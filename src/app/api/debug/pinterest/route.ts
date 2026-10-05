import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured, runQuery, getDataset } from '@/src/lib/bigquery';
import { windsorParams, windsorPinterestOptions } from '@/src/lib/client';

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
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), range: { from, to: today } };

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
      // Where did the latest Windsor task write? Every table in the dataset
      // with "pinterest" in its name, with row count and last-modified time,
      // so a task that landed under another table name is obvious.
      out.pinterestTables = await runQuery(
        `SELECT table_id, row_count, TIMESTAMP_MILLIS(last_modified_time) AS last_modified
         FROM \`${ds}.__TABLES__\` WHERE LOWER(table_id) LIKE '%pinterest%' ORDER BY last_modified DESC`).catch(e => ({ error: String(e) }));
      // Row grain for the latest complete day: how many distinct ads / ad
      // groups / campaigns the rows cover, and the rows themselves — to see
      // whether the rebuilt task's upload is losing or splitting spend.
      const probeDay = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      out.probeDay = probeDay;
      out.grainByDay = await runQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) AS d, COUNT(*) AS row_count,
                COUNT(DISTINCT CAST(ad_id AS STRING)) AS ads, COUNT(DISTINCT CAST(ad_group_name AS STRING)) AS ad_groups,
                COUNT(DISTINCT CAST(campaign_name AS STRING)) AS campaigns, COUNT(DISTINCT CAST(account_id AS STRING)) AS accounts,
                SUM(CAST(spend AS FLOAT64)) AS spend, COUNTIF(CAST(spend AS FLOAT64) = 0) AS zero_spend_rows
         FROM \`${ds}.pinterest_ads\` WHERE DATE(date) BETWEEN @f AND @t GROUP BY d ORDER BY d`, { f: from, t: today }).catch(e => ({ error: String(e) }));
      out.probeRows = await runQuery(
        `SELECT CAST(ad_id AS STRING) AS ad_id, CAST(ad_group_name AS STRING) AS ad_group_name, CAST(campaign_name AS STRING) AS campaign_name,
                CAST(account_id AS STRING) AS account_id, CAST(spend AS FLOAT64) AS spend, CAST(clicks AS FLOAT64) AS clicks,
                CAST(impressions AS FLOAT64) AS impressions, CAST(total_checkout AS FLOAT64) AS total_checkout
         FROM \`${ds}.pinterest_ads\` WHERE DATE(date) = @d ORDER BY spend DESC LIMIT 60`, { d: probeDay }).catch(e => ({ error: String(e) }));
      // Rows from the rebuilt task carry no total_conversions_value (the new
      // field list dropped it) — split the window's rows by that marker.
      out.rowsByTask = await runQuery(
        `SELECT IF(total_conversions_value IS NULL, 'new_task_fields', 'old_task_fields') AS task_rows,
                COUNT(*) AS row_count, MIN(DATE(date)) AS first_day, MAX(DATE(date)) AS last_day,
                SUM(IFNULL(CAST(total_checkout AS FLOAT64), 0)) AS total_checkout
         FROM \`${ds}.pinterest_ads\` GROUP BY task_rows`).catch(e => ({ error: String(e) }));
    } catch (e) { out.bigqueryError = String(e instanceof Error ? e.message : e); }
  } else {
    out.bigquery = 'not configured';
  }

  // Windsor live, every conversion-ish field the connector will give us —
  // pulled twice: on Windsor's default window (30/30/1) and with the task's
  // `options` (the profile's conversion settings, as the dashboard now
  // sends on every call). Differing totals = the option is honoured.
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  const scoped = key ? windsorParams('pinterest', { date_from: from, date_to: today }) : null;
  if (scoped) delete scoped.options;
  if (scoped) {
    // Windsor's real Pinterest field list (from its own error message): checkouts
    // split by attribution type, each with a value, plus the totals.
    const fields = ['account_id', 'spend', 'total_checkout', 'total_checkout_value', 'checkout_revenue', 'roas_checkout',
      'total_click_checkout', 'total_click_checkout_value', 'total_engagement_checkout', 'total_engagement_checkout_value',
      'total_view_checkout', 'total_view_checkout_value', 'total_conversions', 'total_conversions_value'];
    const pull = async (extra: Record<string, string>) => {
      const qs = new URLSearchParams({ api_key: key, fields: fields.join(','), _renderer: 'json', ...scoped, ...extra });
      const res = await fetch(`https://connectors.windsor.ai/pinterest?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      const json = await res.json();
      if (json.error) return { error: json.error };
      const rows = (json.data || []) as Array<Record<string, unknown>>;
      const totals: Record<string, number> = {};
      for (const r of rows) for (const f of fields.slice(1)) totals[f] = (totals[f] || 0) + Number(r[f] || 0);
      return { rows: rows.length, totals, sample: rows.slice(0, 1) };
    };
    const options = windsorPinterestOptions();
    // Same day as the table probe, per ad, with the task's option — the
    // exact shape the BigQuery task uploads. If this sums to Ads Manager's
    // spend while the table's rows for the day don't, the loss is in the task.
    try {
      const probeDay = String(out.probeDay || today);
      const qs = new URLSearchParams({ api_key: key, fields: 'date,account_id,ad_id,ad_group_name,campaign_name,spend,clicks,impressions,total_checkout', _renderer: 'json', ...scoped, date_from: probeDay, date_to: probeDay });
      if (options) qs.set('options', options);
      const res = await fetch(`https://connectors.windsor.ai/pinterest?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      const json = await res.json();
      const rows = (json.data || []) as Array<Record<string, unknown>>;
      out.windsorLiveProbeDay = json.error ? { error: json.error } : {
        day: probeDay, rows: rows.length,
        spend: rows.reduce((s, r) => s + Number(r.spend || 0), 0),
        clicks: rows.reduce((s, r) => s + Number(r.clicks || 0), 0),
        total_checkout: rows.reduce((s, r) => s + Number(r.total_checkout || 0), 0),
        distinctAds: new Set(rows.map(r => String(r.ad_id))).size,
        sample: rows.slice(0, 5),
      };
    } catch (e) { out.windsorProbeError = String(e instanceof Error ? e.message : e); }
    // Which grain keeps the full spend? Same probe day: per ad without the
    // option, per campaign with it, per ad group with it, account-level with it.
    const grainPull = async (fields: string, withOptions: boolean) => {
      const probeDay = String(out.probeDay || today);
      const qs = new URLSearchParams({ api_key: key, fields, _renderer: 'json', ...scoped, date_from: probeDay, date_to: probeDay });
      if (withOptions && options) qs.set('options', options);
      const res = await fetch(`https://connectors.windsor.ai/pinterest?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      const json = await res.json();
      if (json.error) return { error: json.error };
      const rows = (json.data || []) as Array<Record<string, unknown>>;
      return { rows: rows.length, spend: Math.round(rows.reduce((s, r) => s + Number(r.spend || 0), 0) * 100) / 100, total_checkout: rows.reduce((s, r) => s + Number(r.total_checkout || 0), 0), sample: rows.slice(0, 2) };
    };
    try {
      out.grainProbes = {
        perAd_noOptions: await grainPull('date,account_id,ad_id,ad_group_name,campaign_name,spend,clicks,impressions,total_checkout', false),
        perAdGroup_withOptions: await grainPull('date,account_id,ad_group_name,campaign_name,spend,clicks,impressions,total_checkout,total_checkout_value', true),
        perCampaign_withOptions: await grainPull('date,account_id,campaign_name,spend,clicks,impressions,total_checkout,total_checkout_value', true),
        account_withOptions: await grainPull('date,account_id,spend,clicks,impressions,total_checkout,total_checkout_value', true),
      };
    } catch (e) { out.grainProbesError = String(e instanceof Error ? e.message : e); }
    try { out.windsorLiveDefault = await pull({}); } catch (e) { out.windsorError = String(e instanceof Error ? e.message : e); }
    if (options) {
      try { out.windsorLiveTaskOptions = await pull({ options }); } catch (e) { out.windsorOptionsError = String(e instanceof Error ? e.message : e); }
      out.windsorOptions = options;
    }
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
