import { NextRequest, NextResponse } from 'next/server';
import { windsorOrganicRows, PINTEREST_ORGANIC_FIELDSETS, INSTAGRAM_FIELDSETS, fetchArticles } from '@/src/lib/organic';
import { windsorAccount } from '@/src/lib/client';
import { todayPst, addDays } from '@/src/lib/timeframes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const out: Record<string, unknown> = { range: { from, to }, scoping: { pinterest_organic: windsorAccount('pinterest_organic'), instagram: windsorAccount('instagram') } };

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
    windsorOrganicRows('pinterest_organic', PINTEREST_ORGANIC_FIELDSETS, from, to),
    windsorOrganicRows('instagram', INSTAGRAM_FIELDSETS, from, to),
    fetchArticles().then(m => Array.from(m.entries()).slice(0, 10).map(([path, a]) => ({ path, title: a.title, image: Boolean(a.imageUrl), publishedAt: a.publishedAt }))).catch(e => ({ error: String(e) })),
  ]);
  out.windsorAccounts = { pinterest_organic: pinAccounts, instagram: igAccounts };
  out.pinterestOrganic = { notConnected: pin.notConnected, fieldSet: pin.fieldSet, rowCount: pin.rows?.length ?? 0, attempts: pin.attempts };
  out.instagram = { notConnected: ig.notConnected, fieldSet: ig.fieldSet, rowCount: ig.rows?.length ?? 0, attempts: ig.attempts };
  out.shopifyArticles = articles;
  return NextResponse.json(out);
}
