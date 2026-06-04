// Mock data for Rocknot Dashboard
// Realistic DTC brand doing ~$50k-100k/month

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

// ─── Revenue Data ────────────────────────────────────────────────────────────

function generateDailyRevenue(days: number, baseRevenue: number): DailyRevenue[] {
  const data: DailyRevenue[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    const weekendMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 1.3 : 1;
    const variance = 0.8 + Math.random() * 0.4;
    const revenue = Math.round(baseRevenue * weekendMultiplier * variance);
    const orders = Math.round(revenue / 67);
    const adSpend = Math.round(revenue / 3.8 * (0.9 + Math.random() * 0.2));
    data.push({
      date: d.toISOString().split('T')[0],
      revenue,
      orders,
      adSpend,
    });
  }
  return data;
}

export const revenueData180 = generateDailyRevenue(180, 2400);

export function getRevenueForTimeframe(tf: Timeframe): DailyRevenue[] {
  const all = revenueData180;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (tf) {
    case 'today':
      return all.slice(-1).map(d => ({ ...d, revenue: Math.round(d.revenue * 0.6) }));
    case 'yesterday':
      return all.slice(-2, -1);
    case '7d':
      return all.slice(-7);
    case '14d':
      return all.slice(-14);
    case '30d':
      return all.slice(-30);
    case 'last_month': {
      const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return all.filter(d => {
        const date = new Date(d.date);
        return date >= firstOfLastMonth && date < firstOfThisMonth;
      });
    }
    case '6m':
      return all.slice(-180);
    case 'ytd': {
      const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
      return all.filter(d => d.date >= startOfYear);
    }
    default:
      return all.slice(-30);
  }
}

export function getMetricsForTimeframe(tf: Timeframe) {
  const data = getRevenueForTimeframe(tf);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const totalAdSpend = data.reduce((s, d) => s + d.adSpend, 0);
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const mer = totalAdSpend > 0 ? totalRevenue / totalAdSpend : 0;
  return { totalRevenue, totalOrders, totalAdSpend, aov, mer };
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

// ─── Products ────────────────────────────────────────────────────────────────

export function getTopProductsForTimeframe(tf: Timeframe): Product[] {
  const data = getRevenueForTimeframe(tf);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);

  const baseProducts = [
    { id: '1', name: 'Rocknot Classic Tee', category: 'Apparel', pct: 0.22 },
    { id: '2', name: 'Festival Hoodie', category: 'Apparel', pct: 0.18 },
    { id: '3', name: 'Rocknot Cap', category: 'Accessories', pct: 0.14 },
    { id: '4', name: 'Limited Drop Jacket', category: 'Apparel', pct: 0.12 },
    { id: '5', name: 'Graphic Longsleeve', category: 'Apparel', pct: 0.10 },
    { id: '6', name: 'Rocknot Tote Bag', category: 'Accessories', pct: 0.08 },
    { id: '7', name: 'Music Lover Socks 3-Pack', category: 'Accessories', pct: 0.07 },
    { id: '8', name: 'Band Collab Tee', category: 'Apparel', pct: 0.05 },
    { id: '9', name: 'Bucket Hat', category: 'Accessories', pct: 0.03 },
    { id: '10', name: 'Wristband Bundle', category: 'Accessories', pct: 0.01 },
  ];

  return baseProducts.map(p => {
    const revenue = Math.round(totalRevenue * p.pct);
    const avgPrice = 45 + Math.random() * 30;
    const unitsSold = Math.round(revenue / avgPrice);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      revenue,
      unitsSold,
      percentOfTotal: p.pct * 100,
    };
  });
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
  { name: 'Festival Hoodie', purchaseCount: 612, pct: 37.1 },
  { name: 'Rocknot Classic Tee', purchaseCount: 498, pct: 30.2 },
  { name: 'Limited Drop Jacket', purchaseCount: 284, pct: 17.2 },
  { name: 'Rocknot Cap', purchaseCount: 198, pct: 12.0 },
  { name: 'Band Collab Tee', purchaseCount: 57, pct: 3.5 },
];

// ─── Inventory ────────────────────────────────────────────────────────────────

export const inventoryData: InventoryItem[] = [
  { id: '1', name: 'Rocknot Classic Tee - S', sku: 'RCT-S', stock: 48, soldPerDay: 8.2, daysRemaining: 5.9, reorderQty: 200, category: 'Apparel' },
  { id: '2', name: 'Rocknot Classic Tee - M', sku: 'RCT-M', stock: 112, soldPerDay: 11.4, daysRemaining: 9.8, reorderQty: 300, category: 'Apparel' },
  { id: '3', name: 'Rocknot Classic Tee - L', sku: 'RCT-L', stock: 89, soldPerDay: 9.8, daysRemaining: 9.1, reorderQty: 250, category: 'Apparel' },
  { id: '4', name: 'Festival Hoodie - M', sku: 'FH-M', stock: 23, soldPerDay: 5.6, daysRemaining: 4.1, reorderQty: 150, category: 'Apparel' },
  { id: '5', name: 'Festival Hoodie - L', sku: 'FH-L', stock: 67, soldPerDay: 4.8, daysRemaining: 14.0, reorderQty: 120, category: 'Apparel' },
  { id: '6', name: 'Rocknot Cap - One Size', sku: 'RC-OS', stock: 188, soldPerDay: 7.2, daysRemaining: 26.1, reorderQty: 200, category: 'Accessories' },
  { id: '7', name: 'Limited Drop Jacket - M', sku: 'LDJ-M', stock: 12, soldPerDay: 2.8, daysRemaining: 4.3, reorderQty: 80, category: 'Apparel' },
  { id: '8', name: 'Limited Drop Jacket - L', sku: 'LDJ-L', stock: 31, soldPerDay: 2.2, daysRemaining: 14.1, reorderQty: 60, category: 'Apparel' },
  { id: '9', name: 'Rocknot Tote Bag', sku: 'RTB-OS', stock: 245, soldPerDay: 4.1, daysRemaining: 59.8, reorderQty: 150, category: 'Accessories' },
  { id: '10', name: 'Music Lover Socks 3-Pack', sku: 'MLS-3P', stock: 74, soldPerDay: 6.3, daysRemaining: 11.7, reorderQty: 200, category: 'Accessories' },
  { id: '11', name: 'Graphic Longsleeve - S', sku: 'GLS-S', stock: 55, soldPerDay: 3.8, daysRemaining: 14.5, reorderQty: 100, category: 'Apparel' },
  { id: '12', name: 'Bucket Hat', sku: 'BH-OS', stock: 320, soldPerDay: 2.1, daysRemaining: 152.4, reorderQty: 80, category: 'Accessories' },
];

// ─── Returns ─────────────────────────────────────────────────────────────────

export const returnsByPlatform: ReturnData[] = [
  { platform: 'Meta', returnRate: 4.2, returns: 128, revenue: 68400, color: '#1877F2' },
  { platform: 'TikTok', returnRate: 5.8, returns: 87, revenue: 38200, color: '#000000' },
  { platform: 'Google', returnRate: 3.1, returns: 62, revenue: 48900, color: '#4285F4' },
  { platform: 'CTV', returnRate: 3.8, returns: 41, revenue: 29800, color: '#FF6B35' },
  { platform: 'Direct', returnRate: 2.4, returns: 38, revenue: 42100, color: '#96BF48' },
];

export const returnTrends: ReturnTrend[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const returns = Math.round(8 + Math.random() * 14);
  const returnRate = parseFloat((3.2 + Math.random() * 2.8).toFixed(1));
  return { date: d.toISOString().split('T')[0], returns, returnRate };
});

export const topReturnedProducts = [
  { name: 'Festival Hoodie - L', returns: 42, returnRate: 12.4, topReason: 'Sizing too small' },
  { name: 'Limited Drop Jacket - M', returns: 28, returnRate: 10.8, topReason: 'Different than expected' },
  { name: 'Rocknot Classic Tee - S', returns: 24, returnRate: 8.6, topReason: 'Sizing inconsistency' },
  { name: 'Graphic Longsleeve - S', returns: 19, returnRate: 7.2, topReason: 'Color not as shown' },
  { name: 'Bucket Hat', returns: 11, returnRate: 4.4, topReason: 'Fit issue' },
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
