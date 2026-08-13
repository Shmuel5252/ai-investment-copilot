import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env first.");
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Single place to change the model — every AI orchestration function
// imports this rather than hardcoding a model string, so swapping models
// later (per docs/architecture.md's "provider-swappable" requirement)
// touches one line, not every call site.
export const CLAUDE_MODEL = "claude-sonnet-5";
