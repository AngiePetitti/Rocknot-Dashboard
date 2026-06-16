import { runQuery, getDataset } from '@/src/lib/bigquery';

export interface ProductSales {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  percentOfTotal: number;
}

interface ProductRow {
  line_item__title: string | null;
  line_item__product_type: string | null;
  total_quantity: number | null;
  total_revenue: number | null;
}

export async function getProductSales(dateFrom: string, dateTo: string): Promise<{
  products: ProductSales[];
  totalRevenue: number;
  totalUnits: number;
}> {
  const ds = getDataset();

  const sql = `
    SELECT
      line_item__title,
      line_item__product_type,
      SUM(CAST(line_item__quantity AS FLOAT64))  AS total_quantity,
      SUM(CAST(line_item__price   AS FLOAT64))  AS total_revenue
    FROM \`${ds}.shopify_products\`
    WHERE DATE(date) BETWEEN @date_from AND @date_to
      AND line_item__title IS NOT NULL
      AND line_item__title != ''
    GROUP BY line_item__title, line_item__product_type
    HAVING total_revenue > 0
    ORDER BY total_revenue DESC
    LIMIT 50
  `;

  const rows = await runQuery<ProductRow>(sql, { date_from: dateFrom, date_to: dateTo });

  const products: ProductSales[] = rows.map((r, i) => ({
    id: String(i),
    name: r.line_item__title || 'Unknown',
    category: r.line_item__product_type || 'Other',
    unitsSold: Math.round(Number(r.total_quantity || 0)),
    revenue: Math.round(Number(r.total_revenue || 0)),
    percentOfTotal: 0,
  }));

  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const totalUnits = products.reduce((s, p) => s + p.unitsSold, 0);
  for (const p of products) {
    p.percentOfTotal = totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 1000) / 10 : 0;
  }

  return { products, totalRevenue, totalUnits };
}
