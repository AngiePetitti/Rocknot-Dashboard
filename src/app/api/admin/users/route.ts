import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { listUsers, upsertUser } from '@/src/lib/users';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  if (!authConfigured()) return true; // pre-auth: consistent with fail-open gate
  const session = await getServerSession(authOptions);
  return session?.user?.role === 'admin';
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { email, role } = await req.json() as { email?: string; role?: string };
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });
    await upsertUser(email, role === 'admin' ? 'admin' : 'team');
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
