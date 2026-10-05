import Anthropic from "@anthropic-ai/sdk";
import { AI_MAX_RETRIES, AI_TIMEOUT_MS } from "./timeout";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env first.");
}

// The timeout/retry values and the timeout message live in ./timeout (no
// side effects); re-exported so existing imports keep working.
export { AI_MAX_RETRIES, AI_TIMEOUT_MS };

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: AI_TIMEOUT_MS,
  maxRetries: AI_MAX_RETRIES,
});

// Single place to change the model — every AI orchestration function
// imports this rather than hardcoding a model string, so swapping models
// later (per docs/architecture.md's "provider-swappable" requirement)
// touches one line, not every call site.
export const CLAUDE_MODEL = "claude-sonnet-5";
