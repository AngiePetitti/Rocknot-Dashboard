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
}

interface TotalsRow {
  platform: string;
  spend: number | null;
  revenue: number | null;
  conversions: number | null;
  clicks: number | null;
  impressions: number | null;
}

interface DailyRow {
  date: { value: string } | string;
  meta: number | null;
  google: number | null;
  tiktok: number | null;
}

function dateStr(d: DailyRow['date']): string {
  return typeof d === 'string' ? d : d.value;
}

// Conversions per platform: Meta = omni purchases, Google = conversions,
// TikTok = onsite purchases — the same counts each ads manager reports.
export async function getAdsOverview(dateFrom: string, dateTo: string): Promise<{ platforms: PlatformData[]; dailySpend: DaySpend[] }> {
  const ds = getDataset();

  const totalsSql = `
    SELECT 'Meta' AS platform,
           SUM(CAST(spend AS FLOAT64)) AS spend,
           SUM(IFNULL(CAST(action_values_omni_purchase AS FLOAT64), 0)) AS revenue,
           SUM(IFNULL(CAST(actions_omni_purchase AS FLOAT64), 0)) AS conversions,
           SUM(IFNULL(CAST(clicks AS FLOAT64), 0)) AS clicks,
           SUM(IFNULL(CAST(impressions AS FLOAT64), 0)) AS impressions
    FROM \`${ds}.facebook_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
    UNION ALL
    SELECT 'Google',
           SUM(CAST(spend AS FLOAT64)),
           SUM(COALESCE(CAST(conversions_value AS FLOAT64), CAST(conversion_value AS FLOAT64), 0)),
           SUM(IFNULL(CAST(conversions AS FLOAT64), 0)),
           SUM(IFNULL(CAST(clicks AS FLOAT64), 0)),
           SUM(IFNULL(CAST(impressions AS FLOAT64), 0))
    FROM \`${ds}.google_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
    UNION ALL
    SELECT 'TikTok',
           SUM(CAST(spend AS FLOAT64)),
           SUM(IFNULL(CAST(onsite_total_purchase_value AS FLOAT64), 0)),
           SUM(IFNULL(CAST(onsite_total_purchase AS FLOAT64), 0)),
           SUM(IFNULL(CAST(clicks AS FLOAT64), 0)),
           0
    FROM \`${ds}.tiktok_ads\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
  `;

  const dailySql = `
    WITH meta AS (
      SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
      FROM \`${ds}.facebook_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
    ),
    google AS (
      SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
      FROM \`${ds}.google_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
    ),
    tiktok AS (
      SELECT DATE(date) AS d, SUM(CAST(spend AS FLOAT64)) AS spend
      FROM \`${ds}.tiktok_ads\`
      WHERE DATE(date) BETWEEN @date_from AND @date_to GROUP BY d
    ),
    days AS (SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(@date_from, @date_to)) AS d)
    SELECT FORMAT_DATE('%Y-%m-%d', days.d) AS date,
           IFNULL(meta.spend, 0)   AS meta,
           IFNULL(google.spend, 0) AS google,
           IFNULL(tiktok.spend, 0) AS tiktok
    FROM days
    LEFT JOIN meta   ON meta.d = days.d
    LEFT JOIN google ON google.d = days.d
    LEFT JOIN tiktok ON tiktok.d = days.d
    ORDER BY days.d
  `;

  const params = { date_from: dateFrom, date_to: dateTo };
  const [totals, daily] = await Promise.all([
    runQuery<TotalsRow>(totalsSql, params),
    runQuery<DailyRow>(dailySql, params),
  ]);

  const colors: Record<string, string> = { Meta: '#818cf8', Google: '#34d399', TikTok: '#f472b6' };
  const platforms: PlatformData[] = [];

  for (const name of ['Meta', 'Google', 'TikTok']) {
    const r = totals.find(t => t.platform === name);
    const spend = Number(r?.spend || 0);
    if (spend <= 0) continue;
    const revenue = Number(r?.revenue || 0);
    const conversions = Number(r?.conversions || 0);
    const clicks = Number(r?.clicks || 0);
    const impressions = Number(r?.impressions || 0);
    platforms.push({
      platform: name,
      spend: Math.round(spend * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
      impressions: Math.round(impressions),
      clicks: Math.round(clicks),
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      conversions: Math.round(conversions),
      costPerConversion: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
      color: colors[name],
    });
  }

  const dailySpend: DaySpend[] = daily.map(r => ({
    date: dateStr(r.date),
    meta: Math.round(Number(r.meta || 0)),
    google: Math.round(Number(r.google || 0)),
    tiktok: Math.round(Number(r.tiktok || 0)),
  }));

  return { platforms, dailySpend };
}
