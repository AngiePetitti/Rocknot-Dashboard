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

// ShopifyQL buckets hours in the STORE's timezone — "now" must be computed in
// that same zone or the day-fraction is shifted by hours and the projection
// lands way off (the original PT assumption overshot for an ET store).
async function shopTimezone(): Promise<string> {
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query: '{ shop { ianaTimezone } }' }),
      next: { revalidate: 86400 },
    });
    const json = await res.json();
    return json?.data?.shop?.ianaTimezone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'Shopify not configured' }, { status: 500 });
  try {
    const tz = await shopTimezone();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
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

    // "Today" and "now" are read from the DATA, not a wall clock: the latest
    // date in the series is today, and its last populated hour bucket is the
    // current hour. Past days are measured at that exact same bucket position,
    // so whatever timezone ShopifyQL buckets in, both sides line up — a clock
    // in a different zone than the buckets shifted the curve and wildly
    // inflated forecasts.
    const dates = Array.from(byDay.keys()).sort();
    const dataToday = dates[dates.length - 1] || today;
    const todayData = byDay.get(dataToday);
    const pastDays = Array.from(byDay.entries())
      .filter(([d]) => d < dataToday)
      .map(([, v]) => v)
      .filter(v => v.total > 0);

    // Latest hour bucket with sales today; the bucket is partial, so past
    // days count fully through the previous hour plus half of this one.
    let nowHour = 0;
    if (todayData) {
      for (let h = 23; h >= 0; h--) {
        if (todayData.rev[h] > 0) { nowHour = h; break; }
      }
    }
    let fracSum = 0;
    for (const d of pastDays) {
      let done = 0;
      for (let h = 0; h < nowHour; h++) done += d.rev[h];
      done += (d.rev[nowHour] || 0) * 0.5;
      fracSum += done / d.total;
    }
    const fraction = pastDays.length ? fracSum / pastDays.length : 0;

    const todaySoFar = todayData?.total ?? 0;
    const todayOrders = todayData?.orders ?? 0;
    const avgDayRevenue = pastDays.length ? pastDays.reduce((s, d) => s + d.total, 0) / pastDays.length : 0;

    // Yesterday measured through the SAME hour bucket — the honest baseline
    // for "are we up or down today" (Shopify's own compare works this way).
    let yesterdaySoFar: number | null = null;
    let yesterdayTotal: number | null = null;
    {
      const yDate0 = dates[dates.length - 2];
      const yData0 = yDate0 ? byDay.get(yDate0) : undefined;
      if (yData0 && yData0.total > 0) {
        let ySo = 0;
        for (let h = 0; h < nowHour; h++) ySo += yData0.rev[h];
        ySo += (yData0.rev[nowHour] || 0) * 0.5;
        yesterdaySoFar = Math.round(ySo);
        yesterdayTotal = Math.round(yData0.total);
      }
    }

    // Self-check: run the SAME method on yesterday frozen at this hour and
    // compare with yesterday's real close, so the card can prove (or expose)
    // its own accuracy every day.
    let backtest: { projected: number; actual: number } | null = null;
    const yDate = dates[dates.length - 2];
    const yData = yDate ? byDay.get(yDate) : undefined;
    if (yData && yData.total > 0) {
      const earlier = Array.from(byDay.entries())
        .filter(([d]) => d < yDate)
        .map(([, v]) => v)
        .filter(v => v.total > 0);
      if (earlier.length >= 3) {
        let fSum = 0;
        for (const d of earlier) {
          let done = 0;
          for (let h = 0; h < nowHour; h++) done += d.rev[h];
          done += (d.rev[nowHour] || 0) * 0.5;
          fSum += done / d.total;
        }
        const f = fSum / earlier.length;
        let ySoFar = 0;
        for (let h = 0; h < nowHour; h++) ySoFar += yData.rev[h];
        ySoFar += (yData.rev[nowHour] || 0) * 0.5;
        if (f >= 0.1 && ySoFar > 0) {
          backtest = { projected: Math.round(ySoFar / f), actual: Math.round(yData.total) };
        }
      }
    }

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
      backtest,
      yesterdaySoFar,
      yesterdayTotal,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
