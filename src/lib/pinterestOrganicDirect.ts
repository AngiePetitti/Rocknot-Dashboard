// Organic Pinterest pins straight from the Pinterest API, acting as the
// client's business through Business Access.
//
// Windsor's Pinterest Organic connector only lists the profiles the signed-in
// Pinterest user OWNS, so an agency login that reaches the client through
// Business Access never sees the client's profile. Pinterest's own API has a
// way through: user_account / pins / boards endpoints accept `ad_account_id`,
// and "if provided, the response is for the owner of that ad account" — the
// client's business. The dashboard already holds a Pinterest OAuth token
// (pinterestAuth.ts); this adds pins:read / boards:read / user_accounts:read.
import { getPinterestAccessToken, pinterestDirectConfigured } from '@/src/lib/pinterestAuth';
import { windsorAccount } from '@/src/lib/client';
import type { OrganicPost } from '@/src/lib/organic';

const API = 'https://api.pinterest.com/v5';
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));

export interface DirectAttempt { step: string; ok: boolean; detail?: string; count?: number }

async function pget<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json?.message || json?.error || ''}`.trim());
  return json as T;
}

/** The ad account used to act as the client's business (first configured Pinterest ad account). */
export function pinterestActingAccount(): string | null {
  const ids = (windsorAccount('pinterest') || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids[0] || null;
}

export function pinterestOrganicDirectConfigured(): boolean {
  return pinterestDirectConfigured() && Boolean(pinterestActingAccount());
}

interface PinItem {
  id: string; created_at?: string; link?: string; title?: string; description?: string; board_id?: string;
  media?: { media_type?: string; images?: Record<string, { url?: string }>; cover_image_url?: string };
  pin_metrics?: { '90d'?: Record<string, number>; lifetime_metrics?: Record<string, number> } | null;
}

/**
 * Pins with their metrics for a date range. Pinterest serves per-pin analytics
 * for the last 90 days only; older ranges get the pins' 90-day metrics with a
 * note. Returns the attempts so /api/debug/organic can show what happened.
 */
export async function fetchPinterestOrganicDirect(from: string, to: string): Promise<{ items: OrganicPost[]; attempts: DirectAttempt[]; note?: string; error?: string }> {
  const attempts: DirectAttempt[] = [];
  const acct = pinterestActingAccount();
  const token = await getPinterestAccessToken().catch(() => null);
  if (!acct || !token) return { items: [], attempts, error: !acct ? 'No Pinterest ad account configured to act through' : 'Pinterest is not connected (no token) — open /api/debug/pinterest-oauth' };

  // Boards → names.
  const boards = new Map<string, string>();
  try {
    let bookmark = '';
    for (let page = 0; page < 3; page++) {
      const r = await pget<{ items?: Array<{ id: string; name?: string }>; bookmark?: string | null }>(token, '/boards', { ad_account_id: acct, page_size: '100', ...(bookmark ? { bookmark } : {}) });
      for (const b of r.items || []) boards.set(b.id, str(b.name));
      if (!r.bookmark) break;
      bookmark = r.bookmark;
    }
    attempts.push({ step: 'boards', ok: true, count: boards.size });
  } catch (e) { attempts.push({ step: 'boards', ok: false, detail: e instanceof Error ? e.message : String(e) }); }

  // Pins (with 90-day metrics so the top ones can be picked for range analytics).
  const pins: PinItem[] = [];
  try {
    let bookmark = '';
    for (let page = 0; page < 4; page++) {
      const r = await pget<{ items?: PinItem[]; bookmark?: string | null }>(token, '/pins', { ad_account_id: acct, page_size: '100', pin_metrics: 'true', ...(bookmark ? { bookmark } : {}) });
      pins.push(...(r.items || []));
      if (!r.bookmark) break;
      bookmark = r.bookmark;
    }
    attempts.push({ step: 'pins', ok: true, count: pins.length });
  } catch (e) {
    attempts.push({ step: 'pins', ok: false, detail: e instanceof Error ? e.message : String(e) });
    return { items: [], attempts, error: `Pinterest pins: ${e instanceof Error ? e.message : String(e)}` };
  }

  const m90 = (p: PinItem) => p.pin_metrics?.['90d'] || {};
  const image = (p: PinItem) => {
    const imgs = p.media?.images || {};
    return str(imgs['600x']?.url || imgs['400x300']?.url || imgs['1200x']?.url || imgs['150x150']?.url || Object.values(imgs)[0]?.url || p.media?.cover_image_url);
  };
  const toPost = (p: PinItem, metrics: Record<string, number>): OrganicPost => ({
    id: p.id, platform: 'Pinterest',
    title: str(p.title) || str(p.description).replace(/\s+/g, ' ').trim().slice(0, 80) || `Pin ${p.id}`,
    imageUrl: image(p),
    url: `https://www.pinterest.com/pin/${p.id}/`,
    publishedAt: str(p.created_at).slice(0, 10),
    group: boards.get(str(p.board_id)) || '',
    metrics,
  });

  // Range analytics for the top pins (Pinterest: last 90 days only).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const ninetyAgo = new Date(Date.parse(today) - 89 * 86400000).toISOString().slice(0, 10);
  const inWindow = from >= ninetyAgo;
  const ranked = [...pins].sort((a, b) => num(m90(b).impression) - num(m90(a).impression));
  if (!inWindow) {
    const items = ranked.slice(0, 60).map(p => toPost(p, { impressions: num(m90(p).impression), saves: num(m90(p).save), pinClicks: num(m90(p).pin_click), outboundClicks: num(m90(p).outbound_click) }))
      .filter(p => Object.values(p.metrics).some(x => x > 0));
    return { items, attempts, note: `Pinterest's API serves pin analytics for the last 90 days only (from ${ninetyAgo}); these are each pin's 90-day figures, not ${from} → ${to}.` };
  }
  const top = ranked.slice(0, 48);
  const items: OrganicPost[] = [];
  let analyticsErr = '';
  for (let i = 0; i < top.length; i += 8) {
    const batch = top.slice(i, i + 8);
    const results = await Promise.all(batch.map(async p => {
      try {
        const r = await pget<{ all?: { lifetime_metrics?: Record<string, number>; daily_metrics?: Array<{ date: string; data_status?: string; metrics?: Record<string, number> }> } }>(
          token, `/pins/${p.id}/analytics`, { ad_account_id: acct, start_date: from, end_date: to > today ? today : to, metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK' });
        const daily = r.all?.daily_metrics || [];
        const sum = (k: string) => daily.length ? daily.reduce((s, d) => s + num(d.metrics?.[k]), 0) : num(r.all?.lifetime_metrics?.[k]);
        return toPost(p, { impressions: sum('IMPRESSION'), saves: sum('SAVE'), pinClicks: sum('PIN_CLICK'), outboundClicks: sum('OUTBOUND_CLICK') });
      } catch (e) { analyticsErr = e instanceof Error ? e.message : String(e); return null; }
    }));
    for (const r of results) if (r) items.push(r);
  }
  attempts.push({ step: 'pin analytics', ok: items.length > 0, count: items.length, detail: analyticsErr || undefined });
  const kept = items.filter(p => Object.values(p.metrics).some(x => x > 0)).sort((a, b) => b.metrics.impressions - a.metrics.impressions);
  if (!kept.length && analyticsErr) return { items: [], attempts, error: `Pinterest pin analytics: ${analyticsErr}` };
  return { items: kept, attempts, note: pins.length > top.length ? `Top ${top.length} of ${pins.length} pins by 90-day impressions.` : undefined };
}
