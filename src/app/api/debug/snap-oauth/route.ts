import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// One-time Snapchat OAuth helper (admin-only via middleware's /api/debug gate).
//
// Flow:
//   1. Create an OAuth app in Snapchat Business Manager with redirect URI
//      https://<your-domain>/api/debug/snap-oauth and put its Client ID /
//      Secret into SNAP_CLIENT_ID / SNAP_CLIENT_SECRET, then redeploy.
//   2. Visit /api/debug/snap-oauth → click the authorize link → approve in
//      Snapchat → you land back here with ?code=...
//   3. This page exchanges the code and shows the REFRESH TOKEN — put it in
//      SNAP_REFRESH_TOKEN (plus SNAP_AD_ACCOUNT_ID), redeploy, done forever.

function page(html: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2937;line-height:1.5">${html}</body>`,
    { headers: { 'content-type': 'text/html' } }
  );
}

export async function GET(req: NextRequest) {
  const clientId = (process.env.SNAP_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SNAP_CLIENT_SECRET || '').trim();
  const redirectUri = `${req.nextUrl.origin}/api/debug/snap-oauth`;
  const code = req.nextUrl.searchParams.get('code');

  if (!clientId || !clientSecret) {
    return page(`<h2>Snapchat setup — step 1 of 3</h2>
      <p>Missing <code>SNAP_CLIENT_ID</code> / <code>SNAP_CLIENT_SECRET</code>.</p>
      <ol>
        <li>In <b>business.snapchat.com</b> → Business Details → <b>OAuth Apps</b> → create an app named <code>rocknot-dashboard</code></li>
        <li>Set its <b>Redirect URI</b> to exactly:<br><code>${redirectUri}</code></li>
        <li>Copy the Client ID and Client Secret into Vercel env vars <code>SNAP_CLIENT_ID</code> and <code>SNAP_CLIENT_SECRET</code> (mark Sensitive), redeploy, then reload this page.</li>
      </ol>`);
  }

  if (!code) {
    const authUrl = `https://accounts.snapchat.com/login/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snapchat-marketing-api`;
    return page(`<h2>Snapchat setup — step 2 of 3</h2>
      <p>Click below and approve access with the Snapchat account that manages the Rocknot ads. You'll be sent back here automatically.</p>
      <p><a href="${authUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Authorize with Snapchat →</a></p>`);
  }

  // Exchange the one-time code for tokens.
  const res = await fetch('https://accounts.snapchat.com/login/oauth2/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    return page(`<h2>Exchange failed</h2><p>Snapchat said:</p><pre style="background:#f9fafb;padding:12px;border-radius:8px;overflow-x:auto">${JSON.stringify(json, null, 2)}</pre><p><a href="${redirectUri}">Try again</a></p>`);
  }

  return page(`<h2>Snapchat setup — step 3 of 3 ✅</h2>
    <p>Add these two Vercel environment variables (both Sensitive), then redeploy:</p>
    <p><b>SNAP_REFRESH_TOKEN</b></p>
    <pre style="background:#f9fafb;padding:12px;border-radius:8px;overflow-x:auto;word-break:break-all;white-space:pre-wrap">${json.refresh_token}</pre>
    <p><b>SNAP_AD_ACCOUNT_ID</b></p>
    <pre style="background:#f9fafb;padding:12px;border-radius:8px;overflow-x:auto">cd018406-4f67-4afc-85cb-8479a6a43698</pre>
    <p style="color:#6b7280;font-size:14px">Copy carefully as one line each (no line breaks — remember the sheet ID!). Once redeployed, the Today view overlays live Snapchat spend automatically. This page can then be ignored forever.</p>`);
}
