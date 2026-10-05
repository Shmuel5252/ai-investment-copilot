import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";

// No side effects on import (no env check, no client): src/server/trpc.ts
// imports this, and the base tRPC layer must not depend on building the AI
// client. src/lib/ai/client.ts imports the constants from here.

// SDK defaults are 10 minutes per attempt and 2 retries (~30 minutes worst case); these cap a call at ~10 minutes.
export const AI_TIMEOUT_MS = 300_000;
export const AI_MAX_RETRIES = 1;

// What each procedure whose AI call can throw has already written when that
// call times out. Grounding and identity checks never throw (they fail
// closed), so procedures that call only those are absent.
const MARKET_CACHE_NOTE = "market data fetched before the AI call may have been cached";
const SAVED_ON_TIMEOUT: Record<string, string> = {
  "cases.generateSynthesis": `the case was not updated (${MARKET_CACHE_NOTE})`,
  "cases.generatePersonalFit": `the case was not updated (${MARKET_CACHE_NOTE})`,
  "decisions.create": `no decision was recorded (${MARKET_CACHE_NOTE}, and the market context captured for it may have been saved)`,
  "reviews.generate": `no review was saved (${MARKET_CACHE_NOTE})`,
  "dna.generate": "nothing was saved by this step",
  "strategy.proposeDeclared": "nothing was saved by this step",
  "strategy.generateObserved": "nothing was saved by this step",
  "interview.start": "nothing was saved by this step",
  "learning.generate": "insights for sector families processed earlier in this run may already have been saved; the remaining families were not processed",
};

// The user-facing message for an AI timeout, or null when `err` is not one.
export function aiTimeoutMessage(err: unknown, path: string | undefined): string | null {
  if (!(err instanceof APIConnectionTimeoutError)) return null;
  const saved = SAVED_ON_TIMEOUT[path ?? ""] ?? "some results of this step may already have been saved";
  return `AI call timed out (limit: ${AI_TIMEOUT_MS / 60_000} minutes per attempt, ${AI_MAX_RETRIES} ${AI_MAX_RETRIES === 1 ? "retry" : "retries"}); ${saved}.`;
}
