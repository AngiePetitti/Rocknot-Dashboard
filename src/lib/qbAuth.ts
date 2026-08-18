// Direct QuickBooks Online API auth. Intuit rotates the refresh token on
// every refresh, so the current one is persisted in the private sheet's
// QBAuth tab (env QB_REFRESH_TOKEN only seeds the first exchange).
import { getKV, setKV } from '@/src/lib/chatStore';

const CLIENT_ID = (process.env.QB_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.QB_CLIENT_SECRET || '').trim();

export function qbConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

let cached: { token: string; realmId: string; expires: number } | null = null;

export async function exchangeQbCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string }> {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  const json = await res.json();
  if (!json.refresh_token) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  await setKV('qb_refresh_token', String(json.refresh_token)).catch(() => {});
  return { refreshToken: String(json.refresh_token), accessToken: String(json.access_token) };
}

export async function getQbAccess(): Promise<{ token: string; realmId: string } | null> {
  if (!qbConfigured()) return null;
  const realmId = (await getKV('qb_realm_id').catch(() => null)) || (process.env.QB_REALM_ID || '').trim();
  if (!realmId) return null;
  if (cached && Date.now() < cached.expires && cached.realmId === realmId) {
    return { token: cached.token, realmId };
  }
  const refresh = (await getKV('qb_refresh_token').catch(() => null)) || (process.env.QB_REFRESH_TOKEN || '').trim();
  if (!refresh) return null;
  try {
    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!json.access_token) return null;
    // Intuit issues a NEW refresh token — persist it or the chain breaks.
    if (json.refresh_token && json.refresh_token !== refresh) {
      await setKV('qb_refresh_token', String(json.refresh_token)).catch(() => {});
    }
    cached = { token: String(json.access_token), realmId, expires: Date.now() + 50 * 60 * 1000 };
    return { token: cached.token, realmId };
  } catch {
    return null;
  }
}

export async function setQbRealm(realmId: string): Promise<void> {
  await setKV('qb_realm_id', realmId);
}
