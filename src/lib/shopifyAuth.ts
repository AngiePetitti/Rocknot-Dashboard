// The Shopify Admin API token every Shopify call uses.
//
// Two ways a deployment connects to Shopify:
//   1. SHOPIFY_ACCESS_TOKEN — a permanent token (legacy custom apps and the
//      one-time /api/shopify/auth flow; Rocknot and Kailee P).
//   2. SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET — an app made in Shopify's
//      Dev Dashboard (the only kind a store can create since Jan 2026). These
//      apps never show a token: the dashboard trades the client id/secret for
//      one through the client credentials grant. Each token lasts ~24 hours,
//      so it is cached per serverless instance and renewed before it expires.
// A permanent token wins when both are set.
import { shopifyDomain } from '@/src/lib/client';

const STATIC_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

// Renew this long before Shopify's stated expiry.
const RENEW_MARGIN_MS = 10 * 60 * 1000;

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** True when this deployment has a store domain and some way to authenticate to it. */
export function shopifyConfigured(): boolean {
  return Boolean(shopifyDomain() && (STATIC_TOKEN || (CLIENT_ID && CLIENT_SECRET)));
}

async function fetchClientCredentialsToken(): Promise<string> {
  const res = await fetch(`https://${shopifyDomain()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text().catch(() => '');
  let json: { access_token?: string; expires_in?: number; error?: string; error_description?: string; errors?: unknown } | null = null;
  try { json = JSON.parse(text); } catch { /* Shopify sometimes answers with HTML or plain text */ }
  if (!res.ok || !json?.access_token) {
    // Surface Shopify's own reason (e.g. invalid_client, app not installed) — a bare status code can't be acted on.
    const detail = json?.error_description || json?.error || (json?.errors ? JSON.stringify(json.errors) : '') || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const why = `HTTP ${res.status}${detail ? ` (${detail})` : ''}`;
    throw new Error(`Shopify token request failed: ${why} — check SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET and that the app is installed on ${shopifyDomain()}`);
  }
  const lifetimeMs = (json.expires_in ?? 86400) * 1000;
  cached = { token: json.access_token, expiresAt: Date.now() + lifetimeMs };
  return json.access_token;
}

/** A valid Admin API access token. Throws when Shopify isn't configured or refuses the credentials. */
export async function shopifyToken(): Promise<string> {
  if (STATIC_TOKEN) return STATIC_TOKEN;
  if (!CLIENT_ID || !CLIENT_SECRET || !shopifyDomain()) throw new Error('Shopify not configured — set SHOPIFY_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
  if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;
  // One request per instance, however many callers ask at once.
  if (!inFlight) inFlight = fetchClientCredentialsToken().finally(() => { inFlight = null; });
  return inFlight;
}
