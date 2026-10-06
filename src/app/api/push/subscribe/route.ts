import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { addSubscription, removeSubscription, setPrefs, loadPushStore, pushConfigured, pushPublicKey, DEFAULT_PREFS, type PushSub } from '@/src/lib/push';

export const dynamic = 'force-dynamic';

async function who(): Promise<{ email: string; name?: string } | null> {
  if (!authConfigured()) return null;
  const s = await getServerSession(authOptions);
  const email = s?.user?.email?.toLowerCase();
  return email ? { email, name: s?.user?.name || undefined } : null;
}

// GET: is push configured, this login's prefs, and whether this device's endpoint is registered.
export async function GET(req: NextRequest) {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const endpoint = req.nextUrl.searchParams.get('endpoint') || '';
  const store = await loadPushStore();
  const user = store[me.email];
  return NextResponse.json({
    configured: pushConfigured(), publicKey: pushPublicKey(),
    prefs: user?.prefs || DEFAULT_PREFS, devices: user?.subs.length || 0,
    thisDevice: Boolean(endpoint && user?.subs.some(s => s.endpoint === endpoint)),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST {subscription, prefs?}: register this device. POST {prefs} alone: update prefs.
export async function POST(req: NextRequest) {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: 'Notifications are not configured on this deployment (VAPID keys missing)' }, { status: 503 });
  const body = await req.json().catch(() => ({})) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; prefs?: Record<string, boolean> };
  const prefs = body.prefs ? { tasks: Boolean(body.prefs.tasks), reports: Boolean(body.prefs.reports), alerts: Boolean(body.prefs.alerts) } : undefined;
  try {
    if (body.subscription?.endpoint && body.subscription.keys?.p256dh && body.subscription.keys?.auth) {
      const sub: PushSub = { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth }, ua: (req.headers.get('user-agent') || '').slice(0, 120), createdAt: new Date().toISOString() };
      const user = await addSubscription(me.email, me.name, sub, prefs);
      return NextResponse.json({ ok: true, prefs: user.prefs, devices: user.subs.length });
    }
    if (prefs) {
      const user = await setPrefs(me.email, prefs);
      return NextResponse.json({ ok: true, prefs: user?.prefs || prefs });
    }
    return NextResponse.json({ error: 'subscription or prefs required' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// DELETE ?endpoint=: unregister this device.
export async function DELETE(req: NextRequest) {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const endpoint = req.nextUrl.searchParams.get('endpoint') || '';
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await removeSubscription(me.email, endpoint).catch(() => {});
  return NextResponse.json({ ok: true });
}
