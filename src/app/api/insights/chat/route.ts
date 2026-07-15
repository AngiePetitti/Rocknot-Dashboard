import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getChat, saveChat, isChatStoreConfigured, StoredChatMsg } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

async function sessionEmail(): Promise<string | null> {
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET() {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, messages: [] });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ configured: false, messages: [] });
  try {
    const messages = await getChat(email);
    return NextResponse.json({ configured: true, messages });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { messages?: StoredChatMsg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  );
  try {
    await saveChat(email, messages);
    return NextResponse.json({ ok: true, configured: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
