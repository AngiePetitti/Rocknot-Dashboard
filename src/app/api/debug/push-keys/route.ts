import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { pushConfigured } from '@/src/lib/push';

export const dynamic = 'force-dynamic';

// Admin-only (middleware gates /api/debug/*). Generates a fresh VAPID key pair
// for browser notifications and shows it ONCE, in the browser, so the private
// key never passes through chat. Nothing is stored here — paste both into
// Vercel → Settings → Environment Variables and redeploy.
export async function GET() {
  if (pushConfigured()) {
    return new NextResponse(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h2>Browser notifications are configured ✓</h2><p>VAPID keys are present on this deployment. Use the bell in the dashboard sidebar to turn notifications on for your login.</p></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const keys = webpush.generateVAPIDKeys();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return new NextResponse(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h2>Browser notifications — one-time key setup</h2>
<p>Add these two variables to the <b>Vercel project</b> (Settings → Environment Variables), then redeploy. Refreshing this page makes a new pair, so copy both now.</p>
<p><b>VAPID_PUBLIC_KEY</b></p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all">${esc(keys.publicKey)}</pre>
<p><b>VAPID_PRIVATE_KEY</b> (secret — Vercel only, never in chat)</p><pre style="background:#fef2f2;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all">${esc(keys.privateKey)}</pre>
<p>Optional: <b>VAPID_SUBJECT</b> = <code>mailto:you@yourdomain.com</code> (defaults to the agency address).</p>
<p>After the redeploy, the bell appears in the dashboard sidebar for every login.</p></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
