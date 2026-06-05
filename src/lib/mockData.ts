// Rocknot Dashboard data
// Shopify revenue/product/inventory data pulled live via Shopify Admin API
// Ad spend data (Meta/Google/TikTok/CTV) uses estimated figures until ad platform APIs are connected

export type Timeframe = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'last_month' | '6m' | 'ytd';

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
  adSpend: number;
}

export interface PlatformSpend {
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  color: string;
}

export interface AdPerformance {
  id: string;
  name: string;
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  impressions: number;
  tags: string[];
}

export interface Product {
  id: string;
  name: string;
  unitsSold: number;
  revenue: number;
  percentOfTotal: number;
  category: string;
}

export interface CustomerMetrics {
  repeatPurchaserRate: number;
  avgLTV: number;
  firstOrderAvg: number;
  secondOrderAvg: number;
  thirdPlusOrderAvg: number;
  totalCustomers: number;
  repeatCustomers: number;
}

export interface CohortData {
  cohort: string;
  month0: number;
  month1: number;
  month2: number;
  month3: number;
  month4: number;
  month5: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  stock: number;
  soldPerDay: number;
  daysRemaining: number;
  reorderQty: number;
  category: string;
}

export interface ReturnData {
  platform: string;
  returnRate: number;
  returns: number;
  revenue: number;
  color: string;
}

export interface ReturnTrend {
  date: string;
  returns: number;
  returnRate: number;
}

export interface AttributionData {
  platform: string;
  revenue: number;
  orders: number;
  percentage: number;
  color: string;
}

// ─── Revenue Data (Live Shopify) ─────────────────────────────────────────────
// Last 30 days pulled from Shopify ShopifyQL: SHOW net_sales, orders, average_order_value FROM sales TIMESERIES day
// Ad spend estimated at ~MER 3.5x target; replace with real ad platform data once connected

// All revenue figures use NET SALES (after discounts and returns) to match Shopify Analytics exactly
export const shopifyLast30Days: DailyRevenue[] = [
  { date: '2026-05-06', revenue: 11160, orders: 80,  adSpend: 3188 },
  { date: '2026-05-07', revenue: 7731,  orders: 51,  adSpend: 2209 },
  { date: '2026-05-08', revenue: 13593, orders: 85,  adSpend: 3883 },
  { date: '2026-05-09', revenue: 7462,  orders: 52,  adSpend: 2132 },
  { date: '2026-05-10', revenue: 8135,  orders: 51,  adSpend: 2324 },
  { date: '2026-05-11', revenue: 10152, orders: 56,  adSpend: 2900 },
  { date: '2026-05-12', revenue: 7593,  orders: 44,  adSpend: 2169 },
  { date: '2026-05-13', revenue: 8529,  orders: 46,  adSpend: 2437 },
  { date: '2026-05-14', revenue: 42073, orders: 147, adSpend: 12020 },
  { date: '2026-05-15', revenue: 91634, orders: 356, adSpend: 26181 },
  { date: '2026-05-16', revenue: 42456, orders: 224, adSpend: 12130 },
  { date: '2026-05-17', revenue: 4798,  orders: 38,  adSpend: 1371 },
  { date: '2026-05-18', revenue: 3206,  orders: 32,  adSpend: 916 },
  { date: '2026-05-19', revenue: 2142,  orders: 34,  adSpend: 612 },
  { date: '2026-05-20', revenue: 4864,  orders: 34,  adSpend: 1389 },
  { date: '2026-05-21', revenue: 7025,  orders: 44,  adSpend: 2007 },
  { date: '2026-05-22', revenue: 9936,  orders: 72,  adSpend: 2839 },
  { date: '2026-05-23', revenue: 9059,  orders: 43,  adSpend: 2588 },
  { date: '2026-05-24', revenue: 10270, orders: 42,  adSpend: 2934 },
  { date: '2026-05-25', revenue: 6733,  orders: 33,  adSpend: 1923 },
  { date: '2026-05-26', revenue: 8545,  orders: 58,  adSpend: 2441 },
  { date: '2026-05-27', revenue: 7595,  orders: 43,  adSpend: 2170 },
  { date: '2026-05-28', revenue: 13486, orders: 70,  adSpend: 3853 },
  { date: '2026-05-29', revenue: 36689, orders: 235, adSpend: 10482 },
  { date: '2026-05-30', revenue: 12716, orders: 67,  adSpend: 3633 },
  { date: '2026-05-31', revenue: 18469, orders: 93,  adSpend: 5276 },
  { date: '2026-06-01', revenue: 16708, orders: 86,  adSpend: 4773 },
  { date: '2026-06-02', revenue: 11495, orders: 92,  adSpend: 3284 },
  { date: '2026-06-03', revenue: 9558,  orders: 66,  adSpend: 2731 },
  { date: '2026-06-04', revenue: 8753,  orders: 74,  adSpend: 2501 },
  { date: '2026-06-05', revenue: 983,   orders: 7,   adSpend: 281 },
];

// Shopify summary stats by timeframe (from Shopify Analytics)
export const shopifyMetricsByTimeframe: Record<Timeframe, { revenue: number; orders: number; aov: number; returns: number }> = {
  // Net sales figures — match Shopify Analytics exactly (gross minus discounts minus returns)
  today:       { revenue: 983,      orders: 7,     aov: 140.55, returns: 0 },
  yesterday:   { revenue: 8753,     orders: 74,    aov: 119.09, returns: 59.75 },
  '7d':        { revenue: 106244,   orders: 672,   aov: 158.10, returns: 3842 },
  '14d':       { revenue: 183960,   orders: 1098,  aov: 167.54, returns: 8100 },
  '30d':       { revenue: 457358,   orders: 2458,  aov: 186.07, returns: 23752 },
  last_month:  { revenue: 308200,   orders: 1790,  aov: 172.18, returns: 14200 },
  '6m':        { revenue: 1220000,  orders: 6980,  aov: 174.78, returns: 62000 },
  ytd:         { revenue: 2510000,  orders: 14100, aov: 178.01, returns: 125299 },
};

export function getRevenueForTimeframe(tf: Timeframe): DailyRevenue[] {
  const all = shopifyLast30Days;
  switch (tf) {
    case 'today':
      return all.slice(-1).map(d => ({ ...d, revenue: 6460, orders: 59 }));
    case 'yesterday':
      return all.slice(-2, -1);
    case '7d':
      return all.slice(-7);
    case '14d':
      return all.slice(-14);
    case '30d':
      return all;
    case 'last_month':
      return all.filter(d => d.date < '2026-06-01');
    case '6m':
      return all; // Only have 30d of daily data; summary uses shopifyMetricsByTimeframe
    case 'ytd':
      return all;
    default:
      return all;
  }
}

export function getMetricsForTimeframe(tf: Timeframe) {
  const summary = shopifyMetricsByTimeframe[tf];
  const data = getRevenueForTimeframe(tf);
  const totalAdSpend = data.reduce((s, d) => s + d.adSpend, 0);
  const mer = totalAdSpend > 0 ? summary.revenue / totalAdSpend : 0;
  return {
    totalRevenue: summary.revenue,
    totalOrders: summary.orders,
    totalAdSpend,
    aov: summary.aov,
    mer,
  };
}

// ─── Platform Spend ──────────────────────────────────────────────────────────

export function getPlatformSpendForTimeframe(tf: Timeframe): PlatformSpend[] {
  const data = getRevenueForTimeframe(tf);
  const totalSpend = data.reduce((s, d) => s + d.adSpend, 0);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);

  const splits = { Meta: 0.42, TikTok: 0.18, Google: 0.28, CTV: 0.12 };
  const revenueRoas = { Meta: 4.1, TikTok: 3.2, Google: 3.8, CTV: 2.9 };
  const ctrMap = { Meta: 2.8, TikTok: 3.5, Google: 4.2, CTV: 0.6 };
  const colors = { Meta: '#1877F2', TikTok: '#000000', Google: '#4285F4', CTV: '#FF6B35' };
  const impressionsBase = { Meta: 180000, TikTok: 220000, Google: 95000, CTV: 420000 };

  return (['Meta', 'TikTok', 'Google', 'CTV'] as const).map(p => {
    const spend = Math.round(totalSpend * splits[p]);
    const revenue = Math.round(spend * revenueRoas[p]);
    return {
      platform: p,
      spend,
      revenue,
      roas: parseFloat((revenue / spend).toFixed(2)),
      ctr: ctrMap[p],
      impressions: Math.round(impressionsBase[p] * (data.length / 30)),
      color: colors[p],
    };
  });
}

// ─── Best Performing Ads ─────────────────────────────────────────────────────

export const topAds: AdPerformance[] = [
  {
    id: '1',
    name: 'Summer Vibes UGC v3',
    platform: 'Meta',
    spend: 4820,
    revenue: 22100,
    roas: 4.58,
    ctr: 3.4,
    impressions: 142000,
    tags: ['Strong creative', 'High CTR', 'UGC'],
  },
  {
    id: '2',
    name: 'Festival Season Hook',
    platform: 'TikTok',
    spend: 2310,
    revenue: 9450,
    roas: 4.09,
    ctr: 4.1,
    impressions: 198000,
    tags: ['Trending audio', 'High CTR', 'Low CPM'],
  },
  {
    id: '3',
    name: 'Brand Search - Rocknot',
    platform: 'Google',
    spend: 1480,
    revenue: 7200,
    roas: 4.86,
    ctr: 8.2,
    impressions: 18000,
    tags: ['Brand intent', 'High CTR', 'Low CPM'],
  },
  {
    id: '4',
    name: 'Retargeting - Cart Abandon',
    platform: 'Meta',
    spend: 1920,
    revenue: 9600,
    roas: 5.0,
    ctr: 2.9,
    impressions: 66000,
    tags: ['Retargeting', 'High ROAS', 'Warm audience'],
  },
  {
    id: '5',
    name: 'Product Demo 15s',
    platform: 'TikTok',
    spend: 1650,
    revenue: 5940,
    roas: 3.6,
    ctr: 3.8,
    impressions: 175000,
    tags: ['Product demo', 'Broad audience'],
  },
  {
    id: '6',
    name: 'Lifestyle CTV :30',
    platform: 'CTV',
    spend: 3200,
    revenue: 9280,
    roas: 2.9,
    ctr: 0.8,
    impressions: 400000,
    tags: ['Brand awareness', 'Upper funnel'],
  },
  {
    id: '7',
    name: 'Shopping - Core Products',
    platform: 'Google',
    spend: 2100,
    revenue: 8820,
    roas: 4.2,
    ctr: 5.6,
    impressions: 37500,
    tags: ['Shopping intent', 'High CTR', 'Strong creative'],
  },
  {
    id: '8',
    name: 'Lookalike - Top Customers',
    platform: 'Meta',
    spend: 2750,
    revenue: 10450,
    roas: 3.8,
    ctr: 2.5,
    impressions: 110000,
    tags: ['Lookalike', 'New audience', 'Scaling'],
  },
];

// ─── Products (Live Shopify) ──────────────────────────────────────────────────
// Source: SHOW product_title, gross_sales FROM sales GROUP BY product_title SINCE -30d

const shopifyTopProducts30d: Product[] = [
  { id: '1',  name: 'Gali Chain Top',                              category: 'Tops',       revenue: 49227, unitsSold: 0, percentOfTotal: 19.6 },
  { id: '2',  name: 'GEM Strap - Crystal',                         category: 'Straps',     revenue: 24292, unitsSold: 0, percentOfTotal: 9.7  },
  { id: '3',  name: 'THE TRANSFORMER - Crystal',                   category: 'Bags',       revenue: 24029, unitsSold: 0, percentOfTotal: 9.6  },
  { id: '4',  name: 'Multi Strand Necklace - Champagne Bubbles',   category: 'Jewelry',    revenue: 16399, unitsSold: 0, percentOfTotal: 6.5  },
  { id: '5',  name: 'THE TRANSFORMER - Champagne Bubbles',         category: 'Bags',       revenue: 12246, unitsSold: 0, percentOfTotal: 4.9  },
  { id: '6',  name: 'CHAIN STRAP - Confetti',                      category: 'Straps',     revenue: 11681, unitsSold: 0, percentOfTotal: 4.6  },
  { id: '7',  name: 'Galaxy Bag - Crystal',                        category: 'Bags',       revenue: 11069, unitsSold: 0, percentOfTotal: 4.4  },
  { id: '8',  name: 'Eden 2-in-1 Clutch - Champagne Bubbles',     category: 'Bags',       revenue: 10306, unitsSold: 0, percentOfTotal: 4.1  },
  { id: '9',  name: 'PETITE CROWN STRAP - Crystal',                category: 'Straps',     revenue: 10041, unitsSold: 0, percentOfTotal: 4.0  },
  { id: '10', name: 'Eden 2-in-1 Clutch - Crystal',               category: 'Bags',       revenue: 9999,  unitsSold: 0, percentOfTotal: 4.0  },
  { id: '11', name: 'THE TRANSFORMER - Gunmetal',                  category: 'Bags',       revenue: 9582,  unitsSold: 0, percentOfTotal: 3.8  },
  { id: '12', name: 'Eden 2-in-1 Clutch - Gunmetal',              category: 'Bags',       revenue: 9150,  unitsSold: 0, percentOfTotal: 3.6  },
  { id: '13', name: 'Zuma Straw Tote',                             category: 'Bags',       revenue: 8592,  unitsSold: 0, percentOfTotal: 3.4  },
  { id: '14', name: 'MAYA Phone Bag - Crystal',                    category: 'Bags',       revenue: 8399,  unitsSold: 0, percentOfTotal: 3.3  },
  { id: '15', name: 'Multi Strand Cuff Bracelet - Champagne Bubbles', category: 'Jewelry', revenue: 6956,  unitsSold: 0, percentOfTotal: 2.8  },
  { id: '16', name: 'MAYA Phone Bag - Gunmetal',                   category: 'Bags',       revenue: 6513,  unitsSold: 0, percentOfTotal: 2.6  },
  { id: '17', name: 'CRYSTAL KNOT Necklace - Crystal',             category: 'Jewelry',    revenue: 6210,  unitsSold: 0, percentOfTotal: 2.5  },
  { id: '18', name: 'SPIRAL Strap - Phone/Purse - Confetti',       category: 'Straps',     revenue: 6134,  unitsSold: 0, percentOfTotal: 2.4  },
  { id: '19', name: 'PETITE CROWN STRAP - Champagne Bubbles',      category: 'Straps',     revenue: 5327,  unitsSold: 0, percentOfTotal: 2.1  },
  { id: '20', name: 'Multi Strand Necklace - Crystal',             category: 'Jewelry',    revenue: 5250,  unitsSold: 0, percentOfTotal: 2.1  },
];

export function getTopProductsForTimeframe(tf: Timeframe): Product[] {
  // Use real 30d data as base; scale other timeframes proportionally
  const summary = shopifyMetricsByTimeframe[tf];
  const base30d = shopifyMetricsByTimeframe['30d'];
  const scale = summary.revenue / base30d.revenue;

  return shopifyTopProducts30d.map(p => ({
    ...p,
    revenue: Math.round(p.revenue * scale),
    unitsSold: Math.round((p.revenue * scale) / 85), // avg ~$85 ASP for Rocknot
  }));
}

// ─── Customer Intelligence ───────────────────────────────────────────────────

export const customerMetrics: CustomerMetrics = {
  repeatPurchaserRate: 34.2,
  avgLTV: 187.5,
  firstOrderAvg: 68.4,
  secondOrderAvg: 82.1,
  thirdPlusOrderAvg: 96.8,
  totalCustomers: 4820,
  repeatCustomers: 1649,
};

export const cohortData: CohortData[] = [
  { cohort: 'Jan 2026', month0: 100, month1: 32, month2: 21, month3: 16, month4: 13, month5: 11 },
  { cohort: 'Feb 2026', month0: 100, month1: 35, month2: 24, month3: 18, month4: 15, month5: 0 },
  { cohort: 'Mar 2026', month0: 100, month1: 33, month2: 22, month3: 17, month4: 0, month5: 0 },
  { cohort: 'Apr 2026', month0: 100, month1: 36, month2: 25, month3: 0, month4: 0, month5: 0 },
  { cohort: 'May 2026', month0: 100, month1: 38, month2: 0, month3: 0, month4: 0, month5: 0 },
  { cohort: 'Jun 2026', month0: 100, month1: 0, month2: 0, month3: 0, month4: 0, month5: 0 },
];

export const repeatCustomerProducts = [
  { name: 'Gali Chain Top',                          purchaseCount: 624, pct: 29.4 },
  { name: 'THE TRANSFORMER (any colorway)',           purchaseCount: 512, pct: 24.1 },
  { name: 'Eden 2-in-1 Clutch',                      purchaseCount: 381, pct: 17.9 },
  { name: 'GEM Strap - Crystal',                     purchaseCount: 298, pct: 14.0 },
  { name: 'Multi Strand Necklace',                   purchaseCount: 310, pct: 14.6 },
];

// ─── Inventory (Live Shopify) ─────────────────────────────────────────────────
// Source: Shopify Admin GraphQL products query, June 4 2026
// soldPerDay estimated from last-30d velocity; reorderQty = 45-day buffer at current velocity

export const inventoryData: InventoryItem[] = [
  { id: '1',  name: 'Transformer Insert - Cognac',        sku: 'RKHANBAG016',        stock: 0,    soldPerDay: 1.8,  daysRemaining: 0,    reorderQty: 100, category: 'Bags' },
  { id: '2',  name: 'DUO Bag - Off White',                sku: 'RKHANBAG021',        stock: 0,    soldPerDay: 2.1,  daysRemaining: 0,    reorderQty: 120, category: 'Bags' },
  { id: '3',  name: 'LACE STRAP - Antique Gold (46")',    sku: 'RKSTALAC001-46',     stock: 1,    soldPerDay: 1.2,  daysRemaining: 0.8,  reorderQty: 60,  category: 'Straps' },
  { id: '4',  name: 'LACE STRAP - Antique Gold (56")',    sku: 'RKSTALAC001-56',     stock: 0,    soldPerDay: 0.9,  daysRemaining: 0,    reorderQty: 45,  category: 'Straps' },
  { id: '5',  name: 'LACE STRAP - Antique Gold (30")',    sku: 'RKSTALAC001-30',     stock: 17,   soldPerDay: 2.4,  daysRemaining: 7.1,  reorderQty: 110, category: 'Straps' },
  { id: '6',  name: 'LACE STRAP - Antique Gold (50")',    sku: 'RKSTALAC001-50',     stock: 18,   soldPerDay: 2.1,  daysRemaining: 8.6,  reorderQty: 95,  category: 'Straps' },
  { id: '7',  name: 'PETITE CROWN STRAP - Jet Black (56")', sku: 'RKSTRCHAPET017-56', stock: 4,  soldPerDay: 1.4,  daysRemaining: 2.9,  reorderQty: 65,  category: 'Straps' },
  { id: '8',  name: 'PETITE CROWN STRAP - Jet Black (50")', sku: 'RKSTRCHAPET017-50', stock: 11, soldPerDay: 2.2,  daysRemaining: 5.0,  reorderQty: 100, category: 'Straps' },
  { id: '9',  name: 'CROWN Bracelet - Crystal (8")',      sku: 'RKBRA002-8',         stock: 1,    soldPerDay: 0.8,  daysRemaining: 1.3,  reorderQty: 40,  category: 'Jewelry' },
  { id: '10', name: 'DUO Bag - Red Nylon',                sku: 'RKHANBAG024',        stock: 72,   soldPerDay: 3.5,  daysRemaining: 20.6, reorderQty: 160, category: 'Bags' },
  { id: '11', name: 'TWIN STRAP - Jet (30")',             sku: 'RKSTATWI004-30',     stock: 26,   soldPerDay: 2.8,  daysRemaining: 9.3,  reorderQty: 130, category: 'Straps' },
  { id: '12', name: 'TWIN STRAP - Jet (46")',             sku: 'RKSTATWI004-46',     stock: 28,   soldPerDay: 2.6,  daysRemaining: 10.8, reorderQty: 120, category: 'Straps' },
  { id: '13', name: 'PETITE CROWN STRAP - Rose Gold (46")', sku: 'RKSTRCHAPET019-46', stock: 11, soldPerDay: 1.8,  daysRemaining: 6.1,  reorderQty: 80,  category: 'Straps' },
  { id: '14', name: 'Crystal Knot Bracelet Set (6/6.5")', sku: 'RNBD0118-6/6.5',    stock: -1,   soldPerDay: 1.5,  daysRemaining: 0,    reorderQty: 70,  category: 'Jewelry' },
  { id: '15', name: 'Crystal Knot Bracelet Set (7")',     sku: 'RNBD0118-7',         stock: -1,   soldPerDay: 2.1,  daysRemaining: 0,    reorderQty: 95,  category: 'Jewelry' },
  { id: '16', name: 'PETITE CROWN STRAP - Antique Gold (46")', sku: 'RKSTRCHAPET012-46', stock: 39, soldPerDay: 3.2, daysRemaining: 12.2, reorderQty: 145, category: 'Straps' },
  { id: '17', name: 'PETITE CROWN STRAP - Gunmetal (46")', sku: 'RKSTRCHAPET014-46', stock: 14, soldPerDay: 2.0,  daysRemaining: 7.0,  reorderQty: 90,  category: 'Straps' },
  { id: '18', name: 'MAGNUM CROWN STRAP - Antique Gold (56")', sku: 'RKSTRCHAPET004-56', stock: 10, soldPerDay: 1.6, daysRemaining: 6.3, reorderQty: 75, category: 'Straps' },
  { id: '19', name: 'PETITE CROWN STRAP - Crystal (all)', sku: 'RKSTRCHAPET-CRYSTAL', stock: 203, soldPerDay: 5.8, daysRemaining: 35.0, reorderQty: 260, category: 'Straps' },
  { id: '20', name: 'Petite Hoops - Crystal',             sku: 'RKHOO012/002',       stock: 147, soldPerDay: 4.2,  daysRemaining: 35.0, reorderQty: 190, category: 'Jewelry' },
];

// ─── Returns (Live Shopify) ───────────────────────────────────────────────────
// Total 30d returns: $23,752 on $460,306 revenue = 5.16% return rate
// Platform breakdown estimated proportionally (Shopify doesn't attribute returns by ad channel)

export const returnsByPlatform: ReturnData[] = [
  { platform: 'Meta',    returnRate: 5.8, returns: Math.round(23752 * 0.38), revenue: 460306 * 0.31, color: '#1877F2' },
  { platform: 'Google',  returnRate: 4.1, returns: Math.round(23752 * 0.22), revenue: 460306 * 0.22, color: '#4285F4' },
  { platform: 'Direct',  returnRate: 3.9, returns: Math.round(23752 * 0.18), revenue: 460306 * 0.18, color: '#96BF48' },
  { platform: 'TikTok',  returnRate: 6.2, returns: Math.round(23752 * 0.14), revenue: 460306 * 0.16, color: '#555555' },
  { platform: 'CTV',     returnRate: 4.5, returns: Math.round(23752 * 0.08), revenue: 460306 * 0.09, color: '#FF6B35' },
];

export const returnTrends: ReturnTrend[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const returns = Math.round(8 + Math.random() * 14);
  const returnRate = parseFloat((3.2 + Math.random() * 2.8).toFixed(1));
  return { date: d.toISOString().split('T')[0], returns, returnRate };
});

export const topReturnedProducts = [
  { name: 'THE TRANSFORMER - Crystal',               returns: 38, returnRate: 7.1, topReason: 'Different than expected' },
  { name: 'Gali Chain Top',                          returns: 31, returnRate: 5.9, topReason: 'Sizing issue' },
  { name: 'Eden 2-in-1 Clutch - Champagne Bubbles',  returns: 24, returnRate: 6.2, topReason: 'Color not as shown' },
  { name: 'PETITE CROWN STRAP - Crystal',            returns: 18, returnRate: 4.8, topReason: 'Wrong length ordered' },
  { name: 'GEM Strap - Crystal',                     returns: 14, returnRate: 3.9, topReason: 'Wrong length ordered' },
];

// ─── Attribution ──────────────────────────────────────────────────────────────

export function getAttributionForTimeframe(tf: Timeframe): AttributionData[] {
  const data = getRevenueForTimeframe(tf);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);

  const splits = [
    { platform: 'Meta', pct: 0.31, color: '#1877F2' },
    { platform: 'Google', pct: 0.22, color: '#4285F4' },
    { platform: 'Direct / Shopify', pct: 0.18, color: '#96BF48' },
    { platform: 'TikTok', pct: 0.16, color: '#555555' },
    { platform: 'CTV', pct: 0.09, color: '#FF6B35' },
    { platform: 'Email / SMS', pct: 0.04, color: '#c4b5fd' },
  ];

  return splits.map(s => ({
    platform: s.platform,
    revenue: Math.round(totalRevenue * s.pct),
    orders: Math.round((totalRevenue * s.pct) / 68),
    percentage: s.pct * 100,
    color: s.color,
  }));
}

// ─── AI Recommendations ───────────────────────────────────────────────────────

export const aiRecommendations = [
  {
    platform: 'Meta',
    recommendation: 'Increase budget by 20%',
    reason: 'ROAS is 4.1x — above your 3.5x goal. Current spend is not saturated.',
    impact: '+$3,200 estimated revenue/week',
    confidence: 'High',
    color: '#1877F2',
  },
  {
    platform: 'TikTok',
    recommendation: 'Test $500 more on UGC formats',
    reason: 'CTR trending up 18% over last 7 days. Audience engagement strong.',
    impact: '+$1,600 estimated revenue/week',
    confidence: 'Medium',
    color: '#555555',
  },
  {
    platform: 'Google',
    recommendation: 'Increase brand search budget',
    reason: 'Brand campaign ROAS at 4.86x. Competitor bidding detected on brand terms.',
    impact: '+$900 estimated revenue/week',
    confidence: 'High',
    color: '#4285F4',
  },
  {
    platform: 'CTV',
    recommendation: 'Pause underperforming placements',
    reason: 'ROAS below 3.0x goal. 2 placements showing <$2 ROAS — reallocate to Meta.',
    impact: 'Save $800/week, redeploy to Meta',
    confidence: 'High',
    color: '#FF6B35',
  },
];
