import { NextRequest, NextResponse } from 'next/server';
import { isBigQueryConfigured } from '@/src/lib/bigquery';
import { getOverview } from '@/src/lib/bqOverview';
import { getAdsOverview } from '@/src/lib/bqAds';
import { cacheHeaders } from '@/src/lib/cacheHeaders';

export const dynamic = 'force-dynamic';

export interface AttributionData {
  platform: string;
  revenue: number;
  orders: number;
  spend: number;
  roas: number;
  costPerOrder: number;
  percentage: number;
  color: string;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function rangeForTf(tfRaw: string, dateFrom: string, dateTo: string): { from: string; to: string } {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayStr = addDays(todayStr, -1);

  if (tfRaw === 'custom' && dateFrom && dateTo) return { from: dateFrom, to: dateTo };
  if (tfRaw === 'today') return { from: todayStr, to: todayStr };
  if (tfRaw === 'yesterday') return { from: yesterdayStr, to: yesterdayStr };
  if (tfRaw === '7d') return { from: addDays(todayStr, -7), to: todayStr };
  if (tfRaw === '14d') return { from: addDays(todayStr, -14), to: todayStr };
  if (tfRaw === '30d') return { from: addDays(todayStr, -30), to: todayStr };
  if (tfRaw === '6m') return { from: addDays(todayStr, -180), to: todayStr };
  if (tfRaw === 'ytd') return { from: `${todayStr.split('-')[0]}-01-01`, to: todayStr };
  if (tfRaw === 'last_month') {
    const [y, m] = todayStr.split('-').map(Number);
    return {
      from: new Date(y, m - 2, 1).toLocaleDateString('en-CA'),
      to: new Date(y, m - 1, 0).toLocaleDateString('en-CA'),
    };
  }
  return { from: addDays(todayStr, -30), to: yesterdayStr };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tfRaw = searchParams.get('tf') || '30d';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  if (!isBigQueryConfigured()) {
    return NextResponse.json({ source: 'error', error: 'BigQuery not configured', attribution: [] });
  }

  try {
    const range = rangeForTf(tfRaw, dateFrom, dateTo);
    const [overview, ads] = await Promise.all([
      getOverview(range.from, range.to),
      getAdsOverview(range.from, range.to).catch(() => ({ platforms: [], dailySpend: [] })),
    ]);

    const totalRevenue = overview.metrics.totalRevenue;
    const totalOrders = overview.metrics.totalOrders;

    const platformConfig: Record<string, { revenue: number; color: string }> = {
      Meta: { revenue: overview.metrics.metaRevenue, color: '#818cf8' },
      Google: { revenue: overview.metrics.googleRevenue, color: '#34d399' },
      TikTok: { revenue: overview.metrics.tiktokRevenue, color: '#f472b6' },
    };

    const spendByPlatform: Record<string, number> = {};
    for (const p of ads.platforms) spendByPlatform[p.platform] = p.spend;

    const attribution: AttributionData[] = [];
    let attributedRevenue = 0;
    let attributedOrders = 0;
    let totalSpend = 0;

    for (const p of ads.platforms) {
      const cfg = platformConfig[p.platform];
      if (!cfg) continue;
      const revenue = Math.round(cfg.revenue);
      const orders = Math.round(p.conversions);
      const spend = Math.round(p.spend * 100) / 100;
      const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;
      const costPerOrder = orders > 0 ? Math.round((spend / orders) * 100) / 100 : 0;
      attributedRevenue += revenue;
      attributedOrders += orders;
      totalSpend += spend;
      attribution.push({ platform: p.platform, revenue, orders, spend, roas, costPerOrder, percentage: 0, color: cfg.color });
    }

    const directRevenue = Math.max(0, totalRevenue - attributedRevenue);
    const directOrders = Math.max(0, totalOrders - attributedOrders);
    attribution.push({ platform: 'Direct / Other', revenue: directRevenue, orders: directOrders, spend: 0, roas: 0, costPerOrder: 0, percentage: 0, color: '#96BF48' });

    const grandTotal = attribution.reduce((s, a) => s + a.revenue, 0) || 1;
    for (const a of attribution) {
      a.percentage = Math.round((a.revenue / grandTotal) * 1000) / 10;
    }

    return NextResponse.json({ source: 'bigquery_live', totalRevenue, totalSpend, attribution }, { headers: cacheHeaders(tfRaw === 'today') });
  } catch (err) {
    return NextResponse.json({ source: 'error', error: String(err), attribution: [] });
  }
}
