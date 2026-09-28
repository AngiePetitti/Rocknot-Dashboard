// The brand brief Cleo works from — who the brand is, who buys, the voice,
// and hard don'ts. Stored in KV (editable from the AI Insights page) so the
// operator can correct and extend it without a code change; these defaults
// seed it until then. One sentence of brand context wasn't enough: Cleo
// wrote bridal-ceremony copy for a Rocknot clutch because "clutch" was all
// she had to go on.
import { getClientId, type ClientId } from '@/src/lib/client';
import { getKV, setKV, isChatStoreConfigured } from '@/src/lib/chatStore';

const KV_KEY = 'brand_brief';

const DEFAULTS: Record<ClientId, string> = {
  rocknot: `WHO WE ARE: Rocknot is a DTC music-inspired accessories brand — rhinestone-covered handbags (with interchangeable straps), jewelry, phone accessories, and select apparel like the Statement Strings™ Hoodie. The aesthetic is rock-and-roll glamour: rhinestones, edge, sparkle, statement pieces.

WHO BUYS: Women who dress to stand out — concerts, festivals, girls' nights, everyday outfits that need an edge. This is NOT a bridal or occasion-formal brand. Product names (Eden, Lace, Fia, Pink Sugar, Ro Sling, Mosaic, Cobalt) are style/collection names, not occasions — never infer an occasion from a product name.

VOICE: Bold, fun, confident, a little rebellious — like your most stylish friend hyping you up. Short punchy lines. No formal or sentimental wedding-industry language.

HARD RULES:
- Never write bridal/wedding-themed copy unless the operator explicitly asks.
- "Statement Strings™ Hoodie" is always written exactly that way.
- When unsure what a product is, ask or check top-products data — never guess an occasion or use case.
- Never invent a campaign premise: no "restock", "back in stock", "sold out", "last chance", "limited drop" or any scarcity/availability claim unless the operator said it or the data shows it. If a campaign needs an angle and none was given, use the product's real selling points or ask.`,
  kaileep: `WHO WE ARE: Kailee P (kaileep.com) is a DTC bridal shoe brand — wedding heels, flats, and "something blue" styles, plus flower girl and kids shoes.

WHO BUYS: Women aged 25–34 planning their wedding; purchases are occasion-driven with a long planning window. Bridal accessories are natural add-ons.

VOICE: Romantic, warm, reassuring, elegant — big-day language is welcome here.

HARD RULES:
- Copy should speak to the bride and her big day; comfort + beauty is the core promise.`,
};

export function defaultBrief(): string {
  return DEFAULTS[getClientId()];
}

export async function getBrandBrief(): Promise<string> {
  if (!isChatStoreConfigured()) return defaultBrief();
  try {
    const stored = await getKV(KV_KEY);
    return (stored || '').trim() || defaultBrief();
  } catch {
    return defaultBrief();
  }
}

export async function setBrandBrief(brief: string): Promise<void> {
  await setKV(KV_KEY, brief.trim().slice(0, 12000));
}
