import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getDiscontinued, addDiscontinued, removeDiscontinued, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

// Seasonal / not-coming-back items: skipped from the Monday order list and
// restock alerts. POST marks one skipped; DELETE un-skips it.

export async function GET() {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, discontinued: [] });
  try {
    return NextResponse.json({ configured: true, discontinued: await getDiscontinued() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
  let body: { product?: string; variant?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const product = (body.product || '').trim();
  if (!product) return NextResponse.json({ error: 'Product required' }, { status: 400 });

  let skippedBy = '';
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    skippedBy = session?.user?.email?.split('@')[0] || '';
  }
  try {
    await addDiscontinued({ product, variant: (body.variant || '').trim(), skippedBy });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  let body: { product?: string; variant?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.product) return NextResponse.json({ error: 'Product required' }, { status: 400 });
  try {
    await removeDiscontinued(body.product.trim(), (body.variant || '').trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
