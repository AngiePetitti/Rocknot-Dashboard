import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getReport, deleteReport, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

async function sessionEmail(): Promise<string | null> {
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Report storage not configured' }, { status: 500 });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const html = await getReport(email, params.id);
    if (!html) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    return NextResponse.json({ ok: true, html });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Report storage not configured' }, { status: 500 });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    await deleteReport(email, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
