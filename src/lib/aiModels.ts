// One place for which Claude model each feature uses.
//
// BEST (Opus) is used only by the Insights analysis, which is cached for 12
// hours. Everything else — Cleo, reports, call notes, creative briefs, the
// retention plan, brand profile — runs on FAST (Sonnet), about a fifth the
// price per token. Override either with an env var without a code change.
export const AI_BEST = process.env.AI_MODEL_BEST || 'claude-opus-4-8';
export const AI_FAST = process.env.AI_MODEL_FAST || 'claude-sonnet-5-5';
