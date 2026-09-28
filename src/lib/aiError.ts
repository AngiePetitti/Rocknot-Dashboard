// Turn raw Anthropic API errors into messages an operator can act on —
// nobody should see a JSON blob in the chat bubble.
export function friendlyAiError(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err);
  if (/credit balance is too low/i.test(raw)) {
    return 'The Anthropic API account that powers me is out of credits, so I can\'t answer right now. Add credits at console.anthropic.com → Plans & Billing (and consider auto-reload so this doesn\'t happen again) — I\'ll be back the moment the balance is topped up.';
  }
  if (/rate.?limit|overloaded|529/i.test(raw)) {
    return 'The AI service is momentarily overloaded — wait a few seconds and ask again.';
  }
  if (/401|authentication|invalid x-api-key/i.test(raw)) {
    return 'The AI API key is invalid or was revoked — check ANTHROPIC_API_KEY in the Vercel project settings.';
  }
  return raw;
}
