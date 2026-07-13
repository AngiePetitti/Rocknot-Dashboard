// Marketing Calendar storage — backed by a Google Sheet so the team can edit
// events either in the dashboard or directly in the spreadsheet, and they stay
// in sync. Uses the SAME Google service account that already powers BigQuery
// (no new credential) — just share the Sheet with that account's email and
// enable the Google Sheets API.
//
// Env:
//   GCP_SERVICE_ACCOUNT_KEY  — the service-account JSON (already used by BigQuery)
//   CALENDAR_SHEET_ID        — the Sheet's id (from its URL)
//
// Sheet layout (row 1 is the header), first tab:
//   A: ID | B: Title | C: Start Date | D: End Date | E: Type | F: Channel | G: Status | H: Description

import { JWT } from 'google-auth-library';

export type EventType = 'deadline' | 'launch' | 'sale' | 'influencer' | 'content' | 'photo_shoot' | 'other';
export type EventStatus = 'planned' | 'live' | 'done';

export interface MarketingEvent {
  id: string;
  title: string;
  date: string;         // YYYY-MM-DD (start)
  endDate?: string;     // YYYY-MM-DD (optional; multi-day)
  type: EventType;
  channel?: string;     // Email / SMS / Paid / Organic / Other (free-form, may be comma-separated)
  status?: EventStatus;
  description?: string;
  color: string;        // derived from type
}

export const TYPE_COLORS: Record<EventType, string> = {
  deadline: '#ef4444',
  launch: '#8b5cf6',
  sale: '#f59e0b',
  influencer: '#ec4899',
  content: '#3b82f6',
  photo_shoot: '#06b6d4',
  other: '#6b7280',
};

// Human labels used in the Sheet (and the dashboard dropdown) <-> internal type.
const TYPE_TO_LABEL: Record<EventType, string> = {
  launch: 'Launch', sale: 'Sale', influencer: 'Influencer', content: 'Content Due',
  photo_shoot: 'Photo Shoot', deadline: 'Deadline', other: 'Other',
};
function labelToType(label: string): EventType {
  const s = (label || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (s === 'launch') return 'launch';
  if (s === 'sale') return 'sale';
  if (s === 'influencer') return 'influencer';
  if (s === 'content due' || s === 'content') return 'content';
  if (s === 'photo shoot' || s === 'photoshoot') return 'photo_shoot';
  if (s === 'deadline') return 'deadline';
  return 'other';
}
function labelToStatus(label: string): EventStatus | undefined {
  const s = (label || '').toLowerCase().trim();
  if (s === 'live') return 'live';
  if (s === 'done') return 'done';
  if (s === 'planned') return 'planned';
  return undefined;
}
const STATUS_TO_LABEL: Record<EventStatus, string> = { planned: 'Planned', live: 'Live', done: 'Done' };

const SHEET_ID = (process.env.CALENDAR_SHEET_ID || '').trim();
const RANGE = 'A2:H'; // data rows (row 1 = header), first tab
const HEADER = ['ID', 'Title', 'Start Date', 'End Date', 'Type', 'Channel', 'Status', 'Description'];

export function isStorageConfigured(): boolean {
  return Boolean((process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim() && SHEET_ID);
}

let jwt: JWT | null = null;
async function getToken(): Promise<string> {
  const key = (process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim();
  if (!key || !SHEET_ID) {
    throw new Error('Calendar Sheet not configured — set GCP_SERVICE_ACCOUNT_KEY and CALENDAR_SHEET_ID, and share the Sheet with the service account email.');
  }
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

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = await getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message || `Sheets API error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function newId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function rowToEvent(row: string[]): MarketingEvent | null {
  const [id, title, start, end, typeLabel, channel, statusLabel, description] = row;
  if (!title && !start) return null; // blank row
  const type = labelToType(typeLabel || '');
  return {
    id: (id || '').trim() || newId(),
    title: (title || '').trim(),
    date: (start || '').trim(),
    endDate: (end || '').trim() || undefined,
    type,
    channel: (channel || '').trim() || undefined,
    status: labelToStatus(statusLabel || ''),
    description: (description || '').trim() || undefined,
    color: TYPE_COLORS[type],
  };
}

function eventToRow(e: MarketingEvent): string[] {
  return [
    e.id,
    e.title,
    e.date,
    e.endDate || '',
    TYPE_TO_LABEL[e.type] || 'Other',
    e.channel || '',
    e.status ? STATUS_TO_LABEL[e.status] : '',
    e.description || '',
  ];
}

async function writeAll(events: MarketingEvent[]): Promise<void> {
  // Rewrite the whole data range: clear, then set header + rows so the Sheet
  // always has a tidy header and no stale trailing rows.
  await sheetsFetch(`/values/A2:H:clear`, { method: 'POST', body: '{}' });
  const values = events.map(eventToRow);
  await sheetsFetch(`/values/A1?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: 'A1', majorDimension: 'ROWS', values: [HEADER, ...values] }),
  });
}

export async function getEvents(): Promise<MarketingEvent[]> {
  const data = await sheetsFetch(`/values/${RANGE}`) as { values?: string[][] };
  const rows = data.values || [];
  let backfilled = false;
  const events: MarketingEvent[] = [];
  for (const row of rows) {
    const ev = rowToEvent(row);
    if (!ev) continue;
    if (!(row[0] || '').trim()) backfilled = true; // this row had no ID → we generated one
    events.push(ev);
  }
  // Persist generated IDs (for rows added by hand in the Sheet) so they stay
  // editable/deletable from the dashboard on subsequent loads.
  if (backfilled) await writeAll(events);
  return events;
}

export async function saveEvents(events: MarketingEvent[]): Promise<void> {
  await writeAll(events);
}
