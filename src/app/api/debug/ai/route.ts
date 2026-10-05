import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

// Admin-only (via /api/debug middleware rule): which Anthropic API key is this
// deployment using, and does it work right now? Shows only the key's edges —
// enough to match it against console.anthropic.com's key list, never the key.
export async function GET() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return NextResponse.json({ configured: false, error: 'ANTHROPIC_API_KEY is not set in Vercel' });

  const fingerprint = `${key.slice(0, 14)}…${key.slice(-4)}`;
  const client = new Anthropic({ apiKey: key });
  try {
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return NextResponse.json({
      configured: true,
      keyFingerprint: fingerprint,
      status: 'WORKING — the key authenticated and the account has credits. Cleo should be fine; if she still errors, hard-refresh the page.',
    });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    return NextResponse.json({
      configured: true,
      keyFingerprint: fingerprint,
      status: 'FAILING',
      apiError: msg.slice(0, 300),
      howToFix: /credit balance/i.test(msg)
        ? 'This key\'s account/organization has no credits. In console.anthropic.com, open API Keys and find the key ending in the four characters shown above — note which ORGANIZATION it belongs to (top-left switcher). Add credits to THAT organization, or create a new key in the funded organization and replace ANTHROPIC_API_KEY in Vercel (both Rocknot and Kailee P projects), then redeploy.'
        : 'See apiError — if authentication failed, the key was revoked: create a new one and update ANTHROPIC_API_KEY in Vercel.',
    });
  }
}
