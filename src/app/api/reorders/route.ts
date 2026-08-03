import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getReorders, addReorder, updateReorder, deleteReorder, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, reorders: [] });
  try {
    return NextResponse.json({ configured: true, reorders: await getReorders() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Reorder storage not configured' }, { status: 500 });
  let body: { product?: string; variant?: string; qty?: number; orderedDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const product = (body.product || '').trim();
  const qty = Math.max(0, Math.round(Number(body.qty) || 0));
  if (!product || qty <= 0) return NextResponse.json({ error: 'Product and a positive quantity are required' }, { status: 400 });

  let orderedBy = '';
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    orderedBy = session?.user?.email?.split('@')[0] || '';
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const orderedDate = /^\d{4}-\d{2}-\d{2}$/.test(body.orderedDate || '') ? body.orderedDate! : today;

  try {
    const reorder = await addReorder({ product, variant: (body.variant || '').trim(), qty, orderedDate, orderedBy });
    return NextResponse.json({ ok: true, reorder });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  try {
    if (body.action === 'received') {
      await updateReorder(body.id, { status: 'received', receivedDate: today });
    } else if (body.action === 'delete') {
      await deleteReorder(body.id);
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
