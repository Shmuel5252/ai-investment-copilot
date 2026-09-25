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
//
// Contradicting-stance semantic hardening (Strategy Grounding + Identity
// Hardening follow-up — found on real, human-reviewed Strategy data, not
// hypothetical): a compound hypothesis of the shape "does X because of Y,
// rather than Z" was being rejected as a contradicting citation even when
// the source clearly showed the investor NOT doing X — the model was
// additionally requiring the source to explain what alternative motive
// drove the counter-example, something it structurally cannot do when X
// itself never happened in that instance. The contradicting branch below
// now says explicitly: a clear counter-example to the material, headline
// behavior is sufficient on its own; an unobservable secondary clause
// (motive/manner) is not the same as an unproven one. This function's
// shared, generic interface is unchanged — DNA and Strategy both call the
// exact same checkEvidenceGrounding(), so this fix applies identically to
// both without any DNA- or Strategy-specific branching.
export interface EvidenceGroundingCheckInput {
  hypothesisStatement: string;
  stance: "supporting" | "contradicting";
  /** Evidence Reach V1: what kind of investor-authored statement the text is (an interview answer, or what they wrote when recording a decision). Default: interview answer. */
  sourceKind?: "interview_answer" | "decision_statement";
  /** The real, persisted InterviewAnswer.answerText — the sole source of truth. Never the AI-generated evidence description. */
  sourceAnswerText: string;
}

export type EvidenceGroundingVerdict = "supported" | "unsupported";

export interface EvidenceGroundingResult {
  verdict: EvidenceGroundingVerdict;
  /** One sentence, grounded in the real answer text — audit trail for why, never itself trusted as anything beyond an explanation. */
  reason: string;
}

const GROUNDING_SYSTEM_PROMPT = `You check whether a single real statement the investor wrote themselves, in its own actual words, genuinely grounds one specific claimed relationship — a hypothesis statement PLUS a specific stance, supporting or contradicting — not whether a separately-written description of it sounds plausible.

You will be given the hypothesis statement, the stance being claimed (supporting or contradicting), the kind of statement (an interview answer about a trade, or what the investor wrote when recording a decision: their reasoning, the risks they considered, or their exit conditions), and the real, verbatim statement text. The statement text is the ONLY source of truth — you have not been given and must ignore any other characterization of what it says. A decision statement shows what the investor believed, considered or planned at decision time; it never shows what happened afterwards, so a claim about outcomes, results or execution is not grounded by it.

The two stances are judged by DIFFERENT rules. Read the stance you were given and apply only the matching rule below — never apply the "supporting" test to a "contradicting" citation or vice versa:

- Stance = "supporting": the citation is grounded only when the statement's own words provide evidence FOR the hypothesis claim — genuinely establishing the behavior described. If the statement is silent on a material part of the claim, doesn't clearly match it, or actually contains details that undercut it (for example: the position wasn't actually profitable, the original thesis didn't actually hold, no real alternative is described, an external target was missed rather than met), it is NOT grounded.

- Stance = "contradicting": the citation is grounded only when the statement's own words provide evidence AGAINST the hypothesis claim — genuinely showing the investor did the opposite, or something clearly inconsistent with it. Going against the hypothesis is the CORRECT, INTENDED outcome for a contradicting citation — never reject it merely because it fails to support the hypothesis; that is not the test and never has been. When the hypothesis pairs a headline behavior with an attributed motive or manner ("does X because of Y, rather than Z"), a clear counter-example to the headline behavior is enough on its own to ground the contradiction — do not additionally require the answer to state an alternative motive for the counter-example, and do not reject the citation merely because the motive clause cannot be evaluated when the described behavior never happened in this instance; an unobservable secondary clause is not the same as an unproven one. Only reject a contradicting citation if the statement is silent on the material behavioral claim it is supposed to contradict, if it contradicts only a minor or non-material detail while leaving that material behavior unaddressed, or if the statement is actually consistent with / supports the hypothesis instead of going against it.

Do not soften your verdict because the claim sounds like a reasonable investing pattern in general — judge strictly against this one statement's own words. Respond only with the structured verdict.`;

const GROUNDING_TOOL = {
  name: "record_grounding_verdict",
  description: "Record whether the real statement text actually grounds the claimed stance.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["supported", "unsupported"],
        description: "Whether the statement's own words genuinely establish the claimed stance.",
      },
      reason: {
        type: "string" as const,
        description: "One sentence, grounded in the actual statement text, explaining the verdict.",
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
          content: `Hypothesis statement: ${input.hypothesisStatement}\nClaimed stance: ${input.stance}\nStatement kind: ${input.sourceKind === "decision_statement" ? "decision statement (what the investor wrote when recording a decision)" : "interview answer"}\n\nReal investor statement (verbatim, the only source of truth):\n${input.sourceAnswerText}`,
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
