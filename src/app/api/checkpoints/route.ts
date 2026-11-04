import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { isChatStoreConfigured } from '@/src/lib/chatStore';
import { getCheckpointReviews, setCheckpointReview } from '@/src/lib/checkpointStore';

export const dynamic = 'force-dynamic';

// Checkpoint reviews for the Goals tab's plan.
// GET                         → { reviews: { [checkpointId]: { reviewedAt, by, note } } }
// POST { id, note }           → mark reviewed (by the signed-in person)
// POST { id, clear: true }    → undo
export async function GET() {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, reviews: {} });
  try {
    return NextResponse.json({ configured: true, reviews: await getCheckpointReviews() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), reviews: {} }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, error: 'Storage not configured' }, { status: 503 });
  try {
    const body = await req.json() as { id?: string; note?: string; clear?: boolean };
    if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    let by: string | undefined;
    if (authConfigured()) {
      const session = await getServerSession(authOptions);
      by = session?.user?.name || session?.user?.email || undefined;
    }
    const reviews = body.clear
      ? await setCheckpointReview(body.id, null)
      : await setCheckpointReview(body.id, { reviewedAt: new Date().toISOString(), by, note: String(body.note || '').slice(0, 2000) });
    return NextResponse.json({ reviews });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
