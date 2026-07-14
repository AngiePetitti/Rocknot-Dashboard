// User/role store for dashboard access. Bootstrap admins come from the
// AUTH_ADMINS env var (permanent — can't be removed via the UI, so you can
// never lock yourself out). Everyone else is managed from the admin UI and
// stored in a "Users" tab of the same Google Sheet the calendar uses.

import { JWT } from 'google-auth-library';
import type { Role } from '@/src/lib/auth';

const SHEET_ID = (process.env.CALENDAR_SHEET_ID || '').trim();
const TAB = 'Users';

function envList(name: string): string[] {
  return (process.env[name] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}
export const envAdmins = () => envList('AUTH_ADMINS');
export const envMembers = () => envList('AUTH_MEMBERS');

export interface StoredUser { email: string; role: Role; }
export interface ListedUser { email: string; role: Role; locked: boolean; source: 'env' | 'sheet'; }

function storeConfigured(): boolean {
  return Boolean(SHEET_ID && (process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim());
}

let jwt: JWT | null = null;
async function token(): Promise<string> {
  if (!jwt) {
    const creds = JSON.parse((process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim());
    jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  const t = await jwt.getAccessToken();
  if (!t.token) throw new Error('No Google token');
  return t.token;
}
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Sheets ${res.status}`);
  return json;
}

async function ensureTab(): Promise<void> {
  const meta = await api('?fields=sheets.properties.title');
  const has = (meta.sheets || []).some((s: { properties?: { title?: string } }) => s.properties?.title === TAB);
  if (!has) {
    await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) });
    await api(`/values/${TAB}!A1?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [['Email', 'Role']] }) });
  }
}

let cache: { at: number; users: StoredUser[] } | null = null;
export async function getStoredUsers(): Promise<StoredUser[]> {
  if (!storeConfigured()) return [];
  if (cache && Date.now() - cache.at < 10_000) return cache.users;
  try {
    await ensureTab();
    const d = await api(`/values/${TAB}!A2:B`);
    const users: StoredUser[] = (d.values || [])
      .map((r: string[]) => ({ email: (r[0] || '').toLowerCase().trim(), role: ((r[1] || '').toLowerCase().trim() === 'admin' ? 'admin' : 'team') as Role }))
      .filter((u: StoredUser) => u.email);
    cache = { at: Date.now(), users };
    return users;
  } catch {
    return cache?.users ?? [];
  }
}

async function writeStoredUsers(users: StoredUser[]): Promise<void> {
  await ensureTab();
  await api(`/values/${TAB}!A2:B:clear`, { method: 'POST', body: '{}' });
  await api(`/values/${TAB}!A1?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['Email', 'Role'], ...users.map(u => [u.email, u.role === 'admin' ? 'Admin' : 'Team'])] }),
  });
  cache = { at: Date.now(), users };
}

// Resolve a role at sign-in. Env admins always win; then the sheet; then env
// members. Not found → null (denied). Never throws.
export async function roleFor(email?: string | null): Promise<Role | null> {
  const e = (email || '').toLowerCase().trim();
  if (!e) return null;
  if (envAdmins().includes(e)) return 'admin';
  const stored = await getStoredUsers();
  const u = stored.find(x => x.email === e);
  if (u) return u.role;
  if (envMembers().includes(e)) return 'team';
  return null;
}

// For the admin UI: env admins (locked) + everyone in the sheet.
export async function listUsers(): Promise<ListedUser[]> {
  const stored = await getStoredUsers();
  const seen = new Set<string>();
  const out: ListedUser[] = [];
  for (const e of envAdmins()) { out.push({ email: e, role: 'admin', locked: true, source: 'env' }); seen.add(e); }
  for (const e of envMembers()) if (!seen.has(e) && !stored.some(u => u.email === e)) { out.push({ email: e, role: 'team', locked: true, source: 'env' }); seen.add(e); }
  for (const u of stored) if (!seen.has(u.email)) { out.push({ ...u, locked: false, source: 'sheet' }); seen.add(u.email); }
  return out.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
}

const isEnvManaged = (email: string) => envAdmins().includes(email) || envMembers().includes(email);

export async function upsertUser(email: string, role: Role): Promise<void> {
  const e = email.toLowerCase().trim();
  if (!e || !e.includes('@')) throw new Error('Enter a valid email');
  if (isEnvManaged(e)) throw new Error('This user is managed via env vars and can\'t be edited here.');
  const stored = await getStoredUsers();
  const idx = stored.findIndex(u => u.email === e);
  if (idx >= 0) stored[idx].role = role; else stored.push({ email: e, role });
  await writeStoredUsers(stored);
}

export async function removeUser(email: string): Promise<void> {
  const e = email.toLowerCase().trim();
  if (isEnvManaged(e)) throw new Error('This user is managed via env vars and can\'t be removed here.');
  const stored = await getStoredUsers();
  await writeStoredUsers(stored.filter(u => u.email !== e));
}
