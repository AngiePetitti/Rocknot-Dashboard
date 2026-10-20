// One place for which Claude model each feature uses.
//
// BEST (Opus) is reserved for the few places where the writing itself is the
// product and runs rarely: the Insights analysis (cached), the report builder's
// main passes and the Trends brief. Everything routine — Cleo's tool turns,
// the daily brief, call notes, creative briefs, retention plan, brand profile,
// investigations, summaries — runs on FAST (Sonnet), which costs about a fifth
// as much per token. Override either with an env var without a code change.
export const AI_BEST = process.env.AI_MODEL_BEST || 'claude-opus-4-8';
export const AI_FAST = process.env.AI_MODEL_FAST || 'claude-sonnet-5-5';
