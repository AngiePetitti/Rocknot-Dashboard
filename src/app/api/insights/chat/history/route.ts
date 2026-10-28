import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { isChatStoreConfigured } from '@/src/lib/chatStore';
import { listArchived, getArchived, startNewChat, openArchived, deleteArchived } from '@/src/lib/chatArchive';

export const dynamic = 'force-dynamic';

async function sessionEmail(): Promise<string | null> {
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

// Past Cleo conversations for the signed-in person.
// GET            → list (newest first)
// GET ?id=…      → one conversation's messages
// POST {action:'new'}            → archive the live conversation, start empty
// POST {action:'open', id}       → bring a past conversation back as the live one
// POST {action:'delete', id}     → remove a past conversation
export async function GET(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, conversations: [] });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const c = await getArchived(email, id);
      return c ? NextResponse.json({ conversation: c }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ configured: true, conversations: await listArchived(email) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { action?: string; id?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  try {
    if (body.action === 'new') return NextResponse.json({ ok: true, ...(await startNewChat(email)) });
    if (body.action === 'open' && body.id) {
      const messages = await openArchived(email, body.id);
      return messages ? NextResponse.json({ ok: true, messages }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (body.action === 'delete' && body.id) { await deleteArchived(email, body.id); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
