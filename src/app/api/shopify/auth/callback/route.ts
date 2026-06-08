import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!;
const SHOP = 'shop-rocknot.myshopify.com';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No code returned from Shopify' }, { status: 400 });
  }

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  });

  const data = await res.json();

  if (!data.access_token) {
    return NextResponse.json({ error: 'Failed to get token', details: data }, { status: 400 });
  }

  // Display the token — copy it and add to Vercel as SHOPIFY_ACCESS_TOKEN
  return new NextResponse(
    `<html><body style="font-family:monospace;padding:40px;background:#111;color:#0f0">
      <h2 style="color:#fff">✅ Shopify OAuth Success</h2>
      <p style="color:#aaa">Copy this token and add it to Vercel as <strong style="color:#fff">SHOPIFY_ACCESS_TOKEN</strong></p>
      <div style="background:#000;padding:20px;border-radius:8px;word-break:break-all;font-size:14px;margin:20px 0">
        ${data.access_token}
      </div>
      <p style="color:#aaa">Then redeploy on Vercel. You can delete the SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET env vars after.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
