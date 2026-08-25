import { NextRequest, NextResponse } from 'next/server';
import { getKV, setKV } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// Klaviyo drafts the team considers stale — hidden from the Retention tab's
// scheduled list (Klaviyo itself is untouched; our API key is read-only).
async function readHidden(): Promise<string[]> {
  const raw = await getKV('hidden_campaigns').catch(() => null);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export async function GET() {
  return NextResponse.json({ hidden: await readHidden() });
}

export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const hidden = await readHidden();
  if (!hidden.includes(id)) hidden.push(id);
  await setKV('hidden_campaigns', hidden.slice(-200).join(','));
  return NextResponse.json({ ok: true, hidden });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const hidden = (await readHidden()).filter(h => h !== id);
  await setKV('hidden_campaigns', hidden.join(','));
  return NextResponse.json({ ok: true, hidden });
}
