import { anthropic, CLAUDE_MODEL } from "./client";
import { AFFIRMATIVE_STANCE_RULES } from "./stance-rules";

// Grounding Semantics V3 (Owner decision, frozen 2026-09-25): a
// CONTRADICTING citation is grounded only by AFFIRMATIVE evidence — the
// statement itself must establish the opposite or a clearly inconsistent
// belief/action. Silence, omission, a different action, ambiguity or
// uncertainty establish nothing and are judged unsupported (S += 0, C += 0).
// The shared rule text (stance-rules.ts) is the same one both proposers
// state; the persisted API stays supported | unsupported because the stance
// is an input, and the gate never flips a stance. Found on real data: the
// AVGO decision reasoning was persisted as contradicting a price-discipline
// claim solely because it did not mention price.
//
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
  /**
   * Grounding Semantics V3.2 (OD-V32-7): the interview question the answer
   * responded to — CONTEXT ONLY, never evidence. It may resolve what the
   * answer refers to; it never supplies a claim component. Interview answers
   * only: a decision statement has no question, and the gate drops this field
   * for one even if a caller passes it. Never persisted as evidence, never a
   * citation, never counted.
   */
  contextText?: string;
}

export type EvidenceGroundingVerdict = "supported" | "unsupported";

export interface EvidenceGroundingResult {
  verdict: EvidenceGroundingVerdict;
  /** One sentence, grounded in the real answer text — audit trail for why, never itself trusted as anything beyond an explanation. */
  reason: string;
  /**
   * Grounding Semantics V3.1 — TECHNICAL INVALID RESPONSE, not a semantic
   * verdict: the call failed, no tool call came back, the wrong tool was
   * called, or the value was outside the tool schema (the supervised run's
   * call #12 returned "contradicting"). `verdict` is still "unsupported" so
   * every consumer fails closed, but a technical failure is never evidence
   * that the citation was unsupported: generation excludes it and reports it
   * as technical, and remediation refuses to persist any check row or
   * version from it (src/lib/dna/remediate-grounding.ts).
   */
  technicalFailure?: true;
}

export const GROUNDING_TOOL_NAME = "record_grounding_verdict";

const GROUNDING_SYSTEM_PROMPT = `You check whether a single real statement the investor wrote themselves, in its own actual words, genuinely grounds one specific claimed relationship — a hypothesis statement PLUS a specific stance, supporting or contradicting — not whether a separately-written description of it sounds plausible.

You will be given five labelled parts: CLAIM (the hypothesis statement), STANCE (the stance being claimed, supporting or contradicting), SOURCE KIND (an interview answer about a trade, or a decision statement — what the investor wrote when recording a decision: their reasoning, the risks they considered, or their exit conditions), INVESTOR EVIDENCE (the real, verbatim statement text) and CONTEXT — NOT EVIDENCE (for an interview answer, the question it responded to; otherwise none). INVESTOR EVIDENCE is the ONLY source of evidence — you have not been given and must ignore any other characterization of what it says. CONTEXT is never evidence: it may resolve what the investor's answer refers to, and nothing else (INTERVIEW QUESTION — CONTEXT, NEVER EVIDENCE below). A decision statement shows what the investor believed, considered or planned at decision time; it never shows what happened afterwards, so a claim about outcomes, results or execution is not grounded by it.

${AFFIRMATIVE_STANCE_RULES}

You judge ONLY the stance you were given: "supported" means the statement affirmatively establishes THAT stance; "unsupported" means it does not. You never assert the other stance — a citation that fails as contradicting is not thereby supporting, and vice versa; a stance is never flipped.

The two stances are judged by DIFFERENT rules. Read the stance you were given and apply only the matching rule below — never apply the "supporting" test to a "contradicting" citation or vice versa:

- Stance = "supporting": the citation is grounded only when the statement's own words provide evidence FOR the hypothesis claim — genuinely establishing the behavior described. If the statement is silent on a material part of the claim, doesn't clearly match it, or actually contains details that undercut it (for example: the position wasn't actually profitable, the original thesis didn't actually hold, no real alternative is described, an external target was missed rather than met), it is NOT grounded. When the claim is conditional ("when X, tends to Y"), the statement must itself establish the material precondition X and the behavior Y: Y shown while X is unknown does not prove the conditional pattern and is unsupported. Apply COMPOUND CLAIMS: the statement must establish every material component the claim asserts — a partial match is unsupported.

- Stance = "contradicting": the citation is grounded only when the statement itself affirmatively establishes the opposite or a clearly inconsistent belief/action — the investor's own words must positively show that they believed or did something inconsistent with the claim in that instance. Going against the hypothesis is the CORRECT, INTENDED outcome for a contradicting citation — never reject it merely because it fails to support the hypothesis; that is not the test and never has been. When the hypothesis pairs a headline behavior with an attributed motive or manner ("does X because of Y, rather than Z"), a clear counter-example to the headline behavior is enough on its own to ground the contradiction — do not additionally require the answer to state an alternative motive for the counter-example, and do not reject the citation merely because the motive clause cannot be evaluated when the described behavior never happened in this instance; an unobservable secondary clause is not the same as an unproven one. Absence of mention is not evidence of absence: a statement that merely does not mention the claimed consideration or behavior, that describes a different action without showing it was taken in disregard of the claimed principle, that is vague or ambiguous, or that expresses uncertainty establishes nothing against the claim and must be judged unsupported. A decision statement is a partial record — do not infer decision-process facts it does not record. Do not transform a tendency claim ("tends to", "generally", "often") into a universal one ("always") to make a silent instance look like a counter-example. Apply COMPOUND CLAIMS before using this motive rule: a component the claim words as a condition (inside "when", "if", "after", "while" or "as long as") is a precondition the statement must establish, never an attributed motive to set aside. Apply MATERIAL PRECONDITIONS before judging: identify the claim's own trigger conditions (only those the claim contains — never add one), require the statement to affirmatively establish them, and only then ask whether it shows the opposite behavior; behavior outside the trigger conditions, or while the trigger is unknown, is not a counter-example and is unsupported. Reject a contradicting citation if the statement is silent on the material behavioral claim it is supposed to contradict, if it contradicts only a minor or non-material detail while leaving that material behavior unaddressed, if it is actually consistent with / supports the hypothesis instead of going against it, or if there is insufficient affirmative evidence of the opposite.

Do not soften your verdict because the claim sounds like a reasonable investing pattern in general — judge strictly against this one statement's own words. If there is insufficient affirmative evidence for the claimed stance, return unsupported. Respond only with the structured verdict.`;

// Strict tool use (Grounding Semantics V3.1). Root cause of the supervised
// run's call #12: this tool was the only production tool sent WITHOUT
// `strict: true`, so its enum was advisory and the model emitted
// "contradicting" — a value the schema does not allow — which only the parser
// caught. The collection generators (dna.ts, strategy.ts) already send
// strict tools; with `strict: true` the API constrains generation to the
// schema, so an out-of-enum verdict cannot be produced at the boundary. The
// parser below stays fail-closed as defense in depth and additionally
// labels such a result a TECHNICAL failure, never a semantic verdict.
export const GROUNDING_TOOL = {
  name: GROUNDING_TOOL_NAME,
  description: "Record whether the real statement text actually grounds the claimed stance.",
  strict: true,
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
    additionalProperties: false,
  },
};

function isValidVerdict(value: unknown): value is EvidenceGroundingVerdict {
  return value === "supported" || value === "unsupported";
}

const technical = (reason: string): EvidenceGroundingResult => ({ verdict: "unsupported", reason, technicalFailure: true });

// Pure — no network call — exported so the fail-closed parsing itself
// (missing tool_use, wrong tool, wrong shape, invalid enum value) is directly
// unit tested without mocking the Anthropic client at all. This is the exact
// logic checkEvidenceGrounding() below runs on a real response; a test
// exercising this function IS exercising production logic, not a
// parallel reimplementation of it. Every rejection here is a TECHNICAL
// failure (technicalFailure: true): the model did not deliver a verdict in
// the contract's form, so nothing semantic can be concluded either way.
export function parseGroundingResponse(
  toolUse: { type: string; name?: string; input?: unknown } | undefined
): EvidenceGroundingResult {
  if (!toolUse || toolUse.type !== "tool_use") {
    return technical("Grounding check returned no structured verdict — failing closed.");
  }
  if (toolUse.name !== undefined && toolUse.name !== GROUNDING_TOOL_NAME) {
    return technical(`Grounding check returned a call to the wrong tool (${toolUse.name}) — failing closed.`);
  }

  const raw = toolUse.input as { verdict?: unknown; reason?: unknown } | null | undefined;
  if (!raw || typeof raw !== "object" || !isValidVerdict(raw.verdict) || typeof raw.reason !== "string") {
    return technical("Grounding check returned a malformed verdict — failing closed.");
  }

  return { verdict: raw.verdict, reason: raw.reason };
}

// Grounding Semantics V3.2 (OD-V32-7) — the request's evidence/context
// boundary. Pure and exported so the exact wire text is unit tested without
// a client. Five labelled parts; the investor's text and the question never
// share a section. A decision statement never carries context: the field is
// dropped here, at the one place every caller passes through.
export const NO_CONTEXT = "(none)";

export function buildGroundingUserMessage(input: EvidenceGroundingCheckInput): string {
  const isDecisionStatement = input.sourceKind === "decision_statement";
  const context = isDecisionStatement ? "" : (input.contextText ?? "").trim();
  return [
    `CLAIM: ${input.hypothesisStatement}`,
    `STANCE: ${input.stance}`,
    `SOURCE KIND: ${isDecisionStatement ? "decision statement (what the investor wrote when recording a decision)" : "interview answer"}`,
    "",
    "INVESTOR EVIDENCE (verbatim — the only source of evidence):",
    input.sourceAnswerText,
    "",
    "CONTEXT — NOT EVIDENCE (the interview question the answer responded to; it may resolve what the answer refers to and never supplies a claim component):",
    context === "" ? NO_CONTEXT : context,
  ].join("\n");
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
          content: buildGroundingUserMessage(input),
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    return parseGroundingResponse(toolUse);
  } catch {
    // Network error, API error, rate limit, anything — never let a
    // grounding-check failure silently default to accepting the citation,
    // and never let it pass as a semantic verdict either (technical).
    return { verdict: "unsupported", reason: "Grounding check call failed — failing closed.", technicalFailure: true };
  }
}
