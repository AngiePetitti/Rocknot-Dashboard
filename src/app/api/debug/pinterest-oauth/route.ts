import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/src/lib/client';
import { exchangePinterestCode, pinterestAppConfigured, pinterestAuthorizeUrl, pinterestConnectionStatus } from '@/src/lib/pinterestAuth';
import { pinterestAccountIds, pinterestAttribution } from '@/src/lib/pinterestLive';

export const dynamic = 'force-dynamic';

// Self-serve Pinterest Ads API connect wizard (admin-only via the /api/debug
// middleware rule). Same three steps as the QuickBooks wizard:
//   Step 1: create the Pinterest app, add env vars, revisit this page.
//   Step 2: click Connect → Pinterest consent screen.
//   Step 3: callback lands here with ?code → tokens stored, done.
const REDIRECT_PATH = '/api/debug/pinterest-oauth';

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#1f2937;line-height:1.6}
     code{background:#f3f4f6;padding:2px 6px;border-radius:6px;font-size:13px}
     .btn{display:inline-block;background:#e11d48;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600}
     .ok{color:#16a34a}.warn{color:#d97706}</style></head><body><h2>${title}</h2>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: NextRequest) {
  const client = getClient();
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}${REDIRECT_PATH}`;
  const code = req.nextUrl.searchParams.get('code');
  const err = req.nextUrl.searchParams.get('error');
  const a = pinterestAttribution();

  if (!pinterestAppConfigured()) {
    return page('Pinterest — Step 1: create the Pinterest app', `
      <ol>
        <li>Go to <a href="https://developers.pinterest.com/apps/" target="_blank">developers.pinterest.com/apps</a> signed in as the Pinterest user that has access to ${client.name}'s ad accounts → <b>Create app</b> (any name, e.g. "${client.name} Dashboard").</li>
        <li>On the app page copy the <b>App ID</b> and <b>App secret key</b>.</li>
        <li>Under <b>Redirect URIs</b> add exactly: <code>${redirectUri}</code></li>
        <li>In Vercel → Settings → Environment Variables, add <code>PINTEREST_APP_ID</code> and <code>PINTEREST_APP_SECRET</code>, then redeploy.</li>
        <li>Come back to this page — it will show the Connect button.</li>
      </ol>
      <p>Trial access is enough: the token only ever reads ${client.name}'s own ad accounts.</p>`);
  }

  if (err) {
    return page('Pinterest — connection refused', `<p class="warn">Pinterest returned: ${err}</p><p><a class="btn" href="${REDIRECT_PATH}">Try again</a></p>`);
  }

  // Step 3: OAuth callback.
  if (code) {
    try {
      await exchangePinterestCode(code, redirectUri);
      return page('Pinterest connected ✓', `
        <p class="ok"><b>Done.</b> Tokens are stored and rotate automatically from here.</p>
        <p>The dashboard now reads Pinterest spend, checkouts and checkout value straight from the Pinterest Ads API on
        <b>${a.clickWindowDays}-day click · ${a.engagementWindowDays}-day engagement · ${a.viewWindowDays}-day view</b>,
        reported ${a.conversionReportTime === 'TIME_OF_CONVERSION' ? 'by conversion date' : 'by ad date'} — the same conversion settings as Ads Manager.</p>
        <p>Check the match on <a href="/api/debug/pinterest-api?days=7">/api/debug/pinterest-api?days=7</a>, then open the <a href="/dashboard/ads">Ad Performance tab</a>.</p>
        <p>This connection also reads ${client.name}'s <b>organic pins</b> through Business Access (acting via the ad account) for the Organic Content tab — check <a href="/api/debug/organic?tf=30d">/api/debug/organic?tf=30d</a> → pinterestDirect.</p>`);
    } catch (e) {
      return page('Pinterest — connection failed', `<p class="warn">${String(e)}</p><p><a class="btn" href="${REDIRECT_PATH}">Try again</a></p>`);
    }
  }

  // Step 2: kick off consent.
  const status = await pinterestConnectionStatus();
  const authUrl = pinterestAuthorizeUrl(redirectUri, client.id);
  return page('Pinterest — Step 2: connect', `
    ${status.connected ? `<p class="ok">Already connected${status.connectedAt ? ` on ${status.connectedAt.slice(0, 10)}` : ''}. Reconnecting replaces the stored token.</p>` : ''}
    <p>Click below and approve read access for ${client.name}'s ad account${pinterestAccountIds().length > 1 ? 's' : ''} (${pinterestAccountIds().join(', ') || 'none configured'}).</p>
    <p><a class="btn" href="${authUrl}">Connect Pinterest →</a></p>`);
}
