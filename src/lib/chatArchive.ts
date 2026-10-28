// Past Cleo conversations per login. The live conversation stays in the Chats
// tab (chatStore); "New chat" moves it here and starts a fresh one. Stored as
// one JSON document per login on the private sheet (chunked by docStore).
import { getChat, saveChat, type StoredChatMsg } from '@/src/lib/chatStore';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

export interface ArchivedChat { id: string; title: string; savedAt: string; messages: StoredChatMsg[] }
export interface ArchivedChatMeta { id: string; title: string; savedAt: string; count: number; preview: string }

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 24;

const docKey = (email: string) => `chat_archive_${email.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

async function load(email: string): Promise<ArchivedChat[]> {
  try {
    const raw = await loadDoc(docKey(email));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
async function save(email: string, list: ArchivedChat[]): Promise<void> {
  await saveDoc(docKey(email), JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
}

const titleOf = (messages: StoredChatMsg[]): string => {
  const first = messages.find(m => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() || 'Conversation';
  return first.length > 70 ? `${first.slice(0, 67)}…` : first;
};
const meta = (c: ArchivedChat): ArchivedChatMeta => {
  const last = [...c.messages].reverse().find(m => m.role === 'assistant')?.content.replace(/\s+/g, ' ').trim() || '';
  return { id: c.id, title: c.title, savedAt: c.savedAt, count: c.messages.length, preview: last.length > 120 ? `${last.slice(0, 117)}…` : last };
};

export async function listArchived(email: string): Promise<ArchivedChatMeta[]> {
  return (await load(email)).map(meta);
}

export async function getArchived(email: string, id: string): Promise<ArchivedChat | null> {
  return (await load(email)).find(c => c.id === id) || null;
}

/** Move the live conversation into the archive (newest first) and clear it. */
export async function startNewChat(email: string): Promise<{ archivedId: string | null }> {
  const current = await getChat(email).catch(() => []);
  if (!current.length) return { archivedId: null };
  const list = await load(email);
  const entry: ArchivedChat = { id: `c_${Date.now().toString(36)}`, title: titleOf(current), savedAt: new Date().toISOString(), messages: current.slice(-MAX_MESSAGES) };
  await save(email, [entry, ...list]);
  await saveChat(email, []);
  return { archivedId: entry.id };
}

/** Make a past conversation the live one again (the live one is archived first). */
export async function openArchived(email: string, id: string): Promise<StoredChatMsg[] | null> {
  const list = await load(email);
  const target = list.find(c => c.id === id);
  if (!target) return null;
  const current = await getChat(email).catch(() => []);
  let next = list.filter(c => c.id !== id);
  if (current.length) next = [{ id: `c_${Date.now().toString(36)}`, title: titleOf(current), savedAt: new Date().toISOString(), messages: current.slice(-MAX_MESSAGES) }, ...next];
  await save(email, next);
  await saveChat(email, target.messages);
  return target.messages;
}

export async function deleteArchived(email: string, id: string): Promise<void> {
  const list = await load(email);
  await save(email, list.filter(c => c.id !== id));
}
