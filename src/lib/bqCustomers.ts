import { runQuery, getDataset, dedupedOrdersCte } from '@/src/lib/bigquery';
import { CohortData } from '@/src/lib/mockData';

interface SummaryRow {
  first_avg: number | null;
  second_avg: number | null;
  third_plus_avg: number | null;
  active_customers: number | null;
  one_order: number | null;
  two_orders: number | null;
  three_plus: number | null;
  avg_ltv: number | null;
  ltv_one: number | null;
  ltv_two: number | null;
  ltv_three_plus: number | null;
}

// BigQuery-derived customer metrics for customers ACTIVE in the period.
// The returning-customer rate / customer counts come from Shopify (in the
// route) to match Shopify's own Customers report exactly; this provides the
// order-sequence AOV and the LTV tier breakdown (real counts, no estimates).
export interface BqCustomerMetrics {
  avgLTV: number;
  firstOrderAvg: number;
  secondOrderAvg: number;
  thirdPlusOrderAvg: number;
  activeCustomers: number;
  oneOrderCount: number;
  twoOrderCount: number;
  threePlusCount: number;
  ltvOneOrder: number;
  ltvTwoOrders: number;
  ltvThreePlus: number;
}

interface CohortRow {
  cohort_month: { value: string } | string;
  month_offset: number;
  active: number;
  cohort_size: number;
}

function dateStr(d: CohortRow['cohort_month']): string {
  return typeof d === 'string' ? d : d.value;
}

function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export async function getCustomerMetrics(dateFrom: string, dateTo: string): Promise<BqCustomerMetrics> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  const rows = await runQuery<SummaryRow>(`
    WITH order_revenue AS (${dedupedOrdersCte(ds)}),
    ranked AS (
      SELECT order_customer_id AS customer_id,
             total_price AS revenue,
             order_date,
             ROW_NUMBER() OVER (PARTITION BY order_customer_id ORDER BY order_date) AS seq
      FROM order_revenue
      WHERE order_customer_id IS NOT NULL
    ),
    -- Lifetime totals per customer (across all history, not just the period).
    lifetime AS (
      SELECT customer_id, COUNT(*) AS lifetime_orders, SUM(revenue) AS lifetime_revenue
      FROM ranked GROUP BY customer_id
    ),
    -- Customers who placed at least one order within the selected period.
    active AS (
      SELECT DISTINCT customer_id FROM ranked
      WHERE order_date BETWEEN @date_from AND @date_to
    ),
    -- AOV by lifetime order sequence, for orders placed within the period.
    seq_aov AS (
      SELECT
        AVG(IF(seq = 1, revenue, NULL))  AS first_avg,
        AVG(IF(seq = 2, revenue, NULL))  AS second_avg,
        AVG(IF(seq >= 3, revenue, NULL)) AS third_plus_avg
      FROM ranked
      WHERE order_date BETWEEN @date_from AND @date_to
    ),
    -- Real tier breakdown among active customers, by lifetime order count.
    tiers AS (
      SELECT
        COUNT(*) AS active_customers,
        COUNTIF(l.lifetime_orders = 1)  AS one_order,
        COUNTIF(l.lifetime_orders = 2)  AS two_orders,
        COUNTIF(l.lifetime_orders >= 3) AS three_plus,
        AVG(l.lifetime_revenue) AS avg_ltv,
        AVG(IF(l.lifetime_orders = 1,  l.lifetime_revenue, NULL)) AS ltv_one,
        AVG(IF(l.lifetime_orders = 2,  l.lifetime_revenue, NULL)) AS ltv_two,
        AVG(IF(l.lifetime_orders >= 3, l.lifetime_revenue, NULL)) AS ltv_three_plus
      FROM active a JOIN lifetime l USING (customer_id)
    )
    SELECT * FROM seq_aov, tiers
  `, params);

  const r = rows[0];
  const round2 = (v: number | null | undefined) => Math.round(Number(v || 0) * 100) / 100;

  return {
    avgLTV: round2(r?.avg_ltv),
    firstOrderAvg: round2(r?.first_avg),
    secondOrderAvg: round2(r?.second_avg),
    thirdPlusOrderAvg: round2(r?.third_plus_avg),
    activeCustomers: Number(r?.active_customers || 0),
    oneOrderCount: Number(r?.one_order || 0),
    twoOrderCount: Number(r?.two_orders || 0),
    threePlusCount: Number(r?.three_plus || 0),
    ltvOneOrder: round2(r?.ltv_one),
    ltvTwoOrders: round2(r?.ltv_two),
    ltvThreePlus: round2(r?.ltv_three_plus),
  };
}

export async function getCohortData(dateFrom: string, dateTo: string): Promise<CohortData[]> {
  const ds = getDataset();
  const params = { date_from: dateFrom, date_to: dateTo };

  // Cohorts are defined by first-order month; we show cohorts whose first
  // order falls within the selected period so the chart reflects the timeframe.
  const rows = await runQuery<CohortRow>(`
    WITH order_revenue AS (${dedupedOrdersCte(ds)}),
    orders AS (
      SELECT order_customer_id AS customer_id, order_date AS d
      FROM order_revenue
      WHERE order_customer_id IS NOT NULL
    ),
    first_order AS (
      SELECT customer_id, MIN(d) AS first_date FROM orders GROUP BY customer_id
    ),
    cohort_customers AS (
      SELECT customer_id, first_date FROM first_order
      WHERE first_date BETWEEN @date_from AND @date_to
    ),
    cohorted AS (
      SELECT o.customer_id,
             DATE_TRUNC(f.first_date, MONTH) AS cohort_month,
             DATE_DIFF(DATE_TRUNC(o.d, MONTH), DATE_TRUNC(f.first_date, MONTH), MONTH) AS month_offset
      FROM orders o
      JOIN cohort_customers f ON o.customer_id = f.customer_id
    ),
    cohort_sizes AS (
      SELECT cohort_month, COUNT(DISTINCT customer_id) AS cohort_size
      FROM cohorted WHERE month_offset = 0
      GROUP BY cohort_month
    )
    SELECT c.cohort_month, c.month_offset,
           COUNT(DISTINCT c.customer_id) AS active,
           s.cohort_size
    FROM cohorted c
    JOIN cohort_sizes s ON s.cohort_month = c.cohort_month
    WHERE c.month_offset BETWEEN 0 AND 5
    GROUP BY c.cohort_month, c.month_offset, s.cohort_size
    ORDER BY c.cohort_month DESC, c.month_offset
    LIMIT 60
  `, params);

  const byMonth: Record<string, CohortData & { size: number }> = {};

  for (const r of rows) {
    const month = dateStr(r.cohort_month);
    if (!byMonth[month]) {
      byMonth[month] = { cohort: monthLabel(month), month0: 0, month1: 0, month2: 0, month3: 0, month4: 0, month5: 0, size: Number(r.cohort_size) };
    }
    const pct = Math.round((Number(r.active) / Number(r.cohort_size)) * 1000) / 10;
    const key = `month${r.month_offset}` as 'month0' | 'month1' | 'month2' | 'month3' | 'month4' | 'month5';
    byMonth[month][key] = pct;
  }

  return Object.keys(byMonth)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 6)
    .map(m => {
      const { size, ...rest } = byMonth[m];
      void size;
      return rest;
    });
}
