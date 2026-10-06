// Browser (Web Push) notifications. Subscriptions are stored per login in the
// Settings KV; sends go through web-push with the deployment's VAPID keys.
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (Vercel env; generate on
//   /api/debug/push-keys) · VAPID_SUBJECT (mailto:, optional)
import webpush from 'web-push';
import { getKV, setKV, isChatStoreConfigured } from '@/src/lib/chatStore';

export type PushKind = 'tasks' | 'reports' | 'alerts';
export interface PushPrefs { tasks: boolean; reports: boolean; alerts: boolean }
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string; createdAt: string }
export interface PushUser { name?: string; prefs: PushPrefs; subs: PushSub[] }
export type PushStore = Record<string, PushUser>; // keyed by lower-case email

const KEY = 'push_subs';
const PUBLIC = (process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:info@area6marketing.com').trim();

export const DEFAULT_PREFS: PushPrefs = { tasks: true, reports: true, alerts: true };
export function pushConfigured(): boolean { return Boolean(PUBLIC && PRIVATE) && isChatStoreConfigured(); }
export function pushPublicKey(): string { return PUBLIC; }

let configured = false;
function ensureVapid(): void {
  if (configured || !PUBLIC || !PRIVATE) return;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
}

export async function loadPushStore(): Promise<PushStore> {
  if (!isChatStoreConfigured()) return {};
  try { const raw = await getKV(KEY); return raw ? (JSON.parse(raw) as PushStore) : {}; } catch { return {}; }
}
async function savePushStore(store: PushStore): Promise<void> {
  await setKV(KEY, JSON.stringify(store));
}

export async function addSubscription(email: string, name: string | undefined, sub: PushSub, prefs?: Partial<PushPrefs>): Promise<PushUser> {
  const store = await loadPushStore();
  const key = email.toLowerCase();
  const user: PushUser = store[key] || { name, prefs: { ...DEFAULT_PREFS }, subs: [] };
  if (name) user.name = name;
  if (prefs) user.prefs = { ...user.prefs, ...prefs };
  user.subs = [...user.subs.filter(s => s.endpoint !== sub.endpoint), sub].slice(-6); // a few devices per person
  store[key] = user;
  await savePushStore(store);
  return user;
}
export async function removeSubscription(email: string, endpoint: string): Promise<void> {
  const store = await loadPushStore();
  const key = email.toLowerCase();
  if (!store[key]) return;
  store[key].subs = store[key].subs.filter(s => s.endpoint !== endpoint);
  await savePushStore(store);
}
export async function setPrefs(email: string, prefs: Partial<PushPrefs>): Promise<PushUser | null> {
  const store = await loadPushStore();
  const key = email.toLowerCase();
  if (!store[key]) return null;
  store[key].prefs = { ...store[key].prefs, ...prefs };
  await savePushStore(store);
  return store[key];
}

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** Send to one login's devices (honouring their prefs for `kind`). Dead endpoints are pruned. */
export async function notifyUser(email: string, kind: PushKind, msg: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  ensureVapid();
  const store = await loadPushStore();
  const key = email.toLowerCase();
  const user = store[key];
  if (!user || !user.prefs[kind] || !user.subs.length) return 0;
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(user.subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ ...msg, kind }), { TTL: 60 * 60 * 12 });
      sent += 1;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }));
  if (dead.length) { user.subs = user.subs.filter(s => !dead.includes(s.endpoint)); store[key] = user; await savePushStore(store).catch(() => {}); }
  return sent;
}

/** First-three-letters match (same rule as the task banner) between an assignee and a login's name / email. */
export function assigneeMatches(assignee: string, name: string | undefined, email: string): boolean {
  const idents = [name || '', email.split('@')[0]]
    .map(s => s.trim().toLowerCase().split(/[\s._-]+/)[0])
    .filter(s => s.length >= 3)
    .map(s => s.slice(0, 3));
  const a = assignee.trim().toLowerCase().split(/[\s._-]+/)[0].slice(0, 3);
  return a.length >= 3 && idents.includes(a);
}

/** Send to every login whose name/email matches a task assignee. */
export async function notifyAssignee(assignee: string, msg: PushMessage): Promise<number> {
  if (!pushConfigured() || !assignee.trim()) return 0;
  const store = await loadPushStore();
  let sent = 0;
  for (const [email, user] of Object.entries(store)) {
    if (assigneeMatches(assignee, user.name, email)) sent += await notifyUser(email, 'tasks', msg);
  }
  return sent;
}

/** Send to everyone subscribed to a kind (alerts, digests). */
export async function notifyAll(kind: PushKind, msg: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  const store = await loadPushStore();
  let sent = 0;
  for (const email of Object.keys(store)) sent += await notifyUser(email, kind, msg);
  return sent;
}
