import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Loop Subscriptions admin API probe: shows what the store's token can read
// and the exact shape of a subscription, so the Subscriptions tab is built on
// Loop's real field names. Admin-only (middleware). Customer emails, names and
// addresses are masked in the sample.
const BASE = 'https://api.loopsubscriptions.com/admin/2026-04';

function mask(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice(0, 3).map(mask);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = /email|phone|name|address|first|last|zip|city/i.test(k) && typeof val === 'string' ? '•••' : mask(val);
    }
    return out;
  }
  return v;
}

export async function GET() {
  const token = (process.env.LOOP_API_TOKEN || '').trim();
  if (!token) return NextResponse.json({ error: 'LOOP_API_TOKEN is not set' });
  const tries = ['/subscription?pageNo=1&pageSize=2', '/subscription?page=1&limit=2', '/subscriptions?pageNo=1&pageSize=2', '/customer?pageNo=1&pageSize=1'];
  const results: Record<string, unknown> = {};
  for (const path of tries) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { 'X-Loop-Token': token, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      let body: unknown = text.slice(0, 500);
      try { body = mask(JSON.parse(text)); } catch { /* not JSON */ }
      results[path] = { status: res.status, body };
    } catch (e) {
      results[path] = { error: e instanceof Error ? e.message : String(e) };
    }
    await new Promise(r => setTimeout(r, 1600)); // Loop allows ~2 list calls per 3 s
  }
  return NextResponse.json({ base: BASE, results });
}
