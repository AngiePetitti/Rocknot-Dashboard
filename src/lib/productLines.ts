import { runShopifyQLRaw } from '@/src/lib/shopifyql';
import { runQuery, getDataset, isBigQueryConfigured, tableExists } from '@/src/lib/bigquery';
import { productLines, lineForProduct, shopifyDomain, metaAccountSql, hasPlatform, PLATFORMS, ProductLine, storeOnlyWhere } from '@/src/lib/client';

// Per-product-line split of the Overview (e.g. women's vs kids):
//   revenue + orders  — ShopifyQL grouped by product_type (Shopify's own numbers)
//   ad spend          — BigQuery ad tables, campaign name matched per line
//   cost per order    — line spend ÷ line orders, against the line's target
// An order containing both lines' products counts toward both lines' order
// counts (that is how Shopify reports orders by product type).

export interface LineResult {
  key: string;
  label: string;
  netSales: number;
  totalSales: number;
  orders: number;
  shareOfNet: number;      // 0–1 share of net sales across lines
  spend: number;
  spendByPlatform: Record<string, number>;
  mer: number | null;      // netSales ÷ spend
  cpa: number | null;      // spend ÷ orders
  targetCpa: number;
  revenueShare: number;    // planned share, from the profile
}

const SHOPIFY_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();

async function shopifyByProductType(from: string, to: string): Promise<Array<{ productType: string; netSales: number; totalSales: number; orders: number }>> {
  if (!SHOPIFY_TOKEN) throw new Error('SHOPIFY_ACCESS_TOKEN not set');
  const ql = `FROM sales SHOW net_sales, total_sales, orders GROUP BY product_type ${storeOnlyWhere()} SINCE ${from} UNTIL ${to}`;
  const q = { tableData: await runShopifyQLRaw(ql, { timeoutMs: 12000 }) };
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) { const i = cols.findIndex(c => c.name === name); return i >= 0 ? (r[i] ?? '') : ''; }
    return r[name] ?? '';
  };
  return rows.map(r => ({
    productType: cell(r, 'product_type') || '',
    netSales: parseFloat(cell(r, 'net_sales') || '0') || 0,
    totalSales: parseFloat(cell(r, 'total_sales') || '0') || 0,
    orders: Math.round(parseFloat(cell(r, 'orders') || '0')) || 0,
  }));
}

/** SQL CASE assigning each campaign row to a line key. */
function lineCaseSql(lines: ProductLine[]): string {
  const def = lines.find(l => l.isDefault) ?? lines[0];
  const whens = lines
    .filter(l => !l.isDefault && l.campaignMatch)
    .map(l => `WHEN REGEXP_CONTAINS(LOWER(CAST(campaign AS STRING)), r'${l.campaignMatch.replace(/'/g, '')}') THEN '${l.key}'`)
    .join(' ');
  return `CASE ${whens} ELSE '${def.key}' END`;
}

async function spendByLine(from: string, to: string, lines: ProductLine[]): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  if (!isBigQueryConfigured()) return out;
  const ds = getDataset();
  const platforms = Object.values(PLATFORMS).filter(p => hasPlatform(p.key));
  await Promise.all(platforms.map(async p => {
    try {
      if (!(await tableExists(p.bqTable))) return;
      const extra = p.bqTable === 'facebook_ads' ? metaAccountSql() : '';
      const rows = await runQuery<{ line: string; spend: number | null }>(
        `SELECT ${lineCaseSql(lines)} AS line, SUM(CAST(spend AS FLOAT64)) AS spend
         FROM \`${ds}.${p.bqTable}\`
         WHERE DATE(date) BETWEEN @from AND @to${extra}
         GROUP BY line`,
        { from, to }
      );
      for (const r of rows) {
        (out[r.line] = out[r.line] || {})[p.label] = Number(r.spend || 0);
      }
    } catch { /* platform table missing or query failed — that platform contributes no spend */ }
  }));
  return out;
}

export interface ProductTypeRow { productType: string; line: string; netSales: number; orders: number }

export async function getProductLineSplit(from: string, to: string): Promise<{ lines: LineResult[]; unmatchedProductTypes: string[]; productTypes: ProductTypeRow[]; shopifyError?: string }> {
  const lines = productLines();
  if (lines.length === 0) return { lines: [], unmatchedProductTypes: [], productTypes: [] };

  const [shopifyRows, spend] = await Promise.all([
    shopifyByProductType(from, to).catch((e: unknown) => ({ error: String(e instanceof Error ? e.message : e) })),
    spendByLine(from, to, lines),
  ]);

  const acc: Record<string, { netSales: number; totalSales: number; orders: number }> = {};
  for (const l of lines) acc[l.key] = { netSales: 0, totalSales: 0, orders: 0 };
  const unmatched: string[] = [];
  const productTypes: ProductTypeRow[] = [];
  let shopifyError: string | undefined;
  if (Array.isArray(shopifyRows)) {
    for (const r of shopifyRows) {
      const line = lineForProduct(r.productType, lines);
      productTypes.push({ productType: r.productType || '(blank)', line: line?.key ?? '(none)', netSales: Math.round(r.netSales), orders: r.orders });
      if (!line) { unmatched.push(r.productType); continue; }
      acc[line.key].netSales += r.netSales;
      acc[line.key].totalSales += r.totalSales;
      acc[line.key].orders += r.orders;
    }
  } else {
    shopifyError = shopifyRows.error;
  }
  const totalNet = Object.values(acc).reduce((s, a) => s + a.netSales, 0);

  const result: LineResult[] = lines.map(l => {
    const a = acc[l.key];
    const byPlatform = spend[l.key] || {};
    const lineSpend = Object.values(byPlatform).reduce((s, v) => s + v, 0);
    return {
      key: l.key,
      label: l.label,
      netSales: Math.round(a.netSales),
      totalSales: Math.round(a.totalSales),
      orders: a.orders,
      shareOfNet: totalNet > 0 ? Math.round((a.netSales / totalNet) * 1000) / 1000 : 0,
      spend: Math.round(lineSpend * 100) / 100,
      spendByPlatform: Object.fromEntries(Object.entries(byPlatform).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      mer: lineSpend > 0 ? Math.round((a.netSales / lineSpend) * 100) / 100 : null,
      cpa: a.orders > 0 && lineSpend > 0 ? Math.round((lineSpend / a.orders) * 100) / 100 : null,
      targetCpa: l.targetCpa,
      revenueShare: l.revenueShare,
    };
  });
  productTypes.sort((a, b) => b.netSales - a.netSales);
  return { lines: result, unmatchedProductTypes: unmatched, productTypes, ...(shopifyError ? { shopifyError } : {}) };
}
