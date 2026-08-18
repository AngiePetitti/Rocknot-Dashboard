import { NextRequest, NextResponse } from 'next/server';
import { qbConfigured, exchangeQbCode, setQbRealm } from '@/src/lib/qbAuth';

export const dynamic = 'force-dynamic';

// Self-serve QuickBooks Online connect wizard (admin-only via /api/debug
// middleware rule). Mirrors the Snapchat OAuth wizard:
//   Step 1: create the Intuit app, add env vars, revisit this page.
//   Step 2: click Connect → Intuit consent screen.
//   Step 3: callback lands here with ?code&realmId → tokens stored, done.
const REDIRECT_PATH = '/api/debug/qb-oauth';

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#1f2937;line-height:1.6}
     code{background:#f3f4f6;padding:2px 6px;border-radius:6px;font-size:13px}
     .btn{display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600}
     .ok{color:#16a34a}.warn{color:#d97706}</style></head><body><h2>${title}</h2>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}${REDIRECT_PATH}`;
  const code = req.nextUrl.searchParams.get('code');
  const realmId = req.nextUrl.searchParams.get('realmId');

  if (!qbConfigured()) {
    return page('QuickBooks — Step 1: create the Intuit app', `
      <ol>
        <li>Go to <a href="https://developer.intuit.com" target="_blank">developer.intuit.com</a> → sign in with the account that owns Rocknot's QuickBooks → <b>Create an app</b> → QuickBooks Online and Payments.</li>
        <li>In the app's <b>Keys &amp; credentials</b> (use the <b>Production</b> keys), copy the Client ID and Client Secret.</li>
        <li>Still there, add this exact <b>Redirect URI</b>: <code>${redirectUri}</code></li>
        <li>In Vercel, add env vars <code>QB_CLIENT_ID</code> and <code>QB_CLIENT_SECRET</code>, then redeploy.</li>
        <li>Come back to this page — it will show the Connect button.</li>
      </ol>`);
  }

  // Step 3: OAuth callback.
  if (code) {
    try {
      await exchangeQbCode(code, redirectUri);
      if (realmId) await setQbRealm(realmId);
      return page('QuickBooks connected ✓', `
        <p class="ok"><b>Done.</b> Tokens are stored (company ${realmId || 'unknown'}) and rotate automatically from here.</p>
        <p>Open the <a href="/dashboard/financials">Financials tab</a> — full P&amp;L line items now come straight from QuickBooks.</p>`);
    } catch (e) {
      return page('QuickBooks — connection failed', `<p class="warn">${String(e)}</p><p><a class="btn" href="${REDIRECT_PATH}">Try again</a></p>`);
    }
  }

  // Step 2: kick off consent.
  const authUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent((process.env.QB_CLIENT_ID || '').trim())}&response_type=code&scope=${encodeURIComponent('com.intuit.quickbooks.accounting')}&redirect_uri=${encodeURIComponent(redirectUri)}&state=rocknot`;
  return page('QuickBooks — Step 2: connect', `
    <p>Click below and approve access for <b>Rocknot LLC</b> (pick the Rocknot company file if Intuit asks which company).</p>
    <p><a class="btn" href="${authUrl}">Connect QuickBooks →</a></p>`);
}
