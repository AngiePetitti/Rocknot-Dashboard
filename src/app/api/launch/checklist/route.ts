import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { loadDoc, saveDoc } from '@/src/lib/docStore';

export const dynamic = 'force-dynamic';

// Launch playbook — the standard checklist every launch/sale goes through
// (emails, SMS, banners, discount codes, content…), materialized per
// calendar event so nothing gets forgotten. Template is editable; per-event
// check state is keyed by calendar event id.

export interface TemplateItem { label: string; daysBefore: number }
export interface EventChecks { [label: string]: { done: boolean; by?: string; at?: string } }
interface Store { template: TemplateItem[]; byEvent: Record<string, EventChecks> }

const DOC = 'launch_playbook';

const DEFAULT_TEMPLATE: TemplateItem[] = [
  { label: 'Inventory received & counted', daysBefore: 7 },
  { label: 'Tease email scheduled in Klaviyo', daysBefore: 7 },
  { label: 'Launch-day email built & scheduled', daysBefore: 3 },
  { label: 'SMS launch message drafted & scheduled', daysBefore: 3 },
  { label: 'Discount code created & test-ordered', daysBefore: 3 },
  { label: 'Product pages built & proofread (hidden until launch)', daysBefore: 2 },
  { label: 'Website banner / homepage hero ready', daysBefore: 2 },
  { label: 'Ad creatives uploaded & scheduled', daysBefore: 2 },
  { label: 'Organic social content scheduled', daysBefore: 1 },
  { label: 'Influencer / UGC posts confirmed', daysBefore: 1 },
  { label: 'Last-chance email scheduled', daysBefore: 0 },
];

async function load(): Promise<Store> {
  try {
    const raw = await loadDoc(DOC);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (Array.isArray(parsed.template) && parsed.template.length) return { template: parsed.template, byEvent: parsed.byEvent || {} };
    }
  } catch { /* fall through to default */ }
  return { template: DEFAULT_TEMPLATE, byEvent: {} };
}

export async function GET() {
  const store = await load();
  return NextResponse.json(store);
}

// Replace the template (admin) — items as [{label, daysBefore}]
export async function PUT(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Only admins can edit the playbook' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const template = (Array.isArray(body.template) ? body.template : [])
    .map((t: { label?: string; daysBefore?: number }) => ({
      label: String(t.label || '').slice(0, 200).trim(),
      daysBefore: Math.max(0, Math.min(60, Math.round(Number(t.daysBefore) || 0))),
    }))
    .filter((t: TemplateItem) => t.label)
    .slice(0, 40);
  if (!template.length) return NextResponse.json({ error: 'Template needs at least one item' }, { status: 400 });
  const store = await load();
  store.template = template;
  await saveDoc(DOC, JSON.stringify(store));
  return NextResponse.json({ ok: true, template });
}

// Toggle one item for one event
export async function PATCH(req: NextRequest) {
  let by: string | undefined;
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    by = session.user.name || session.user.email?.split('@')[0] || undefined;
  }
  const body = await req.json().catch(() => ({}));
  const eventId = String(body.eventId || '');
  const label = String(body.label || '').slice(0, 200);
  if (!eventId || !label) return NextResponse.json({ error: 'eventId and label required' }, { status: 400 });
  const store = await load();
  const checks = store.byEvent[eventId] || {};
  checks[label] = { done: Boolean(body.done), ...(by ? { by } : {}), at: new Date().toISOString() };
  store.byEvent[eventId] = checks;
  // Keep the doc from growing forever — cap at the 60 most recently touched events.
  const ids = Object.keys(store.byEvent);
  if (ids.length > 60) {
    const latest = (c: EventChecks) => Math.max(0, ...Object.values(c).map(v => Date.parse(v.at || '') || 0));
    for (const id of ids.sort((a, b) => latest(store.byEvent[a]) - latest(store.byEvent[b])).slice(0, ids.length - 60)) {
      delete store.byEvent[id];
    }
  }
  await saveDoc(DOC, JSON.stringify(store));
  return NextResponse.json({ ok: true, checks });
}
