import { NextRequest, NextResponse } from 'next/server';
import { sheetDataMay2026, june2026Partial } from '@/src/lib/mockData';

const SHEET_ID = '1Ktfxo9X_KWsZxWoSaP0dQY_A78q3mBYoypfk9TFFFUc';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// Column indices in the sheet (0-based after the date column)
// Date | Meta Spend | Meta ROAS | Meta Revenue | Meta CPP | Meta Purchase |
// Google Spend | Google ROAS | Google Revenue | Google CPP | Google Purchase |
// Total Ad Spend | Orders | Total Rev after Returns | MER | Revenue CPA | CAC |
// New Customers | New Cust Revenue | New MER | % New | Returning | Returning Rev | % Returning | Notes

function parseNum(val: string): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,%]/g, '').replace(/,/g, '')) || 0;
}

async function fetchSheetRange(range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 3600 } }); // cache 1 hour
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

function parseSheetRows(rows: string[][], monthPrefix: string) {
  return rows
    .filter(r => r[0]?.startsWith(monthPrefix) && !['MTD', 'FORECAST', 'TARGET'].includes(r[0]))
    .map(r => {
      const dayNum = parseInt(r[0].split('-')[1]);
      const month = monthPrefix === 'May' ? '2026-05' : monthPrefix === 'Jan' ? '2026-01' : '2026-06';
      const date = `${month}-${String(dayNum).padStart(2, '0')}`;
      const metaSpend = parseNum(r[1]);
      const metaRoas = parseNum(r[2]);
      const googleSpend = parseNum(r[6]);
      const googleRoas = parseNum(r[7]);
      const totalSpend = parseNum(r[11]);
      const orders = parseNum(r[12]);
      const revenue = parseNum(r[13]);
      const mer = parseNum(r[14]);
      const cac = parseNum(r[16]);
      const newCustomers = parseNum(r[17]);
      const newCustomerRevenue = parseNum(r[18]);
      const returningCustomers = parseNum(r[21]);
      const returningCustomerRevenue = parseNum(r[22]);

      return {
        date,
        revenue: Math.round(revenue),
        orders: Math.round(orders),
        adSpend: Math.round(totalSpend),
        metaSpend: Math.round(metaSpend),
        googleSpend: Math.round(googleSpend),
        metaRoas,
        googleRoas,
        newCustomers: Math.round(newCustomers),
        newCustomerRevenue: Math.round(newCustomerRevenue),
        returningCustomers: Math.round(returningCustomers),
        returningCustomerRevenue: Math.round(returningCustomerRevenue),
        mer,
        cac,
      };
    });
}

export async function GET(request: NextRequest) {
  const tf = request.nextUrl.searchParams.get('tf') || '30d';

  if (!API_KEY) {
    // Return static data from mockData when no API key configured
    const all = [...sheetDataMay2026, ...june2026Partial];
    const thirtyDaysAgo = new Date('2026-05-06').toISOString().split('T')[0];
    const filtered = tf === 'last_month'
      ? sheetDataMay2026
      : tf === '7d' ? all.filter(d => d.date >= '2026-05-29')
      : tf === '14d' ? all.filter(d => d.date >= '2026-05-22')
      : all.filter(d => d.date >= thirtyDaysAgo);

    const totalRevenue = filtered.reduce((s, d) => s + d.revenue, 0);
    const totalAdSpend = filtered.reduce((s, d) => s + d.adSpend, 0);
    const totalOrders = filtered.reduce((s, d) => s + d.orders, 0);
    const totalMetaSpend = filtered.reduce((s, d) => s + d.metaSpend, 0);
    const totalGoogleSpend = filtered.reduce((s, d) => s + d.googleSpend, 0);
    const totalNewCustomers = filtered.reduce((s, d) => s + d.newCustomers, 0);
    const totalReturningCustomers = filtered.reduce((s, d) => s + d.returningCustomers, 0);
    const totalNewRevenue = filtered.reduce((s, d) => s + d.newCustomerRevenue, 0);
    const totalReturningRevenue = filtered.reduce((s, d) => s + d.returningCustomerRevenue, 0);

    return NextResponse.json({
      source: 'sheets_static',
      timeframe: tf,
      dailyData: filtered,
      summary: {
        totalRevenue,
        totalAdSpend,
        totalOrders,
        aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
        metaSpend: totalMetaSpend,
        googleSpend: totalGoogleSpend,
        newCustomers: totalNewCustomers,
        returningCustomers: totalReturningCustomers,
        newCustomerRevenue: totalNewRevenue,
        returningCustomerRevenue: totalReturningRevenue,
        pctNew: totalOrders > 0 ? Math.round((totalNewCustomers / totalOrders) * 1000) / 10 : 0,
        pctReturning: totalOrders > 0 ? Math.round((totalReturningCustomers / totalOrders) * 1000) / 10 : 0,
      },
    });
  }

  try {
    // Fetch May and June data from live Google Sheet
    const [mayRows, janRows] = await Promise.all([
      fetchSheetRange("'2026 Daily Report'!A1:Y35"),
      fetchSheetRange("'2026 Daily Report'!A38:Y75"),
    ]);

    const mayData = parseSheetRows(mayRows, 'May');
    const all = [...mayData, ...june2026Partial];

    const filtered = tf === 'last_month' ? mayData
      : tf === '7d' ? all.filter(d => d.date >= '2026-05-29')
      : tf === '14d' ? all.filter(d => d.date >= '2026-05-22')
      : all.filter(d => d.date >= '2026-05-06');

    const totalRevenue = filtered.reduce((s, d) => s + d.revenue, 0);
    const totalAdSpend = filtered.reduce((s, d) => s + d.adSpend, 0);
    const totalOrders = filtered.reduce((s, d) => s + d.orders, 0);
    const totalMetaSpend = filtered.reduce((s, d) => s + d.metaSpend, 0);
    const totalGoogleSpend = filtered.reduce((s, d) => s + d.googleSpend, 0);
    const totalNewCustomers = filtered.reduce((s, d) => s + d.newCustomers, 0);
    const totalReturningCustomers = filtered.reduce((s, d) => s + d.returningCustomers, 0);
    const totalNewRevenue = filtered.reduce((s, d) => s + d.newCustomerRevenue, 0);
    const totalReturningRevenue = filtered.reduce((s, d) => s + d.returningCustomerRevenue, 0);

    return NextResponse.json({
      source: 'google_sheets_live',
      timeframe: tf,
      dailyData: filtered,
      summary: {
        totalRevenue,
        totalAdSpend,
        totalOrders,
        aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        mer: totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0,
        metaSpend: totalMetaSpend,
        googleSpend: totalGoogleSpend,
        newCustomers: totalNewCustomers,
        returningCustomers: totalReturningCustomers,
        newCustomerRevenue: totalNewRevenue,
        returningCustomerRevenue: totalReturningRevenue,
        pctNew: totalOrders > 0 ? Math.round((totalNewCustomers / totalOrders) * 1000) / 10 : 0,
        pctReturning: totalOrders > 0 ? Math.round((totalReturningCustomers / totalOrders) * 1000) / 10 : 0,
      },
    });
  } catch (err) {
    return NextResponse.json({
      source: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
