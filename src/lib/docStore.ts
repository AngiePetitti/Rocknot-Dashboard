// Chunked large-value storage on the private sheet's Settings tab — for
// documents that exceed one cell (briefs, plans, brand guidelines).
import { getKV, setKV } from '@/src/lib/chatStore';

const CHUNK = 40000;

export async function saveDoc(name: string, value: string): Promise<void> {
  const parts = Math.ceil(value.length / CHUNK) || 1;
  await setKV(`${name}_parts`, String(parts));
  for (let i = 0; i < parts; i++) {
    await setKV(`${name}_${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
}

export async function loadDoc(name: string): Promise<string | null> {
  const parts = Number(await getKV(`${name}_parts`)) || 0;
  if (!parts) return null;
  let out = '';
  for (let i = 0; i < parts; i++) out += (await getKV(`${name}_${i}`)) || '';
  return out || null;
}
