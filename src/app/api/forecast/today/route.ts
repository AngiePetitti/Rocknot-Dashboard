import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

// End-of-day sales forecast for the live Today view. Learns the store's
// typical intraday revenue curve from the last 7 complete days of hourly
// sales (ShopifyQL), then projects today's total from where today sits on
// that curve — far better than linear extrapolation, since mornings and
// evenings contribute very different shares of a day.
async function hourlySales(ql: string) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
        tableData { rows columns { name } } parseErrors
      }}`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  if (typeof q?.parseErrors === 'string' && q.parseErrors) throw new Error(q.parseErrors);
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return rows.map(r => ({
    hour: cell(r, 'hour') || '',
    revenue: parseFloat(cell(r, 'total_sales') || '0'),
    orders: Math.round(parseFloat(cell(r, 'orders') || '0')),
  }));
}

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'Shopify not configured' }, { status: 500 });
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const rows = await hourlySales(
      `FROM sales SHOW total_sales, orders TIMESERIES hour SINCE -7d UNTIL ${today}`
    );

    // Split into complete past days vs today; bucket by date + hour-of-day.
    const byDay = new Map<string, { rev: number[]; total: number; orders: number }>();
    for (const r of rows) {
      const [date, timePart] = r.hour.split('T');
      if (!date || !timePart) continue;
      const h = parseInt(timePart.slice(0, 2), 10);
      if (Number.isNaN(h)) continue;
      const d = byDay.get(date) || { rev: Array(24).fill(0), total: 0, orders: 0 };
      d.rev[h] += r.revenue;
      d.total += r.revenue;
      d.orders += r.orders;
      byDay.set(date, d);
    }

    const todayData = byDay.get(today);
    const pastDays = Array.from(byDay.entries())
      .filter(([d]) => d < today)
      .map(([, v]) => v)
      .filter(v => v.total > 0);

    const nowHour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date())
    );
    // Fraction of a typical day's revenue that lands by the end of the
    // PREVIOUS hour plus a pro-rated share of the current hour.
    const minute = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', minute: 'numeric' }).format(new Date()));
    let fracSum = 0;
    for (const d of pastDays) {
      let done = 0;
      for (let h = 0; h < nowHour; h++) done += d.rev[h];
      done += (d.rev[nowHour] || 0) * (minute / 60);
      fracSum += done / d.total;
    }
    const fraction = pastDays.length ? fracSum / pastDays.length : 0;

    const todaySoFar = todayData?.total ?? 0;
    const todayOrders = todayData?.orders ?? 0;
    const avgDayRevenue = pastDays.length ? pastDays.reduce((s, d) => s + d.total, 0) / pastDays.length : 0;

    // Below ~10% of the curve (early morning) the projection is noise — fall
    // back to the 7-day average as the anchor and flag low confidence.
    const usable = fraction >= 0.1 && todaySoFar > 0;
    const forecastRevenue = usable ? todaySoFar / fraction : avgDayRevenue;
    const forecastOrders = usable && todayOrders > 0 ? Math.round(todayOrders / fraction) : null;

    return NextResponse.json({
      todaySoFar: Math.round(todaySoFar),
      todayOrders,
      forecastRevenue: Math.round(forecastRevenue),
      forecastOrders,
      dayFraction: Math.round(fraction * 1000) / 10, // % of a typical day elapsed, revenue-wise
      avgDayRevenue: Math.round(avgDayRevenue),
      daysInCurve: pastDays.length,
      lowConfidence: !usable,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
