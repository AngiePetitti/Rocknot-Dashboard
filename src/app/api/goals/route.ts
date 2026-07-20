import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { getGoals, saveGoals, isChatStoreConfigured, MonthGoal } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, goals: [] });
  try {
    return NextResponse.json({ configured: true, goals: await getGoals() });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Goal storage not configured' }, { status: 500 });
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can edit goals' }, { status: 403 });
    }
  }
  let body: { goals?: MonthGoal[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const goals = (body.goals ?? []).filter(
    g => typeof g?.month === 'string' && /^\d{4}-\d{2}$/.test(g.month)
  ).map(g => ({
    month: g.month,
    revenueGoal: Math.max(0, Number(g.revenueGoal) || 0),
    adBudget: Math.max(0, Number(g.adBudget) || 0),
    pinned: Boolean(g.pinned),
  }));
  try {
    await saveGoals(goals);
    return NextResponse.json({ ok: true, goals });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
