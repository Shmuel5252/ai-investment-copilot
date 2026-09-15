import { anthropic, CLAUDE_MODEL } from "./client";

// Evidence Grounding (Investment DNA — Evidence Grounding + Hypothesis
// Identity Hardening task). A real gap found on real data: the AI-written
// evidence *description* for a citation can selectively reframe what the
// source InterviewAnswer actually says (real example: a CAN sell answer
// describing a missed Nasdaq compliance deadline and a declining stock
// was cited as "sold a profitable position for a more attractive new
// opportunity, thesis intact" — none of that holds up against the
// answer's own words). validate-hypotheses.ts's existing checks (citation
// ID exists, stance is a real enum value, description non-empty) never
// look at this at all — they're purely structural.
//
// Deliberately a SEPARATE call from proposeDnaHypotheses, not a second
// pass over the same prompt — a distinct, narrower, STANCE-AWARE judgment
// over a distinct, smaller input (one hypothesis statement + one stance +
// one real answer, never the AI's own description, never the whole
// interview corpus). The question asked depends on the claimed stance,
// not one generic "does this support the claim?" test applied to both:
// for a citation proposed as supporting, "does THIS one real answer, in
// its own words, actually support THIS one specific claim"; for a
// citation proposed as contradicting, "does THIS one real answer, in its
// own words, actually go AGAINST THIS one specific claim" — going against
// the hypothesis is the correct, intended outcome for a contradicting
// citation, never grounds for rejecting it (see GROUNDING_SYSTEM_PROMPT
// below for the exact two-branch contract). Either way, the real,
// persisted InterviewAnswer.answerText is the sole source of truth — the
// AI-generated evidence description is never sent to this function at
// all, let alone treated as authoritative. This is a fail-CLOSED
// function: it never throws — any error, network failure, or malformed
// model response resolves to `unsupported`, never to a default
// "supported". Callers must never override that default; "the grounding
// call failed" and "the citation is ungrounded" have to look identical to
// every caller, or the fail-closed guarantee doesn't actually hold end to
// end.
export interface EvidenceGroundingCheckInput {
  hypothesisStatement: string;
  stance: "supporting" | "contradicting";
  /** The real, persisted InterviewAnswer.answerText — the sole source of truth. Never the AI-generated evidence description. */
  sourceAnswerText: string;
}

export type EvidenceGroundingVerdict = "supported" | "unsupported";

export interface EvidenceGroundingResult {
  verdict: EvidenceGroundingVerdict;
  /** One sentence, grounded in the real answer text — audit trail for why, never itself trusted as anything beyond an explanation. */
  reason: string;
}

const GROUNDING_SYSTEM_PROMPT = `You check whether a single real interview answer, in its own actual words, genuinely grounds one specific claimed relationship — a hypothesis statement PLUS a specific stance, supporting or contradicting — not whether a separately-written description of it sounds plausible.

You will be given the hypothesis statement, the stance being claimed (supporting or contradicting), and the real, verbatim interview answer text. The answer text is the ONLY source of truth — you have not been given and must ignore any other characterization of what it says.

The two stances are judged by DIFFERENT rules. Read the stance you were given and apply only the matching rule below — never apply the "supporting" test to a "contradicting" citation or vice versa:

- Stance = "supporting": the citation is grounded only when the answer's own words provide evidence FOR the hypothesis claim — genuinely establishing the behavior described. If the answer is silent on a material part of the claim, doesn't clearly match it, or actually contains details that undercut it (for example: the position wasn't actually profitable, the original thesis didn't actually hold, no real alternative is described, an external target was missed rather than met), it is NOT grounded.

- Stance = "contradicting": the citation is grounded only when the answer's own words provide evidence AGAINST the hypothesis claim — genuinely showing the investor did the opposite, or something clearly inconsistent with it. Going against the hypothesis is the CORRECT, INTENDED outcome for a contradicting citation — never reject it merely because it fails to support the hypothesis; that is not the test and never has been. Only reject a contradicting citation if the answer is silent on the material part of the claim it is supposed to contradict, or if the answer is actually consistent with / supports the hypothesis instead of going against it.

Do not soften your verdict because the claim sounds like a reasonable investing pattern in general — judge strictly against this one answer's own words. Respond only with the structured verdict.`;

const GROUNDING_TOOL = {
  name: "record_grounding_verdict",
  description: "Record whether the real answer text actually grounds the claimed stance.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["supported", "unsupported"],
        description: "Whether the answer's own words genuinely establish the claimed stance.",
      },
      reason: {
        type: "string" as const,
        description: "One sentence, grounded in the actual answer text, explaining the verdict.",
      },
    },
    required: ["verdict", "reason"],
  },
};

function isValidVerdict(value: unknown): value is EvidenceGroundingVerdict {
  return value === "supported" || value === "unsupported";
}

// Pure — no network call — exported so the fail-closed parsing itself
// (missing tool_use, wrong shape, invalid enum value) is directly unit
// tested without mocking the Anthropic client at all. This is the exact
// logic checkEvidenceGrounding() below runs on a real response; a test
// exercising this function IS exercising production logic, not a
// parallel reimplementation of it.
export function parseGroundingResponse(
  toolUse: { type: string; input?: unknown } | undefined
): EvidenceGroundingResult {
  if (!toolUse || toolUse.type !== "tool_use") {
    return { verdict: "unsupported", reason: "Grounding check returned no structured verdict — failing closed." };
  }

  const raw = toolUse.input as { verdict?: unknown; reason?: unknown };
  if (!isValidVerdict(raw.verdict) || typeof raw.reason !== "string") {
    return { verdict: "unsupported", reason: "Grounding check returned a malformed verdict — failing closed." };
  }

  return { verdict: raw.verdict, reason: raw.reason };
}

export async function checkEvidenceGrounding(
  input: EvidenceGroundingCheckInput
): Promise<EvidenceGroundingResult> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system: GROUNDING_SYSTEM_PROMPT,
      tools: [GROUNDING_TOOL],
      tool_choice: { type: "tool", name: "record_grounding_verdict" },
      messages: [
        {
          role: "user",
          content: `Hypothesis statement: ${input.hypothesisStatement}\nClaimed stance: ${input.stance}\n\nReal interview answer (verbatim, the only source of truth):\n${input.sourceAnswerText}`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    return parseGroundingResponse(toolUse);
  } catch {
    // Network error, API error, rate limit, anything — never let a
    // grounding-check failure silently default to accepting the citation.
    return { verdict: "unsupported", reason: "Grounding check call failed — failing closed." };
  }
}
