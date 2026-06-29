import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || 'shop-rocknot.myshopify.com').trim();

// Lists every bag-ish row in the live inventory so we can walk through which
// are real handbags vs strap/bundle/closure variants. Read-only diagnostic.
//   /api/debug/bags
async function runShopifyQL(query: string) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        tableData { rows columns { name } } parseErrors
      }}`,
    }),
    next: { revalidate: 0 },
  });
  const json = await res.json();
  const q = json?.data?.shopifyqlQuery;
  const cols: { name: string }[] = q?.tableData?.columns || [];
  const rows: Array<Record<string, string> | string[]> = q?.tableData?.rows || [];
  const cell = (r: Record<string, string> | string[], name: string): string => {
    if (Array.isArray(r)) {
      const i = cols.findIndex(c => c.name === name);
      return i >= 0 ? (r[i] ?? '') : '';
    }
    return r[name] ?? '';
  };
  return { rows, cell, parseErrors: q?.parseErrors };
}

export async function GET() {
  const SINCE = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();
  const UNTIL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  try {
    const { rows, cell, parseErrors } = await runShopifyQL(
      `FROM inventory
       SHOW ending_inventory_units, inventory_units_sold, ending_inventory_value
       GROUP BY product_title, product_variant_title, product_type
       HAVING ending_inventory_units < 50000
       SINCE ${SINCE} UNTIL ${UNTIL}
       ORDER BY product_title
       LIMIT 2000`
    );

    // Anything plausibly a handbag, so nothing is missed in the walkthrough.
    const BAGISH = /\b(bag|clutch|tote|pouch|hobo|belt|fold ?over|drawstring|bucket|wristlet|crossbody|satchel|purse)\b/i;

    const bags = rows
      .map(r => ({
        product: cell(r, 'product_title') || '',
        variant: cell(r, 'product_variant_title') || '',
        category: cell(r, 'product_type') || '',
        units: Math.round(parseFloat(cell(r, 'ending_inventory_units') || '0')),
        sold90d: Math.round(parseFloat(cell(r, 'inventory_units_sold') || '0')),
        value: Math.round(parseFloat(cell(r, 'ending_inventory_value') || '0')),
      }))
      .filter(b => /handbag/i.test(b.category) || BAGISH.test(b.product))
      .sort((a, b) => a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant));

    // Distinct product titles, with how many variant rows each has and total units.
    const byProduct: Record<string, { variants: number; units: number; sold90d: number; hasStrapOrBundle: boolean }> = {};
    for (const b of bags) {
      if (!byProduct[b.product]) byProduct[b.product] = { variants: 0, units: 0, sold90d: 0, hasStrapOrBundle: false };
      const p = byProduct[b.product];
      p.variants += 1;
      p.units += b.units;
      p.sold90d += b.sold90d;
      if (/\+|strap|chain|crown|twin|lace|swing|snap/i.test(b.product + ' ' + b.variant)) p.hasStrapOrBundle = true;
    }

    return NextResponse.json({
      range: { from: SINCE, to: UNTIL },
      parseErrors: parseErrors || null,
      distinctProducts: Object.entries(byProduct)
        .map(([product, v]) => ({ product, ...v }))
        .sort((a, b) => a.product.localeCompare(b.product)),
      allRows: bags,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
