import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getBrandBrief, setBrandBrief, defaultBrief } from '@/src/lib/brandBrief';
import { isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  const brief = await getBrandBrief();
  return NextResponse.json({ ok: true, brief, isDefault: brief === defaultBrief(), editable: isChatStoreConfigured() });
}

export async function POST(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
  }
  if (!isChatStoreConfigured()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
  }
  let body: { brief?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const brief = String(body.brief || '').trim();
  if (!brief) return NextResponse.json({ error: 'Brief cannot be empty' }, { status: 400 });
  await setBrandBrief(brief);
  return NextResponse.json({ ok: true });
}
