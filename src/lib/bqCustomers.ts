import { runQuery, getDataset, dedupedOrdersCte } from '@/src/lib/bigquery';
import { CustomerMetrics, CohortData } from '@/src/lib/mockData';

interface SummaryRow {
  total_customers: number;
  repeat_customers: number;
  total_revenue: number | null;
  first_avg: number | null;
  second_avg: number | null;
  third_plus_avg: number | null;
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

export async function getCustomerMetrics(): Promise<CustomerMetrics> {
  const ds = getDataset();

  const rows = await runQuery<SummaryRow>(`
    WITH order_revenue AS (${dedupedOrdersCte(ds)}),
    ranked AS (
      SELECT order_customer_id AS customer_id,
             total_price AS revenue,
             ROW_NUMBER() OVER (PARTITION BY order_customer_id ORDER BY order_date) AS seq
      FROM order_revenue
      WHERE order_customer_id IS NOT NULL
    )
    SELECT
      COUNT(DISTINCT customer_id) AS total_customers,
      COUNT(DISTINCT IF(seq >= 2, customer_id, NULL)) AS repeat_customers,
      SUM(revenue) AS total_revenue,
      AVG(IF(seq = 1, revenue, NULL)) AS first_avg,
      AVG(IF(seq = 2, revenue, NULL)) AS second_avg,
      AVG(IF(seq >= 3, revenue, NULL)) AS third_plus_avg
    FROM ranked
  `);

  const r = rows[0];
  const totalCustomers = Number(r?.total_customers || 0);
  const repeatCustomers = Number(r?.repeat_customers || 0);
  const totalRevenue = Number(r?.total_revenue || 0);

  return {
    repeatPurchaserRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0,
    avgLTV: totalCustomers > 0 ? Math.round((totalRevenue / totalCustomers) * 100) / 100 : 0,
    firstOrderAvg: Math.round(Number(r?.first_avg || 0) * 100) / 100,
    secondOrderAvg: Math.round(Number(r?.second_avg || 0) * 100) / 100,
    thirdPlusOrderAvg: Math.round(Number(r?.third_plus_avg || 0) * 100) / 100,
    totalCustomers,
    repeatCustomers,
  };
}

export async function getCohortData(): Promise<CohortData[]> {
  const ds = getDataset();

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
    cohorted AS (
      SELECT o.customer_id,
             DATE_TRUNC(f.first_date, MONTH) AS cohort_month,
             DATE_DIFF(DATE_TRUNC(o.d, MONTH), DATE_TRUNC(f.first_date, MONTH), MONTH) AS month_offset
      FROM orders o
      JOIN first_order f ON o.customer_id = f.customer_id
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
  `);

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
