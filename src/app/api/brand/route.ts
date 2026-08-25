import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { saveDoc, loadDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Rocknot's brand guidelines — pasted once, referenced by every AI
// generation (creative briefs, retention plans) so output follows the REAL
// brand, not assumptions.
export async function GET() {
  try {
    const text = await loadDoc('brand_guidelines');
    return NextResponse.json({ guidelines: text || '' });
  } catch {
    return NextResponse.json({ guidelines: '' });
  }
}

export async function PUT(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can edit brand guidelines' }, { status: 403 });
    }
  }
  let body: { guidelines?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  try {
    await saveDoc('brand_guidelines', String(body.guidelines ?? '').slice(0, 120000));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
