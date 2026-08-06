import { runQuery, getDataset } from '@/src/lib/bigquery';

// Ad Performance tab data from the Windsor→BigQuery tables.
// Mirrors the shape returned by /api/windsor/ads so the frontend is unchanged.

export interface PlatformData {
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  costPerConversion: number;
  color: string;
}

export interface DaySpend {
  date: string;
  meta: number;
  google: number;
  tiktok: number;
  snapchat: number;
}

interface RawRow {
  spend: number | null;
  revenue: number | null;
  conversions: number | null;
  clicks: number | null;
  impressions: number | null;
}

interface DailySpendRow {
  d: { value: string } | string;
  spend: number | null;
}

function dateVal(d: DailySpendRow['d']): string {
  return typeof d === 'string' ? d : d.value;
}

function buildPlatform(
  name: string,
  color: string,
  row: RawRow | null,
): PlatformData | null {
  const spend = Number(row?.spend || 0);
  if (spend <= 0) return null;
  const revenue = Number(row?.revenue || 0);
  const conversions = Number(row?.conversions || 0);
  const clicks = Number(row?.clicks || 0);
  const impressions = Number(row?.impressions || 0);
  return {
    platform: name,
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    conversions: Math.round(conversions),
    costPerConversion: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
    color,
  };
}

// Each platform is queried independently so a missing column in one table
// never crashes another platform's data. New Windsor columns (e.g. impressions
// added to facebook_ads) are picked up automatically once they exist.
export async function getAdsOverview(dateFrom: string, dateTo: string): Promise<{ platforms: PlatformData[]; dailySpend: DaySpend[] }> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  const metaSql = `
    -- Windsor stores one row per adset (only the campaign name is exposed), so
    -- a campaign's adsets appear as multiple rows with independent spend — SUM
    -- them to get the true total. Do NOT dedup.
    SELECT
      SUM(CAST(spend AS FLOAT64)) AS spend,
      SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue,
      SUM(IFNULL(CAST(actions_omni_purchase AS FLOAT64), 0)) AS conversions,
      SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
      0 AS impressions
    FROM \`${ds}.facebook_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
      AND LOWER(account_name) = 'rocknot'
  `;

  const googleSql = `
    SELECT
      SUM(CAST(spend AS FLOAT64)) AS spend,
      SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)) AS revenue,
      SUM(IFNULL(CAST(conversions AS FLOAT64), 0)) AS conversions,
      SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
      0 AS impressions
    FROM \`${ds}.google_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;

  const tiktokSql = `
    SELECT
      SUM(CAST(spend AS FLOAT64)) AS spend,
      SUM(IFNULL(CAST(total_complete_payment_rate AS FLOAT64), 0)) AS revenue,
      SUM(IFNULL(CAST(complete_payment AS FLOAT64), 0)) AS conversions,
      SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
      SUM(IFNULL(CAST(impressions AS FLOAT64), 0)) AS impressions
    FROM \`${ds}.tiktok_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;

  const tiktokSqlLegacy = tiktokSql.replace(
    'SUM(IFNULL(CAST(total_complete_payment_rate AS FLOAT64), 0)) AS revenue',
    'SUM(IFNULL(CAST(complete_payment_value AS FLOAT64), 0)) AS revenue'
  );

  const tiktokSqlFallback = `
    SELECT
      SUM(CAST(spend AS FLOAT64)) AS spend,
      SUM(IFNULL(CAST(onsite_total_purchase_value AS FLOAT64), 0)) AS revenue,
      SUM(IFNULL(CAST(onsite_total_purchase AS FLOAT64), 0)) AS conversions,
      SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
      SUM(IFNULL(CAST(impressions AS FLOAT64), 0)) AS impressions
    FROM \`${ds}.tiktok_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;

  const metaDailySql = `
    SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
    FROM \`${ds}.facebook_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
      AND LOWER(account_name) = 'rocknot'
    GROUP BY d
  `;

  const googleDailySql = `
    SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
    FROM \`${ds}.google_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
  `;

  const tiktokDailySql = `
    SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
    FROM \`${ds}.tiktok_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
  `;

  // Snapchat (Windsor → snapchat_ads). Guarded like the others — before the
  // table exists these queries just fail quietly and Snapchat doesn't appear.
  const snapSql = `
    SELECT SUM(CAST(spend AS FLOAT64)) AS spend,
           SUM(IFNULL(CAST(conversion_purchases_value AS FLOAT64), 0)) AS revenue,
           SUM(IFNULL(CAST(conversion_purchases AS FLOAT64), 0)) AS conversions,
           SUM(IFNULL(COALESCE(CAST(clicks AS FLOAT64), CAST(swipes AS FLOAT64)), 0)) AS clicks,
           SUM(IFNULL(CAST(impressions AS FLOAT64), 0)) AS impressions
    FROM \`${ds}.snapchat_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;
  const snapDailySql = `
    SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
    FROM \`${ds}.snapchat_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
  `;

  // Safe fallbacks using only columns confirmed to exist in BigQuery
  // Minimal fallbacks — spend + revenue only — in case Windsor changes the schema
  const metaSqlMin = `
    SELECT SUM(CAST(spend AS FLOAT64)) AS spend,
           SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue,
           0 AS conversions, 0 AS clicks, 0 AS impressions
    FROM \`${ds}.facebook_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
      AND LOWER(account_name) = 'rocknot'
  `;
  const googleSqlMin = `
    SELECT SUM(CAST(spend AS FLOAT64)) AS spend,
           SUM(IFNULL(CAST(conversion_value AS FLOAT64), 0)) AS revenue,
           0 AS conversions, 0 AS clicks, 0 AS impressions
    FROM \`${ds}.google_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;

  const [metaRows, googleRows, tiktokRows, snapRows, metaDaily, googleDaily, tiktokDaily, snapDaily] = await Promise.all([
    runQuery<RawRow>(metaSql, params)
      .catch(() => runQuery<RawRow>(metaSqlMin, params))
      .catch(() => null),
    runQuery<RawRow>(googleSql, params)
      .catch(() => runQuery<RawRow>(googleSqlMin, params))
      .catch(() => null),
    runQuery<RawRow>(tiktokSql, params)
      .catch(() => runQuery<RawRow>(tiktokSqlLegacy, params))
      .catch(() => runQuery<RawRow>(tiktokSqlFallback, params))
      .catch(() => null),
    runQuery<RawRow>(snapSql, params).catch(() => null),
    runQuery<DailySpendRow>(metaDailySql, params).catch(() => [] as DailySpendRow[]),
    runQuery<DailySpendRow>(googleDailySql, params).catch(() => [] as DailySpendRow[]),
    runQuery<DailySpendRow>(tiktokDailySql, params).catch(() => [] as DailySpendRow[]),
    runQuery<DailySpendRow>(snapDailySql, params).catch(() => [] as DailySpendRow[]),
  ]);

  const platforms: PlatformData[] = [];
  const metaPlatform = buildPlatform('Meta', '#818cf8', metaRows?.[0] ?? null);
  const googlePlatform = buildPlatform('Google', '#34d399', googleRows?.[0] ?? null);
  const tiktokPlatform = buildPlatform('TikTok', '#f472b6', tiktokRows?.[0] ?? null);
  const snapPlatform = buildPlatform('Snapchat', '#facc15', snapRows?.[0] ?? null);
  if (metaPlatform) platforms.push(metaPlatform);
  if (googlePlatform) platforms.push(googlePlatform);
  if (tiktokPlatform) platforms.push(tiktokPlatform);
  if (snapPlatform) platforms.push(snapPlatform);

  // Merge the daily series into one array spanning the full date range
  const byDate: Record<string, { meta: number; google: number; tiktok: number; snapchat: number }> = {};
  const ensureDate = (d: string) => { if (!byDate[d]) byDate[d] = { meta: 0, google: 0, tiktok: 0, snapchat: 0 }; };

  for (const r of metaDaily) { const d = dateVal(r.d); ensureDate(d); byDate[d].meta = Math.round(Number(r.spend || 0)); }
  for (const r of googleDaily) { const d = dateVal(r.d); ensureDate(d); byDate[d].google = Math.round(Number(r.spend || 0)); }
  for (const r of tiktokDaily) { const d = dateVal(r.d); ensureDate(d); byDate[d].tiktok = Math.round(Number(r.spend || 0)); }
  for (const r of snapDaily) { const d = dateVal(r.d); ensureDate(d); byDate[d].snapchat = Math.round(Number(r.spend || 0)); }

  // Patch the most recent 1-2 days from the platforms' own APIs — Windsor's
  // once-a-day sync captures those days part-way through, understating spend
  // until the next sync overwrites them.
  const todayPst = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  // ~35-day patch window so MTD stays right anywhere in the month — BigQuery
  // only updates on Windsor's daily sync and understates recent days badly.
  const patchWindowStart = new Date(new Date(todayPst).getTime() - 35 * 86400000).toISOString().slice(0, 10);
  const patchFrom = dateFrom > patchWindowStart ? dateFrom : patchWindowStart;
  if (dateTo >= patchFrom) {
    const { fetchMetaDaily } = await import('@/src/lib/metaLive');
    const { fetchSnapDaily } = await import('@/src/lib/snapLive');
    const { fetchTiktokDaily, fetchSnapDailyFromWindsor } = await import('@/src/lib/tiktokLive');
    const [metaPatch, snapPatch, tiktokPatch] = await Promise.all([
      fetchMetaDaily(patchFrom, dateTo).catch(() => null),
      fetchSnapDaily(patchFrom, dateTo).then(r => r ?? fetchSnapDailyFromWindsor(patchFrom, dateTo)).catch(() => null),
      fetchTiktokDaily(patchFrom, dateTo).catch(() => null),
    ]);
    for (const day of tiktokPatch ?? []) {
      const b = byDate[day.date];
      if (b && day.spend > b.tiktok) {
        const delta = day.spend - b.tiktok;
        b.tiktok = Math.round(day.spend);
        if (tiktokPlatform) {
          tiktokPlatform.spend = Math.round((tiktokPlatform.spend + delta) * 100) / 100;
          if (day.revenue > 0) tiktokPlatform.revenue = Math.round(tiktokPlatform.revenue);
          tiktokPlatform.roas = tiktokPlatform.spend > 0 ? Math.round((tiktokPlatform.revenue / tiktokPlatform.spend) * 100) / 100 : 0;
        }
      }
    }
    for (const day of metaPatch ?? []) {
      const b = byDate[day.date];
      if (b && day.spend > b.meta) {
        const delta = day.spend - b.meta;
        b.meta = Math.round(day.spend);
        if (metaPlatform) {
          metaPlatform.spend = Math.round((metaPlatform.spend + delta) * 100) / 100;
          metaPlatform.roas = metaPlatform.spend > 0 ? Math.round((metaPlatform.revenue / metaPlatform.spend) * 100) / 100 : 0;
        }
      }
    }
    for (const day of snapPatch ?? []) {
      const b = byDate[day.date];
      if (b && day.spend > b.snapchat) {
        const delta = day.spend - b.snapchat;
        b.snapchat = Math.round(day.spend);
        if (snapPlatform) {
          snapPlatform.spend = Math.round((snapPlatform.spend + delta) * 100) / 100;
          snapPlatform.roas = snapPlatform.spend > 0 ? Math.round((snapPlatform.revenue / snapPlatform.spend) * 100) / 100 : 0;
        }
      }
    }
  }

  const dailySpend: DaySpend[] = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  return { platforms, dailySpend };
}
