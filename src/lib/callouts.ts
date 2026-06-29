// Login briefing for the Overview tab. A deterministic rules engine that scans
// across ads, customers, inventory and returns and surfaces the handful of
// things worth knowing — split into what's going well and what needs attention.
// No LLM: fast, free, and the numbers are exact and reproducible.

export interface Callout {
  title: string;   // short headline
  detail: string;  // one-line specifics with real numbers
}

export interface CalloutResult {
  good: Callout[];
  attention: Callout[];
}

interface Metrics {
  totalRevenue?: number;
  totalAdSpend?: number;
  mer?: number;
  totalOrders?: number;
  newCustomers?: number;
  returningCustomers?: number;
  pctNew?: number;
  conversionRate?: number;
}

interface Prior {
  totalRevenue?: number;
  mer?: number;
}

interface InventoryItemLite {
  product: string;
  variant: string;
  status: string;
  dailyVelocity: number;
}

interface Inventory {
  critical?: number;
  low?: number;
  items?: InventoryItemLite[];
  finance?: { slowStockCostValue?: number; slowStockCount?: number; totalCostValue?: number } | null;
}

interface Returns {
  returnRate?: number; // percent
  topReturnedProducts?: Array<{ name: string; returnRate: number }>;
}

export interface CalloutInput {
  metrics: Metrics;
  prior?: Prior | null;
  inventory?: Inventory | null;
  returns?: Returns | null;
  merGoal: number;
  targetCac: number;
  comparing: boolean;
}

const money = (n: number): string => {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};

export function buildCallouts(input: CalloutInput): CalloutResult {
  const { metrics: m, prior, inventory, returns, merGoal, targetCac, comparing } = input;
  const good: Callout[] = [];
  const attention: Callout[] = [];

  // ── Marketing efficiency (MER) ──
  if (m.mer && m.mer > 0) {
    if (m.mer >= merGoal) {
      good.push({ title: 'MER above goal', detail: `Blended MER is ${m.mer.toFixed(2)}x, above your ${merGoal}x target.` });
    } else {
      attention.push({ title: 'MER below goal', detail: `Blended MER is ${m.mer.toFixed(2)}x, under your ${merGoal}x target — every $1 of ad spend is returning less than planned.` });
    }
  }

  // ── New-customer CAC vs target ──
  if (m.newCustomers && m.newCustomers > 0 && m.totalAdSpend) {
    const cac = m.totalAdSpend / m.newCustomers;
    if (cac > targetCac) {
      attention.push({ title: 'CAC over target', detail: `New-customer CAC is ${money(cac)}, above your ${money(targetCac)} target — acquisition is getting expensive.` });
    } else {
      good.push({ title: 'CAC under target', detail: `New-customer CAC is ${money(cac)}, under your ${money(targetCac)} target.` });
    }
  }

  // ── Revenue vs prior period (only meaningful when comparing) ──
  if (comparing && prior && prior.totalRevenue && m.totalRevenue) {
    const pct = Math.round(((m.totalRevenue - prior.totalRevenue) / prior.totalRevenue) * 100);
    if (pct >= 5) good.push({ title: 'Revenue growing', detail: `Revenue ${money(m.totalRevenue)} — up ${pct}% vs the prior period.` });
    else if (pct <= -5) attention.push({ title: 'Revenue slipping', detail: `Revenue ${money(m.totalRevenue)} — down ${Math.abs(pct)}% vs the prior period.` });
  }

  // ── Website conversion rate ──
  if (m.conversionRate && m.conversionRate > 0) {
    if (m.conversionRate >= 3) good.push({ title: 'Strong conversion', detail: `Site is converting at ${m.conversionRate.toFixed(1)}% of sessions.` });
    else if (m.conversionRate < 1.5) attention.push({ title: 'Low conversion', detail: `Site is converting at only ${m.conversionRate.toFixed(1)}% — below the ~2% benchmark. Worth checking PDP/checkout.` });
  }

  // ── New vs returning mix ──
  if (m.pctNew !== undefined && (m.newCustomers || m.returningCustomers)) {
    if (m.pctNew >= 55) good.push({ title: 'Healthy new-customer flow', detail: `${m.pctNew.toFixed(0)}% of buyers this period are brand-new.` });
    else if (m.pctNew < 25) attention.push({ title: 'Few new customers', detail: `Only ${m.pctNew.toFixed(0)}% of buyers are new — growth is leaning on repeat buyers.` });
  }

  // ── Returns (reflects the selected period) ──
  if (returns && returns.returnRate !== undefined && returns.returnRate > 0) {
    if (returns.returnRate > 15) {
      attention.push({ title: 'Return rate high', detail: `Returns are ${returns.returnRate.toFixed(1)}% of sales this period.` });
    } else if (returns.returnRate <= 8) {
      good.push({ title: 'Returns in check', detail: `Return rate is ${returns.returnRate.toFixed(1)}% of sales — healthy for the category.` });
    }
    const worst = returns.topReturnedProducts?.find(p => p.returnRate >= 30);
    if (worst) attention.push({ title: 'High-return product', detail: `${worst.name} is being returned ${worst.returnRate.toFixed(0)}% of the time — check sizing/quality.` });
  }

  // ── Inventory (current stock, independent of the date range) ──
  if (inventory) {
    const fastOOS = (inventory.items ?? [])
      .filter(i => i.status === 'out_of_stock' && i.dailyVelocity >= 0.25)
      .sort((a, b) => b.dailyVelocity - a.dailyVelocity);
    if (fastOOS.length) {
      const top = fastOOS[0];
      const name = `${top.product}${top.variant ? ' – ' + top.variant : ''}`;
      attention.push({
        title: 'Bestsellers out of stock',
        detail: `${fastOOS.length} fast-selling item${fastOOS.length > 1 ? 's are' : ' is'} out of stock — e.g. ${name} (~${Math.round(top.dailyVelocity * 7)}/wk). Lost sales until restocked.`,
      });
    }

    if (inventory.critical && inventory.critical > 0) {
      attention.push({ title: 'Items critically low', detail: `${inventory.critical} item${inventory.critical > 1 ? 's have' : ' has'} under a week of stock left at current pace.` });
    }

    const fin = inventory.finance;
    if (fin?.slowStockCount && fin.slowStockCount > 0 && fin.slowStockCostValue) {
      attention.push({ title: 'Cash stuck in slow stock', detail: `${money(fin.slowStockCostValue)} tied up in ${fin.slowStockCount} slow/dead item${fin.slowStockCount > 1 ? 's' : ''} (>1yr of supply or no sales).` });
    }
  }

  return { good, attention };
}
