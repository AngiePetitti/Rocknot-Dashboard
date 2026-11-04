// Review state for the plan's checkpoints (Goals tab): who re-read the
// numbers on each dated touch point, when, and what was decided. Shared
// across everyone signed in to this client's dashboard (private-sheet KV).
import { loadDoc, saveDoc } from '@/src/lib/docStore';
import { getClient } from '@/src/lib/client';

export interface CheckpointReview {
  reviewedAt: string;
  by?: string;
  note?: string;
}

type ReviewStore = Record<string, CheckpointReview>;

const storeKey = () => `checkpoints_${getClient().id}`;

export async function getCheckpointReviews(): Promise<ReviewStore> {
  const raw = await loadDoc(storeKey());
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ReviewStore) : {};
  } catch {
    return {};
  }
}

/** Set (or clear, with null) one checkpoint's review; returns the whole store. */
export async function setCheckpointReview(id: string, review: CheckpointReview | null): Promise<ReviewStore> {
  const all = await getCheckpointReviews();
  if (review) all[id] = review; else delete all[id];
  await saveDoc(storeKey(), JSON.stringify(all));
  return all;
}
