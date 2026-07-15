// Ask-the-Analyst chat persistence — keyed to the signed-in user's email so
// conversations survive browser data clears and sync across devices, while
// staying private per login.
//
// Storage is a Google Sheet OWNED BY THE SERVICE ACCOUNT (created on first
// save, never shared), so unlike the calendar sheet no human account can open
// it — only the dashboard can read it. The chat sheet's id is remembered in a
// hidden "_meta" tab of the calendar sheet so it isn't re-created on every
// serverless cold start.
//
// Chat sheet layout, tab "Chats" (row 1 = header):
//   A: Email | B: Index | C: Role | D: Content | E: Updated At

import { JWT } from 'google-auth-library';

export interface StoredChatMsg { role: 'user' | 'assistant'; content: string }

const CALENDAR_SHEET_ID = (process.env.CALENDAR_SHEET_ID || '').trim();
const META_TAB = '_meta';
const CHAT_TAB = 'Chats';
const MAX_MESSAGES = 40;

export function isChatStoreConfigured(): boolean {
  return Boolean((process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim() && CALENDAR_SHEET_ID);
}

let jwt: JWT | null = null;
async function getToken(): Promise<string> {
  const key = (process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim();
  if (!key) throw new Error('GCP_SERVICE_ACCOUNT_KEY not configured');
  if (!jwt) {
    const creds = JSON.parse(key);
    jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  const t = await jwt.getAccessToken();
  if (!t.token) throw new Error('Could not obtain Google access token for Sheets');
  return t.token;
}

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const token = await getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message || `Sheets API error ${res.status}`;
    throw new Error(msg);
  }
  return json as Record<string, unknown>;
}

// ── Chat-sheet id bookkeeping (persisted in the calendar sheet's _meta tab) ──
let cachedChatSheetId: string | null = null;

async function readMetaChatSheetId(): Promise<string | null> {
  try {
    const data = await api(`/${CALENDAR_SHEET_ID}/values/${META_TAB}!A1:B1`) as { values?: string[][] };
    const row = data.values?.[0];
    if (row?.[0] === 'CHAT_SHEET_ID' && row[1]?.trim()) return row[1].trim();
  } catch { /* tab may not exist yet */ }
  return null;
}

async function writeMetaChatSheetId(id: string): Promise<void> {
  try {
    await api(`/${CALENDAR_SHEET_ID}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: META_TAB, hidden: true } } }] }),
    });
  } catch { /* tab already exists */ }
  await api(`/${CALENDAR_SHEET_ID}/values/${META_TAB}!A1?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: `${META_TAB}!A1`, majorDimension: 'ROWS', values: [['CHAT_SHEET_ID', id]] }),
  });
}

async function createChatSheet(): Promise<string> {
  const created = await api('', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: 'Rocknot Analyst Chats (private — do not share)' },
      sheets: [{ properties: { title: CHAT_TAB } }],
    }),
  }) as { spreadsheetId?: string };
  if (!created.spreadsheetId) throw new Error('Failed to create chat storage sheet');
  await api(`/${created.spreadsheetId}/values/${CHAT_TAB}!A1?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: `${CHAT_TAB}!A1`, majorDimension: 'ROWS', values: [['Email', 'Index', 'Role', 'Content', 'Updated At']] }),
  });
  return created.spreadsheetId;
}

async function getChatSheetId(createIfMissing: boolean): Promise<string | null> {
  if (cachedChatSheetId) return cachedChatSheetId;
  let id = await readMetaChatSheetId();
  if (!id && createIfMissing) {
    id = await createChatSheet();
    await writeMetaChatSheetId(id);
  }
  cachedChatSheetId = id;
  return id;
}

// ── Public API ───────────────────────────────────────────────────────────
export async function getChat(email: string): Promise<StoredChatMsg[]> {
  const id = await getChatSheetId(false);
  if (!id) return [];
  const data = await api(`/${id}/values/${CHAT_TAB}!A2:E`) as { values?: string[][] };
  const mine = (data.values || [])
    .filter(r => (r[0] || '').toLowerCase() === email.toLowerCase())
    .map(r => ({ index: Number(r[1] || 0), role: r[2] === 'assistant' ? 'assistant' as const : 'user' as const, content: r[3] || '' }))
    .filter(r => r.content)
    .sort((a, b) => a.index - b.index);
  return mine.map(({ role, content }) => ({ role, content }));
}

export async function saveChat(email: string, messages: StoredChatMsg[]): Promise<void> {
  const id = await getChatSheetId(true);
  if (!id) throw new Error('Chat storage unavailable');
  const data = await api(`/${id}/values/${CHAT_TAB}!A2:E`) as { values?: string[][] };
  const others = (data.values || []).filter(r => (r[0] || '').toLowerCase() !== email.toLowerCase() && (r[0] || '').trim());
  const now = new Date().toISOString();
  const mine = messages.slice(-MAX_MESSAGES).map((m, i) => [email.toLowerCase(), String(i), m.role, m.content, now]);
  await api(`/${id}/values/${CHAT_TAB}!A2:E:clear`, { method: 'POST', body: '{}' });
  const rows = [...others, ...mine];
  if (rows.length) {
    await api(`/${id}/values/${CHAT_TAB}!A2?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${CHAT_TAB}!A2`, majorDimension: 'ROWS', values: rows }),
    });
  }
}
