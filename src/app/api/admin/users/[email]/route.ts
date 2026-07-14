import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { listUsers, upsertUser, removeUser } from '@/src/lib/users';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  if (!authConfigured()) return true;
  const session = await getServerSession(authOptions);
  return session?.user?.role === 'admin';
}

export async function PATCH(req: NextRequest, { params }: { params: { email: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { role } = await req.json() as { role?: string };
    await upsertUser(decodeURIComponent(params.email), role === 'admin' ? 'admin' : 'team');
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { email: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await removeUser(decodeURIComponent(params.email));
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
