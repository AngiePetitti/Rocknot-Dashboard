import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { saveDoc, loadDoc } from '@/src/lib/docStore';

export const maxDuration = 120;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const dynamic = 'force-dynamic';

// Rocknot's brand guidelines — pasted once, referenced by every AI
// generation (creative briefs, retention plans) so output follows the REAL
// brand, not assumptions.
export async function GET() {
  try {
    const text = await loadDoc('brand_guidelines');
    return NextResponse.json({ guidelines: text || '' });
  } catch {
    return NextResponse.json({ guidelines: '' });
  }
}

export async function PUT(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can edit brand guidelines' }, { status: 403 });
    }
  }
  let body: { guidelines?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  try {
    await saveDoc('brand_guidelines', String(body.guidelines ?? '').slice(0, 120000));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

// Upload the brand guide as a file (PDF, image, or txt/md) — Claude reads it
// and extracts the complete guidelines as text, which stays editable.
export async function POST(req: NextRequest) {
  if (authConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can upload brand guidelines' }, { status: 403 });
    }
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (4MB max) — export a smaller PDF or paste the text instead' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  try {
    let text: string;
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      text = buf.toString('utf-8');
    } else {
      if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Anthropic not configured' }, { status: 500 });
      const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
      const mediaType = isPdf ? 'application/pdf'
        : name.endsWith('.png') ? 'image/png'
        : 'image/jpeg';
      const block = isPdf
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: buf.toString('base64') } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg', data: buf.toString('base64') } };
      const msg = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            block,
            { type: 'text', text: 'This is a brand guidelines document. Transcribe EVERYTHING useful for a designer into plain text, preserving all specifics: every color with its exact hex/Pantone code, every font name and usage rule, logo usage rules, spacing rules, voice & tone descriptions, photography/art direction, and any do/do-not lists. Organize under clear headings. Output only the extracted guidelines.' },
          ],
        }],
      });
      text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
    }
    if (!text) return NextResponse.json({ error: 'Could not extract any text from that file' }, { status: 422 });
    await saveDoc('brand_guidelines', text.slice(0, 120000));
    return NextResponse.json({ ok: true, guidelines: text.slice(0, 120000) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
