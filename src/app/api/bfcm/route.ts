import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { bfcmYear, loadBfcmPlan, saveBfcmPlan, type BfcmPlan } from '@/src/lib/bfcm';

export const dynamic = 'force-dynamic';

async function who(): Promise<{ email: string; admin: boolean }> {
  if (!authConfigured()) return { email: '', admin: true };
  const s = await getServerSession(authOptions);
  return { email: s?.user?.email || '', admin: s?.user?.role === 'admin' };
}

// GET /api/bfcm?year=2026 → the plan
export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year')) || bfcmYear();
  return NextResponse.json({ plan: await loadBfcmPlan(year) }, { headers: { 'Cache-Control': 'no-store' } });
}

// PUT → replace the plan (admins)
export async function PUT(req: NextRequest) {
  const u = await who();
  if (!u.admin) return NextResponse.json({ error: 'Only admins can edit the BFCM plan' }, { status: 403 });
  try {
    const body = (await req.json()) as { plan?: BfcmPlan };
    if (!body.plan || typeof body.plan.year !== 'number') return NextResponse.json({ error: 'plan required' }, { status: 400 });
    const plan = await saveBfcmPlan(body.plan, u.email);
    return NextResponse.json({ plan });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

// PATCH → tick / untick one checklist item (any signed-in user)
export async function PATCH(req: NextRequest) {
  const u = await who();
  if (authConfigured() && !u.email) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  try {
    const body = (await req.json()) as { year?: number; id?: string; done?: boolean };
    const plan = await loadBfcmPlan(body.year || bfcmYear());
    const item = plan.checklist.find(c => c.id === body.id);
    if (!item) return NextResponse.json({ error: 'No such item' }, { status: 404 });
    item.done = Boolean(body.done);
    item.doneBy = item.done ? u.email : undefined;
    item.doneAt = item.done ? new Date().toISOString() : undefined;
    return NextResponse.json({ plan: await saveBfcmPlan(plan) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
