import { NextRequest, NextResponse } from 'next/server';
import { windsorOrganicRows, PINTEREST_ORGANIC_FIELDSETS, INSTAGRAM_FIELDSETS, fetchArticlesRaw, fetchArticlesFromFeed, fetchOgImages } from '@/src/lib/organic';
import { shopifyql } from '@/src/lib/shopifyql';
import { windsorAccount } from '@/src/lib/client';
import { todayPst, addDays } from '@/src/lib/timeframes';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Admin-only Organic Content audit (/api/debug/organic?days=7): every field
// set tried against Windsor's Pinterest Organic and Instagram feeds with the
// error Windsor returned (its error lists the fields it knows), the
// accounts Windsor exposes for each source (unscoped — to pick this
// client's ids for the profile), and the blog articles Shopify returns.
export async function GET(request: NextRequest) {
  const days = Math.max(1, Math.min(90, Number(request.nextUrl.searchParams.get('days') || 7)));
  const to = todayPst();
  const from = addDays(to, -days);
  const key = (process.env.WINDSOR_API_KEY || '').trim();
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), range: { from, to }, scoping: { pinterest_organic: windsorAccount('pinterest_organic'), instagram: windsorAccount('instagram') } };

  const listAccounts = async (source: string) => {
    if (!key) return { error: 'WINDSOR_API_KEY missing' };
    try {
      const qs = new URLSearchParams({ api_key: key, fields: 'account_id,account_name', date_from: from, date_to: to, _renderer: 'json' });
      const res = await fetch(`https://connectors.windsor.ai/${source}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (json.error || !Array.isArray(json.data)) return { error: String(json.error || json.message || `HTTP ${res.status}`) };
      const seen = new Map<string, string>();
      for (const r of json.data as Array<Record<string, unknown>>) seen.set(String(r.account_id ?? ''), String(r.account_name ?? ''));
      return { accounts: Array.from(seen.entries()).map(([id, name]) => ({ id, name })) };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  };

  const [pinAccounts, igAccounts, pin, ig, articles] = await Promise.all([
    listAccounts('pinterest_organic'),
    listAccounts('instagram'),
    windsorOrganicRows('pinterest_organic', PINTEREST_ORGANIC_FIELDSETS, from, to, 60000),
    windsorOrganicRows('instagram', INSTAGRAM_FIELDSETS, from, to, 25000),
    fetchArticlesRaw().then(r => ({ status: r.status, errors: r.errors, count: r.nodes.length, sample: r.nodes.slice(0, 10).map(a => ({ path: `/blogs/${a.blog.handle}/${a.handle}`, title: a.title, image: Boolean(a.image?.url), publishedAt: a.publishedAt })) })).catch(e => ({ error: String(e) })),
  ]);
  // Blog landing paths Shopify's sessions report saw in the window (the
  // traffic half of the blog table, independent of the Admin API scope).
  out.blogLandingPaths = await shopifyql(`FROM sessions SHOW sessions GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`, { timeoutMs: 20000 })
    .then(rows => rows.filter(r => /^\/blogs\//.test(String(r.landing_page_path || ''))).slice(0, 15))
    .catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  out.windsorAccounts = { pinterest_organic: pinAccounts, instagram: igAccounts };
  out.pinterestOrganic = { notConnected: pin.notConnected, fieldSet: pin.fieldSet, rowCount: pin.rows?.length ?? 0, attempts: pin.attempts };

  // Direct Pinterest API path: configuration only (the live pull is slow and is
  // exercised by the tab itself once the connection exists).
  try {
    const { pinterestOrganicDirectConfigured, pinterestActingAccount } = await import('@/src/lib/pinterestOrganicDirect');
    const { pinterestConnectionStatus } = await import('@/src/lib/pinterestAuth');
    out.pinterestDirect = { configured: pinterestOrganicDirectConfigured(), connection: await pinterestConnectionStatus(), actingAdAccount: pinterestActingAccount() };
  } catch (e) { out.pinterestDirect = { error: e instanceof Error ? e.message : String(e) }; }
  // BigQuery table path (preferred once the Windsor → BigQuery task exists).
  try {
    const { fetchPinterestOrganicFromTable } = await import('@/src/lib/organic');
    const t = await fetchPinterestOrganicFromTable(from, to);
    out.pinterestTable = t ? { status: t.status, error: t.error, items: t.items.length, sample: t.items.slice(0, 2) } : { status: 'no pinterest_organic table in BigQuery yet' };
    // What the table actually holds, so a column-name mismatch is visible at a glance.
    try {
      const { runQuery, getDataset, isBigQueryConfigured } = await import('@/src/lib/bigquery');
      if (isBigQueryConfigured()) {
        const ds = getDataset();
        const cols = await runQuery<{ column_name: string; data_type: string }>(`SELECT column_name, data_type FROM \`${ds}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'pinterest_organic' ORDER BY ordinal_position`);
        const shape = cols.length ? await runQuery<Record<string, unknown>>(`SELECT COUNT(*) AS rows, CAST(MIN(date) AS STRING) AS first_date, CAST(MAX(date) AS STRING) AS last_date FROM \`${ds}.pinterest_organic\``) : [];
        const sampleRow = cols.length ? await runQuery<Record<string, unknown>>(`SELECT * FROM \`${ds}.pinterest_organic\` ORDER BY date DESC LIMIT 1`) : [];
        out.pinterestTableShape = { columns: cols.map(c => `${c.column_name}:${c.data_type}`), ...(shape[0] || {}), latestRow: sampleRow[0] || null };
      }
    } catch (e) { out.pinterestTableShape = { error: e instanceof Error ? e.message : String(e) }; }
  } catch (e) { out.pinterestTable = { error: e instanceof Error ? e.message : String(e) }; }
  out.instagram = { notConnected: ig.notConnected, fieldSet: ig.fieldSet, rowCount: ig.rows?.length ?? 0, attempts: ig.attempts };
  out.shopifyArticles = articles;
  out.ogImageProbe = await fetchOgImages(['/blogs/news/the-most-comfortable-wedding-shoes-that-brides-actually-wear-all-day']).then(m => Array.from(m.entries())).catch(e => ({ error: String(e) }));
  out.blogFeedArticles = await fetchArticlesFromFeed(['news', 'press']).then(m => ({ count: m.size, sample: Array.from(m.entries()).slice(0, 5).map(([path, a]) => ({ path, title: a.title, image: Boolean(a.imageUrl), publishedAt: a.publishedAt })) })).catch(e => ({ error: String(e) }));
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
