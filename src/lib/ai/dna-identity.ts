import { anthropic, CLAUDE_MODEL } from "./client";

// Hypothesis Identity (Investment DNA — Evidence Grounding + Hypothesis
// Identity Hardening task). A real gap found on real data: every
// dna.generate call creates a brand-new DNAHypothesis identity for every
// proposed statement that survives validation — nothing checks it against
// existing active hypotheses (or against other proposals in the same
// batch) for being the same underlying claim. Two confirmed real
// examples: an old "cautious about leverage" hypothesis and a freshly
// proposed "avoid leveraged/speculative instruments" hypothesis are the
// same claim in different words; two hypotheses proposed in the SAME
// generation batch ("realize profits gradually to redeploy capital" and
// "sell a profitable position for a new opportunity") were effectively
// the same observation split in two.
//
// Deliberately a separate, narrow call from proposeDnaHypotheses — this
// never sees interview answers or evidence at all, only statement text.
// Whether an answer's citation is actually grounded (dna-grounding.ts) is
// a completely different question from whether two STATEMENTS describe
// the same behavioral claim; conflating them would make both harder to
// get right. Fail-closed direction here is the OPPOSITE of grounding's:
// on any failure or malformed response, default to `matchedId: null`
// (no match -> a new, separate identity) — over-splitting into an extra
// hypothesis a human can review and reject is always safer than an unsafe
// merge that silently blends two distinct behavioral claims into one
// version history ("sell winners from fear of a pullback" must never
// quietly become the same identity as "sell winners to redeploy capital"
// just because they share vocabulary).
export interface HypothesisMatchCandidate {
  /** A real dnaHypothesisId, or a synthetic id for a same-batch group not yet persisted. */
  id: string;
  statementText: string;
}

export interface HypothesisMatchResult {
  /** One of `candidates`' ids, or null if this is a genuinely new, distinct claim. */
  matchedId: string | null;
  reason: string;
}

const NO_MATCH = "NONE";

const IDENTITY_SYSTEM_PROMPT = `You decide whether a proposed behavioral claim about an investor is the SAME underlying claim as one already on a list, or is genuinely distinct.

"Same claim" means: a person reading both statements would say they're making the same point about the same tendency, just possibly worded differently (e.g. "cautious about using leverage without conviction" and "avoids leveraged or speculative instruments without concrete information" are the same claim).

They are NOT the same claim merely because they share topic or vocabulary, or because one could be read as a special case of a broader theme, when the actual trigger or reasoning described is meaningfully different. In particular: "sells winning positions out of fear of losing the gain or a pullback" and "sells a winning position to redeploy capital into a new, more attractive opportunity" are DIFFERENT claims — one is about fear/risk-aversion, the other is about opportunity cost — even though both involve selling a winner.

When genuinely unsure, prefer NOT matching — say so is not the same claim. An extra, separate hypothesis a human can review is always safer than silently merging two different claims into one.

You are given the proposed statement and a numbered list of candidate statements (each with an id). Respond with the id of the one candidate that is the SAME claim, or "${NO_MATCH}" if none is.`;

const IDENTITY_TOOL = {
  name: "record_match_verdict",
  description: "Record which existing candidate statement (if any) is the same underlying claim as the proposed one.",
  input_schema: {
    type: "object" as const,
    properties: {
      matchedId: {
        type: "string" as const,
        description: `The id of the matching candidate, or the literal string "${NO_MATCH}" if none of the candidates is the same claim.`,
      },
      reason: {
        type: "string" as const,
        description: "One sentence explaining the verdict.",
      },
    },
    required: ["matchedId", "reason"],
  },
};

function formatCandidates(candidates: readonly HypothesisMatchCandidate[]): string {
  return candidates.map((c) => `id: ${c.id}\nstatement: ${c.statementText}`).join("\n\n");
}

export async function classifyHypothesisMatch(
  proposedStatement: string,
  candidates: readonly HypothesisMatchCandidate[]
): Promise<HypothesisMatchResult> {
  if (candidates.length === 0) {
    return { matchedId: null, reason: "No existing candidates to compare against." };
  }

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system: IDENTITY_SYSTEM_PROMPT,
      tools: [IDENTITY_TOOL],
      tool_choice: { type: "tool", name: "record_match_verdict" },
      messages: [
        {
          role: "user",
          content: `Proposed statement:\n${proposedStatement}\n\nCandidates:\n${formatCandidates(candidates)}`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    return parseIdentityMatchResponse(toolUse, candidates);
  } catch {
    return { matchedId: null, reason: "Identity match call failed — failing closed to a new identity." };
  }
}

// Pure — no network call — exported so the fail-closed parsing itself
// (missing tool_use, wrong shape, an invented id not actually offered) is
// directly unit tested without mocking the Anthropic client. This is the
// exact logic classifyHypothesisMatch() above runs on a real response.
export function parseIdentityMatchResponse(
  toolUse: { type: string; input?: unknown } | undefined,
  candidates: readonly HypothesisMatchCandidate[]
): HypothesisMatchResult {
  if (!toolUse || toolUse.type !== "tool_use") {
    return { matchedId: null, reason: "Identity match returned no structured verdict — failing closed to a new identity." };
  }

  const raw = toolUse.input as { matchedId?: unknown; reason?: unknown };
  if (typeof raw.matchedId !== "string" || typeof raw.reason !== "string") {
    return { matchedId: null, reason: "Identity match returned a malformed verdict — failing closed to a new identity." };
  }

  if (raw.matchedId === NO_MATCH) {
    return { matchedId: null, reason: raw.reason };
  }

  const isRealCandidate = candidates.some((c) => c.id === raw.matchedId);
  if (!isRealCandidate) {
    // The model named an id that wasn't offered — never trust an
    // invented id; treat exactly like a malformed response.
    return { matchedId: null, reason: "Identity match named an unknown candidate id — failing closed to a new identity." };
  }

  return { matchedId: raw.matchedId, reason: raw.reason };
}
