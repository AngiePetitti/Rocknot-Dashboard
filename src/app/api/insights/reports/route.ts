import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import { listReports, saveReport, deleteReport, isChatStoreConfigured } from '@/src/lib/chatStore';

export const dynamic = 'force-dynamic';

async function sessionEmail(): Promise<string | null> {
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ configured: false, reports: [] });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ configured: false, reports: [] });

  // Storage self-test: writes and deletes a tiny test report, surfacing the
  // exact Sheets error if saving is broken. Visit /api/insights/reports?debug=1
  if (req.nextUrl.searchParams.get('debug')) {
    const sheetIdInUse = (process.env.PRIVATE_SHEET_ID || '').replace(/\s+/g, '');
    try {
      const meta = await saveReport(email, '__storage test__', '<p>test</p>');
      await deleteReport(email, meta.id);
      return NextResponse.json({ ok: true, storage: 'working', email, sheetIdInUse });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        storageError: String(err instanceof Error ? err.message : err),
        email,
        sheetIdInUse,
        sheetIdLength: sheetIdInUse.length,
      });
    }
  }

  try {
    return NextResponse.json({ configured: true, reports: await listReports(email) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isChatStoreConfigured()) return NextResponse.json({ error: 'Report storage not configured' }, { status: 500 });
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { title?: string; html?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const html = (body.html || '').trim();
  if (!html || html.length > 900_000) {
    return NextResponse.json({ error: 'Missing or oversized report content' }, { status: 400 });
  }
  try {
    const meta = await saveReport(email, (body.title || 'Rocknot report').trim(), html);
    return NextResponse.json({ ok: true, report: meta });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
