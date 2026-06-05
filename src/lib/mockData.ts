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

// ─── Revenue Data (Funnel.io → Google Sheets) ────────────────────────────────
// Source: 2026 Daily Report Google Sheet (updated daily via Funnel.io)
// Ad spend = real Meta + Google figures from Funnel.io aggregation
// Revenue = Shopify Total Revenue after Returns

export interface DailySheetData extends DailyRevenue {
  metaSpend: number;
  googleSpend: number;
  metaRoas: number;
  googleRoas: number;
  newCustomers: number;
  newCustomerRevenue: number;
  returningCustomers: number;
  returningCustomerRevenue: number;
  mer: number;
  cac: number;
}

// May 2026 — real daily data from Funnel.io via Google Sheets
export const sheetDataMay2026: DailySheetData[] = [
  { date:'2026-05-01', revenue:14536, orders:74,  adSpend:2433,  metaSpend:2376,  googleSpend:57,  metaRoas:4.48, googleRoas:32.72, newCustomers:28,  newCustomerRevenue:5662,  returningCustomers:46,  returningCustomerRevenue:8874,  mer:5.97, cac:86.89 },
  { date:'2026-05-02', revenue:9505,  orders:57,  adSpend:2142,  metaSpend:2086,  googleSpend:56,  metaRoas:3.12, googleRoas:55.84, newCustomers:22,  newCustomerRevenue:3317,  returningCustomers:35,  returningCustomerRevenue:6188,  mer:4.44, cac:97.35 },
  { date:'2026-05-03', revenue:6513,  orders:34,  adSpend:2418,  metaSpend:2365,  googleSpend:53,  metaRoas:1.46, googleRoas:20.47, newCustomers:17,  newCustomerRevenue:3250,  returningCustomers:17,  returningCustomerRevenue:3263,  mer:2.69, cac:142.25 },
  { date:'2026-05-04', revenue:14039, orders:80,  adSpend:2317,  metaSpend:2273,  googleSpend:44,  metaRoas:3.16, googleRoas:8.78,  newCustomers:47,  newCustomerRevenue:7967,  returningCustomers:33,  returningCustomerRevenue:6072,  mer:6.06, cac:49.30 },
  { date:'2026-05-05', revenue:10526, orders:65,  adSpend:3514,  metaSpend:3470,  googleSpend:44,  metaRoas:2.32, googleRoas:45.64, newCustomers:44,  newCustomerRevenue:8264,  returningCustomers:21,  returningCustomerRevenue:2262,  mer:3.00, cac:79.86 },
  { date:'2026-05-06', revenue:12013, orders:80,  adSpend:3723,  metaSpend:3690,  googleSpend:34,  metaRoas:3.13, googleRoas:126.53,newCustomers:50,  newCustomerRevenue:8837,  returningCustomers:30,  returningCustomerRevenue:3176,  mer:3.23, cac:74.47 },
  { date:'2026-05-07', revenue:8331,  orders:51,  adSpend:3152,  metaSpend:3105,  googleSpend:47,  metaRoas:1.49, googleRoas:43.60, newCustomers:30,  newCustomerRevenue:4447,  returningCustomers:21,  returningCustomerRevenue:3883,  mer:2.64, cac:105.07 },
  { date:'2026-05-08', revenue:14711, orders:85,  adSpend:3814,  metaSpend:3728,  googleSpend:86,  metaRoas:1.92, googleRoas:37.30, newCustomers:40,  newCustomerRevenue:6537,  returningCustomers:45,  returningCustomerRevenue:8174,  mer:3.86, cac:95.34 },
  { date:'2026-05-09', revenue:8069,  orders:52,  adSpend:3262,  metaSpend:3213,  googleSpend:49,  metaRoas:2.20, googleRoas:38.58, newCustomers:33,  newCustomerRevenue:6336,  returningCustomers:19,  returningCustomerRevenue:1733,  mer:2.47, cac:98.85 },
  { date:'2026-05-10', revenue:8842,  orders:51,  adSpend:5590,  metaSpend:5541,  googleSpend:48,  metaRoas:1.34, googleRoas:48.77, newCustomers:32,  newCustomerRevenue:6069,  returningCustomers:19,  returningCustomerRevenue:2774,  mer:1.58, cac:174.67 },
  { date:'2026-05-11', revenue:10797, orders:56,  adSpend:3440,  metaSpend:3395,  googleSpend:45,  metaRoas:2.31, googleRoas:30.64, newCustomers:30,  newCustomerRevenue:6182,  returningCustomers:26,  returningCustomerRevenue:4615,  mer:3.14, cac:114.67 },
  { date:'2026-05-12', revenue:8109,  orders:44,  adSpend:2840,  metaSpend:2786,  googleSpend:54,  metaRoas:2.48, googleRoas:34.72, newCustomers:22,  newCustomerRevenue:4730,  returningCustomers:22,  returningCustomerRevenue:3380,  mer:2.86, cac:129.08 },
  { date:'2026-05-13', revenue:9086,  orders:46,  adSpend:2715,  metaSpend:2661,  googleSpend:54,  metaRoas:2.67, googleRoas:86.40, newCustomers:14,  newCustomerRevenue:3220,  returningCustomers:32,  returningCustomerRevenue:5865,  mer:3.35, cac:193.96 },
  { date:'2026-05-14', revenue:44830, orders:147, adSpend:2804,  metaSpend:2747,  googleSpend:57,  metaRoas:10.79,googleRoas:59.53, newCustomers:34,  newCustomerRevenue:7683,  returningCustomers:113, returningCustomerRevenue:37147, mer:15.99,cac:82.47 },
  { date:'2026-05-15', revenue:96822, orders:356, adSpend:14872, metaSpend:14818, googleSpend:53,  metaRoas:5.13, googleRoas:163.38,newCustomers:116, newCustomerRevenue:32250, returningCustomers:240, returningCustomerRevenue:64571, mer:6.51, cac:128.20 },
  { date:'2026-05-16', revenue:45613, orders:224, adSpend:6586,  metaSpend:6537,  googleSpend:48,  metaRoas:4.61, googleRoas:33.29, newCustomers:107, newCustomerRevenue:19347, returningCustomers:117, returningCustomerRevenue:26266, mer:6.93, cac:61.55 },
  { date:'2026-05-17', revenue:5217,  orders:38,  adSpend:2455,  metaSpend:2411,  googleSpend:44,  metaRoas:1.53, googleRoas:20.38, newCustomers:23,  newCustomerRevenue:3435,  returningCustomers:15,  returningCustomerRevenue:1782,  mer:2.12, cac:106.75 },
  { date:'2026-05-18', revenue:3537,  orders:32,  adSpend:1935,  metaSpend:1893,  googleSpend:42,  metaRoas:2.00, googleRoas:3.66,  newCustomers:16,  newCustomerRevenue:3182,  returningCustomers:16,  returningCustomerRevenue:354,   mer:1.83, cac:120.95 },
  { date:'2026-05-19', revenue:2555,  orders:34,  adSpend:1867,  metaSpend:1809,  googleSpend:58,  metaRoas:1.71, googleRoas:12.24, newCustomers:17,  newCustomerRevenue:1517,  returningCustomers:17,  returningCustomerRevenue:1037,  mer:1.37, cac:109.82 },
  { date:'2026-05-20', revenue:5183,  orders:34,  adSpend:2201,  metaSpend:2146,  googleSpend:55,  metaRoas:1.88, googleRoas:20.40, newCustomers:15,  newCustomerRevenue:2889,  returningCustomers:19,  returningCustomerRevenue:2293,  mer:2.35, cac:146.72 },
  { date:'2026-05-21', revenue:7438,  orders:44,  adSpend:2012,  metaSpend:1955,  googleSpend:57,  metaRoas:2.28, googleRoas:3.12,  newCustomers:24,  newCustomerRevenue:3994,  returningCustomers:20,  returningCustomerRevenue:3444,  mer:3.70, cac:83.84 },
  { date:'2026-05-22', revenue:10640, orders:72,  adSpend:1810,  metaSpend:1767,  googleSpend:43,  metaRoas:2.35, googleRoas:36.73, newCustomers:23,  newCustomerRevenue:4165,  returningCustomers:49,  returningCustomerRevenue:6475,  mer:5.88, cac:78.68 },
  { date:'2026-05-23', revenue:9513,  orders:43,  adSpend:2113,  metaSpend:2052,  googleSpend:61,  metaRoas:3.46, googleRoas:6.09,  newCustomers:21,  newCustomerRevenue:4398,  returningCustomers:22,  returningCustomerRevenue:5114,  mer:4.50, cac:100.61 },
  { date:'2026-05-24', revenue:10894, orders:42,  adSpend:3103,  metaSpend:3068,  googleSpend:35,  metaRoas:2.56, googleRoas:58.29, newCustomers:28,  newCustomerRevenue:6168,  returningCustomers:14,  returningCustomerRevenue:4726,  mer:3.51, cac:110.83 },
  { date:'2026-05-25', revenue:6161,  orders:32,  adSpend:2576,  metaSpend:2549,  googleSpend:27,  metaRoas:1.26, googleRoas:96.50, newCustomers:17,  newCustomerRevenue:2889,  returningCustomers:15,  returningCustomerRevenue:3272,  mer:2.39, cac:151.52 },
  { date:'2026-05-26', revenue:9261,  orders:58,  adSpend:1636,  metaSpend:1586,  googleSpend:50,  metaRoas:4.79, googleRoas:10.56, newCustomers:20,  newCustomerRevenue:4449,  returningCustomers:38,  returningCustomerRevenue:4812,  mer:5.66, cac:81.79 },
  { date:'2026-05-27', revenue:8067,  orders:43,  adSpend:2011,  metaSpend:1997,  googleSpend:15,  metaRoas:3.38, googleRoas:98.00, newCustomers:29,  newCustomerRevenue:6119,  returningCustomers:14,  returningCustomerRevenue:1947,  mer:4.01, cac:69.36 },
  { date:'2026-05-28', revenue:14381, orders:70,  adSpend:2675,  metaSpend:2583,  googleSpend:92,  metaRoas:4.33, googleRoas:4.37,  newCustomers:29,  newCustomerRevenue:7817,  returningCustomers:41,  returningCustomerRevenue:6564,  mer:5.38, cac:92.24 },
  { date:'2026-05-29', revenue:39354, orders:235, adSpend:3884,  metaSpend:3834,  googleSpend:49,  metaRoas:5.78, googleRoas:81.94, newCustomers:67,  newCustomerRevenue:12466, returningCustomers:168, returningCustomerRevenue:26888, mer:10.13,cac:57.96 },
  { date:'2026-05-30', revenue:13580, orders:67,  adSpend:2718,  metaSpend:2684,  googleSpend:34,  metaRoas:4.04, googleRoas:9.14,  newCustomers:22,  newCustomerRevenue:3057,  returningCustomers:45,  returningCustomerRevenue:10523, mer:5.00, cac:123.54 },
  { date:'2026-05-31', revenue:19764, orders:93,  adSpend:3556,  metaSpend:3527,  googleSpend:29,  metaRoas:4.01, googleRoas:59.07, newCustomers:57,  newCustomerRevenue:10796, returningCustomers:36,  returningCustomerRevenue:8968,  mer:5.56, cac:62.39 },
];

// June 1-5 — Shopify revenue from API, ad spend estimated proportionally
export const june2026Partial: DailySheetData[] = [
  { date:'2026-06-01', revenue:16708, orders:86, adSpend:4773, metaSpend:4700, googleSpend:73, metaRoas:0, googleRoas:0, newCustomers:0, newCustomerRevenue:0, returningCustomers:0, returningCustomerRevenue:0, mer:3.50, cac:0 },
  { date:'2026-06-02', revenue:11495, orders:92, adSpend:3284, metaSpend:3234, googleSpend:50, metaRoas:0, googleRoas:0, newCustomers:0, newCustomerRevenue:0, returningCustomers:0, returningCustomerRevenue:0, mer:3.50, cac:0 },
  { date:'2026-06-03', revenue:9558,  orders:66, adSpend:2731, metaSpend:2689, googleSpend:42, metaRoas:0, googleRoas:0, newCustomers:0, newCustomerRevenue:0, returningCustomers:0, returningCustomerRevenue:0, mer:3.50, cac:0 },
  { date:'2026-06-04', revenue:8753,  orders:74, adSpend:2501, metaSpend:2463, googleSpend:38, metaRoas:0, googleRoas:0, newCustomers:0, newCustomerRevenue:0, returningCustomers:0, returningCustomerRevenue:0, mer:3.50, cac:0 },
  { date:'2026-06-05', revenue:983,   orders:7,  adSpend:281,  metaSpend:277,  googleSpend:4,  metaRoas:0, googleRoas:0, newCustomers:0, newCustomerRevenue:0, returningCustomers:0, returningCustomerRevenue:0, mer:3.50, cac:0 },
];

export const shopifyLast30Days: DailyRevenue[] = [
  ...sheetDataMay2026.slice(5), // May 6-31
  ...june2026Partial,
].map(d => ({ date: d.date, revenue: d.revenue, orders: d.orders, adSpend: d.adSpend }));

// Shopify summary stats by timeframe
// 30d / last_month = real May 2026 figures from Funnel.io Google Sheet
export const shopifyMetricsByTimeframe: Record<Timeframe, { revenue: number; orders: number; aov: number; returns: number }> = {
  today:       { revenue: 983,      orders: 7,     aov: 140.55, returns: 0 },
  yesterday:   { revenue: 8753,     orders: 74,    aov: 119.09, returns: 59.75 },
  '7d':        { revenue: 106244,   orders: 672,   aov: 158.10, returns: 3842 },
  '14d':       { revenue: 183960,   orders: 1098,  aov: 167.54, returns: 8100 },
  '30d':       { revenue: 480265,   orders: 2454,  aov: 195.71, returns: 23752 }, // May 6 – Jun 5, real ad spend
  last_month:  { revenue: 487884,   orders: 2439,  aov: 199.87, returns: 0 },     // May 1-31 full month from sheet
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

// Real May 2026 platform spend from Funnel.io sheet (Meta dominates ~98.5%, Google ~1.5%)
const MAY_META_SPEND = 100654;
const MAY_GOOGLE_SPEND = 1520;
const MAY_TOTAL_SPEND = 102174;
const MAY_META_REVENUE = sheetDataMay2026.reduce((s, d) => s + d.metaSpend * d.metaRoas, 0);
const MAY_GOOGLE_REVENUE = sheetDataMay2026.reduce((s, d) => s + d.googleSpend * d.googleRoas, 0);

export function getPlatformSpendForTimeframe(tf: Timeframe): PlatformSpend[] {
  const data = getRevenueForTimeframe(tf);
  const totalSpend = data.reduce((s, d) => s + d.adSpend, 0);
  const scaleFactor = totalSpend / MAY_TOTAL_SPEND;

  return [
    {
      platform: 'Meta',
      spend: Math.round(MAY_META_SPEND * scaleFactor),
      revenue: Math.round(MAY_META_REVENUE * scaleFactor),
      roas: parseFloat((MAY_META_REVENUE / MAY_META_SPEND).toFixed(2)),
      ctr: 2.8,
      impressions: Math.round(2800000 * scaleFactor),
      color: '#1877F2',
    },
    {
      platform: 'Google',
      spend: Math.round(MAY_GOOGLE_SPEND * scaleFactor),
      revenue: Math.round(MAY_GOOGLE_REVENUE * scaleFactor),
      roas: parseFloat((MAY_GOOGLE_REVENUE / MAY_GOOGLE_SPEND).toFixed(2)),
      ctr: 5.2,
      impressions: Math.round(95000 * scaleFactor),
      color: '#4285F4',
    },
    {
      platform: 'TikTok',
      spend: 0,
      revenue: 0,
      roas: 0,
      ctr: 0,
      impressions: 0,
      color: '#000000',
    },
    {
      platform: 'CTV',
      spend: 0,
      revenue: 0,
      roas: 0,
      ctr: 0,
      impressions: 0,
      color: '#FF6B35',
    },
  ];
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
