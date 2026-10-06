// Direct Pinterest Ads API auth (OAuth 2.0). Pinterest access tokens are
// short-lived; the refresh token (valid a year, renewed on every refresh)
// is persisted in the private sheet's Settings tab, so a one-time connect
// via /api/debug/pinterest-oauth keeps working. PINTEREST_ACCESS_TOKEN in
// env overrides everything (handy for a quick test with a portal token).
import { getKV, setKV } from '@/src/lib/chatStore';

const APP_ID = (process.env.PINTEREST_APP_ID || '').trim();
const APP_SECRET = (process.env.PINTEREST_APP_SECRET || '').trim();
const ENV_TOKEN = (process.env.PINTEREST_ACCESS_TOKEN || '').trim();

// ads:read for the Ads tab; pins / boards / user_accounts for Organic Content
// (read through Business Access by naming the client's ad account).
export const PINTEREST_SCOPES = 'ads:read,pins:read,boards:read,user_accounts:read';

export function pinterestAppConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET);
}

/** True when the dashboard has any way to call the Pinterest API directly. */
export function pinterestDirectConfigured(): boolean {
  return Boolean(ENV_TOKEN) || pinterestAppConfigured();
}

export function pinterestAuthorizeUrl(redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: PINTEREST_SCOPES,
    state,
  });
  return `https://www.pinterest.com/oauth/?${qs}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

export async function exchangePinterestCode(code: string, redirectUri: string): Promise<void> {
  const json = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, continuous_refresh: 'true' });
  if (!json.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  await storeTokens(json);
}

async function storeTokens(json: Record<string, unknown>): Promise<void> {
  const expiresIn = Number(json.expires_in || 0);
  await setKV('pinterest_access_token', String(json.access_token));
  await setKV('pinterest_access_expires', String(Date.now() + Math.max(0, expiresIn - 300) * 1000));
  if (json.refresh_token) await setKV('pinterest_refresh_token', String(json.refresh_token));
  await setKV('pinterest_connected_at', new Date().toISOString());
  cached = null;
}

let cached: { token: string; expires: number } | null = null;

export async function getPinterestAccessToken(): Promise<string | null> {
  if (ENV_TOKEN) return ENV_TOKEN;
  if (!pinterestAppConfigured()) return null;
  if (cached && Date.now() < cached.expires) return cached.token;
  const [stored, expiresRaw] = await Promise.all([
    getKV('pinterest_access_token').catch(() => null),
    getKV('pinterest_access_expires').catch(() => null),
  ]);
  const expires = Number(expiresRaw || 0);
  if (stored && Date.now() < expires) {
    cached = { token: stored, expires };
    return stored;
  }
  const refresh = await getKV('pinterest_refresh_token').catch(() => null);
  if (!refresh) return null;
  try {
    const json = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, scope: PINTEREST_SCOPES });
    if (!json.access_token) return null;
    await storeTokens(json);
    const exp = Date.now() + Math.max(60, Number(json.expires_in || 0) - 300) * 1000;
    cached = { token: String(json.access_token), expires: exp };
    return cached.token;
  } catch {
    return null;
  }
}

export async function pinterestConnectionStatus(): Promise<{ configured: boolean; connected: boolean; connectedAt: string | null; via: 'env' | 'oauth' | null }> {
  if (ENV_TOKEN) return { configured: true, connected: true, connectedAt: null, via: 'env' };
  if (!pinterestAppConfigured()) return { configured: false, connected: false, connectedAt: null, via: null };
  const [refresh, at] = await Promise.all([
    getKV('pinterest_refresh_token').catch(() => null),
    getKV('pinterest_connected_at').catch(() => null),
  ]);
  return { configured: true, connected: Boolean(refresh), connectedAt: at, via: refresh ? 'oauth' : null };
}
