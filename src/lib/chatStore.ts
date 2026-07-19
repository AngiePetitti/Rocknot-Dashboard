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
  return Boolean(
    (process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim() &&
    ((process.env.PRIVATE_SHEET_ID || '').trim() || CALENDAR_SHEET_ID)
  );
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

// ── Chat-sheet id bookkeeping ────────────────────────────────────────────
// Preferred: PRIVATE_SHEET_ID — a sheet the owner created and shared ONLY
// with the service account (service accounts can no longer reliably create
// their own files due to Google storage-quota rules). Fallback: an SA-owned
// sheet whose id is persisted in the calendar sheet's hidden _meta tab.
// Strip ALL whitespace (not just ends) — pasted values on mobile often pick up
// stray line breaks mid-string, which Google reports as "entity not found".
const PRIVATE_SHEET_ID = (process.env.PRIVATE_SHEET_ID || '').replace(/\s+/g, '');
let cachedChatSheetId: string | null = null;
let privateTabsEnsured = false;

async function ensurePrivateTabs(sheetId: string): Promise<void> {
  if (privateTabsEnsured) return;
  try {
    await api(`/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CHAT_TAB } } }] }),
    });
    await api(`/${sheetId}/values/${CHAT_TAB}!A1?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${CHAT_TAB}!A1`, majorDimension: 'ROWS', values: [['Email', 'Index', 'Role', 'Content', 'Updated At']] }),
    });
  } catch { /* tab already exists */ }
  privateTabsEnsured = true;
}

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
  if (PRIVATE_SHEET_ID) {
    await ensurePrivateTabs(PRIVATE_SHEET_ID);
    return PRIVATE_SHEET_ID;
  }
  if (cachedChatSheetId) return cachedChatSheetId;
  let id = await readMetaChatSheetId();
  if (!id && createIfMissing) {
    id = await createChatSheet();
    await writeMetaChatSheetId(id);
  }
  cachedChatSheetId = id;
  return id;
}

// ── Saved reports (same private sheet, "Reports" tab) ────────────────────
// Report HTML exceeds the 50k-char cell limit, so each report is stored as
// ordered chunks: Email | ReportId | Title | Created At | Chunk # | Chunk
const REPORTS_TAB = 'Reports';
const CHUNK_SIZE = 45000;
const MAX_REPORTS_PER_USER = 30;

export interface SavedReportMeta { id: string; title: string; createdAt: string }

async function ensureReportsTab(sheetId: string): Promise<void> {
  try {
    await api(`/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: REPORTS_TAB } } }] }),
    });
    await api(`/${sheetId}/values/${REPORTS_TAB}!A1?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${REPORTS_TAB}!A1`, majorDimension: 'ROWS', values: [['Email', 'Report Id', 'Title', 'Created At', 'Chunk', 'Content']] }),
    });
  } catch { /* tab already exists */ }
}

async function readReportRows(sheetId: string): Promise<string[][]> {
  try {
    const data = await api(`/${sheetId}/values/${REPORTS_TAB}!A2:F`) as { values?: string[][] };
    return data.values || [];
  } catch {
    return []; // tab doesn't exist yet
  }
}

export async function listReports(email: string): Promise<SavedReportMeta[]> {
  const id = await getChatSheetId(false);
  if (!id) return [];
  const rows = await readReportRows(id);
  const seen = new Map<string, SavedReportMeta>();
  for (const r of rows) {
    if ((r[0] || '').toLowerCase() !== email.toLowerCase()) continue;
    if (r[4] !== '0') continue; // meta lives on the first chunk row
    seen.set(r[1], { id: r[1], title: r[2] || 'Untitled report', createdAt: r[3] || '' });
  }
  return Array.from(seen.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveReport(email: string, title: string, html: string): Promise<SavedReportMeta> {
  const sheetId = await getChatSheetId(true);
  if (!sheetId) throw new Error('Report storage unavailable');
  await ensureReportsTab(sheetId);

  // Cap per-user history so the sheet doesn't grow without bound.
  const existing = await listReports(email);
  for (const old of existing.slice(MAX_REPORTS_PER_USER - 1)) {
    await deleteReport(email, old.id);
  }

  const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  const chunks: string[] = [];
  for (let i = 0; i < html.length; i += CHUNK_SIZE) chunks.push(html.slice(i, i + CHUNK_SIZE));
  const rows = chunks.map((c, i) => [email.toLowerCase(), id, title.slice(0, 200), createdAt, String(i), c]);
  await api(`/${sheetId}/values/${REPORTS_TAB}!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    body: JSON.stringify({ range: `${REPORTS_TAB}!A1`, majorDimension: 'ROWS', values: rows }),
  });
  return { id, title, createdAt };
}

export async function getReport(email: string, reportId: string): Promise<string | null> {
  const sheetId = await getChatSheetId(false);
  if (!sheetId) return null;
  const rows = await readReportRows(sheetId);
  const mine = rows
    .filter(r => (r[0] || '').toLowerCase() === email.toLowerCase() && r[1] === reportId)
    .sort((a, b) => Number(a[4]) - Number(b[4]));
  if (!mine.length) return null;
  return mine.map(r => r[5] || '').join('');
}

export async function deleteReport(email: string, reportId: string): Promise<void> {
  const sheetId = await getChatSheetId(false);
  if (!sheetId) return;
  const rows = await readReportRows(sheetId);
  const keep = rows.filter(r => !((r[0] || '').toLowerCase() === email.toLowerCase() && r[1] === reportId));
  if (keep.length === rows.length) return;
  await api(`/${sheetId}/values/${REPORTS_TAB}!A2:F:clear`, { method: 'POST', body: '{}' });
  if (keep.length) {
    await api(`/${sheetId}/values/${REPORTS_TAB}!A2?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${REPORTS_TAB}!A2`, majorDimension: 'ROWS', values: keep }),
    });
  }
}

// ── Goals (same private sheet, "Goals" tab — shared, not per-login) ──────
// One row per month: Month (YYYY-MM) | Revenue Goal | Ad Spend Budget
const GOALS_TAB = 'Goals';

export interface MonthGoal { month: string; revenueGoal: number; adBudget: number }

async function ensureGoalsTab(sheetId: string): Promise<void> {
  try {
    await api(`/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: GOALS_TAB } } }] }),
    });
    await api(`/${sheetId}/values/${GOALS_TAB}!A1?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${GOALS_TAB}!A1`, majorDimension: 'ROWS', values: [['Month', 'Revenue Goal', 'Ad Spend Budget']] }),
    });
  } catch { /* tab already exists */ }
}

export async function getGoals(): Promise<MonthGoal[]> {
  const sheetId = await getChatSheetId(false);
  if (!sheetId) return [];
  try {
    const data = await api(`/${sheetId}/values/${GOALS_TAB}!A2:C`) as { values?: string[][] };
    return (data.values || [])
      .filter(r => /^\d{4}-\d{2}$/.test((r[0] || '').trim()))
      .map(r => ({
        month: r[0].trim(),
        revenueGoal: Number(String(r[1] || '0').replace(/[^0-9.-]/g, '')) || 0,
        adBudget: Number(String(r[2] || '0').replace(/[^0-9.-]/g, '')) || 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  } catch {
    return []; // tab doesn't exist yet
  }
}

export async function saveGoals(goals: MonthGoal[]): Promise<void> {
  const sheetId = await getChatSheetId(true);
  if (!sheetId) throw new Error('Goal storage unavailable');
  await ensureGoalsTab(sheetId);
  await api(`/${sheetId}/values/${GOALS_TAB}!A2:C:clear`, { method: 'POST', body: '{}' });
  const rows = goals
    .filter(g => /^\d{4}-\d{2}$/.test(g.month))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(g => [g.month, String(Math.round(g.revenueGoal)), String(Math.round(g.adBudget))]);
  if (rows.length) {
    await api(`/${sheetId}/values/${GOALS_TAB}!A2?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: `${GOALS_TAB}!A2`, majorDimension: 'ROWS', values: rows }),
    });
  }
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
