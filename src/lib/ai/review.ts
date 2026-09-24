import { anthropic, CLAUDE_MODEL } from "./client";
import { CITABLE_SNAPSHOT_FIELDS, EXECUTION_FACTS_CITABLE_FIELD, PRIOR_RECORD_CITABLE_FIELD } from "@/lib/review/validate-review-dimensions";
import { formatSizeDollarsLine } from "./format-price-size";
import type { DecisionOutcome } from "@/lib/review/decision-outcome";
import { formatPriorRecordContext, QUOTED_HISTORY_RULES, type PriorRecordDecisionContextV1 } from "@/lib/prior-record/ai-context";

// Decision Review's two layers (docs/architecture.md §2.7): a short
// narrative (layer 1) and a 7-dimension drill-down (layer 2), plus
// Thesis Accuracy. Outcome (P/L) is never given to the model to
// "judge" — it's passed in only as already-computed context, same as
// everywhere else in this codebase that Outcome/P&L stays code-only.
// decision_quality_overall itself is NOT produced here — it's rolled up
// deterministically from the 7 verdicts by
// src/lib/review/decision-quality.ts after this returns.

export interface ReviewInput {
  ticker: string;
  decisionType: string;
  decisionDate: string;
  priceAtDecision: number;
  sizeDollars: number | null;
  userReasoningText: string;
  risksConsideredText: string | null;
  exitConditionsText: string | null;
  aiRealtimeAssessmentText: string | null;
  thesisText: string;
  thesisInterpretationText: string | null;
  portfolioStateAtDecision: { cash: number; positions: { ticker: string; quantity: number }[] };
  marketContextAtDecision: {
    indexLevel: number | null;
    indexChange1d: number | null;
    volatilityIndexValue: number | null;
  };
  caseMarketIntelligenceSummary: string; // pre-formatted, from the frozen investment_case_snapshot_json
  caseBullCaseText: string | null;
  caseBearCaseText: string | null;
  caseCatalystsText: string | null;
  caseInvalidationConditionsText: string | null;
  caseMarketBlindspotText: string | null;
  caseDevilsAdvocateText: string | null;
  casePersonalFitText: string | null;
  casePortfolioFitText: string | null;
  strategyPrinciplesInEffect: { statementText: string; principleType: string; evidenceStrength: string | null }[];
  dnaHypothesesInEffect: { statementText: string; evidenceStrength: string }[];
  // kind is null only for predictions created before this distinction
  // existed (never backfilled — see src/db/schema/enums.ts).
  predictionsWithResolutions: {
    claimText: string;
    kind: "forecast" | "reentry_condition" | null;
    status: string;
    resolutionNote: string | null;
  }[];
  /**
   * Additions made after the original decision, never edits to it
   * (docs/CLAUDE.md Historical Integrity: Original Snapshot -> Later
   * Context -> Review). Real case this exists for: aiRealtimeAssessmentText
   * or a Prediction turned out to contain a real AI error (e.g. confusing
   * position size with per-share price) — a Later Context entry is how
   * that gets corrected without rewriting the frozen original text, and
   * this review must treat it as authoritative over whatever it conflicts
   * with in the original snapshot fields.
   */
  laterContexts: { text: string; addedAt: string }[];
  /**
   * The investor's prior record on this ticker exactly as it was FROZEN into
   * the snapshot at decision time (decision_snapshots.prior_record_json),
   * through the same projection the Decision AI received — never recomputed.
   * null = a legacy decision recorded before capture: NOT CAPTURED / unknown.
   */
  priorRecordAtDecision: PriorRecordDecisionContextV1 | null;
  /**
   * Decision Follow-Through V1: the investor-CONFIRMED execution facts of
   * this decision (src/db/repositories/execution-facts.ts) — which same-ticker
   * trades executed it, and how many they marked unrelated. Facts of the
   * action taken (side, date, quantity, trade price, amount), never a return.
   * No facts at all = whether it was executed is UNKNOWN.
   */
  executionFacts: ExecutionFactsForReview;
  outcome: DecisionOutcome;
}

export interface ExecutionFactsForReview {
  executed: { transactionType: string; transactionDate: string; quantity: number | null; price: number | null; amount: number; note: string | null }[];
  unrelatedCount: number;
}

export type ThesisAccuracy =
  | "confirmed"
  | "partially_confirmed"
  | "refuted"
  | "inconclusive"
  | "insufficient_evidence";

export interface ProposedReviewDimensionOutput {
  dimension: string;
  verdict: "strong" | "reasonable" | "weak" | "insufficient_evidence";
  rationaleText: string;
  citedSnapshotFields: string[];
}

export interface ProposedDecisionReview {
  narrativeSummaryText: string;
  thesisAccuracy: ThesisAccuracy;
  dimensions: ProposedReviewDimensionOutput[];
}

const DIMENSION_LIST = [
  "thesis_quality — how sound and specific the thesis was, given what was actually known at decision time",
  "evidence_quality — how well-grounded the reasoning was in real evidence (DNA/Strategy/market data), not just conviction",
  "risk_awareness — whether real risks were identified and considered, not just upside",
  "valuation_awareness — whether the price paid relative to available valuation data was considered",
  "portfolio_fit — whether the resulting exposure/concentration was reasonable given the rest of the portfolio",
  "strategy_consistency — whether the decision was consistent with the investor's own Strategy principles in effect at the time, or a deliberate, acknowledged exception",
  "exit_conditions — whether a real exit/invalidation plan was defined before or at the decision",
].join("\n");

const SYSTEM_PROMPT = `You review a personal investor's past investing decision, using only what they actually knew/recorded at decision time (frozen in a Decision Snapshot) plus what's happened since (Outcome, already computed in code and given to you as a fact — you do not compute or judge P&L yourself). Any DNA hypothesis or Strategy principle you're given already has real evidence behind it — thin/unconfirmed (insufficient_evidence) ones have already been excluded before reaching you, so treat everything you're given as genuinely evidenced, not something to second-guess as too weak.

If any laterContexts are given, they are corrections or clarifications the investor added after the original decision. Two kinds: (1) a specific fact in the frozen snapshot turned out to be wrong (e.g. aiRealtimeAssessmentText, a Prediction's wording) — treat laterContexts as authoritative wherever they conflict, and do not repeat or rely on the claim that was corrected; (2) the decision itself is flagged as not representative of genuine behavior (e.g. a deliberate test, an atypical trade) — if so, say so plainly in narrativeSummaryText and let thesis_quality/evidence_quality reflect that this wasn't a real thesis being tested, rather than reviewing it as if it were an ordinary decision.

You produce two things:

1. thesisAccuracy: based on the given prediction resolutions (each already resolved by the investor themselves as confirmed/refuted/inconclusive — you do not decide whether a prediction came true, only synthesize an overall category from resolutions you're given). Each prediction has a "kind": "forecast" predictions are independent stated beliefs — weigh each on its own. "reentry_condition" predictions are triggers for reconsidering the decision, not beliefs about what would happen — do NOT treat one refuted reentry_condition the same as a refuted forecast. Read userReasoningText/exitConditionsText (given in full above) to tell whether several reentry_condition predictions were alternatives ("I'd reconsider if X, or Y, or Z" — only one needed to hold) or all separately required; if they were alternatives, one confirmed among them means that part of the reasoning held even if the others stayed unresolved or were refuted — don't let unfired siblings drag thesisAccuracy down. If there are no predictions, or none have been resolved, use "insufficient_evidence" — that is a normal, expected result, not a failure.

2. Exactly these 7 ReviewDimension verdicts, each strong/reasonable/weak/insufficient_evidence, each with a rationale AND a list of citedSnapshotFields:
${DIMENSION_LIST}

Ground rules for the dimensions:
- Every verdict except insufficient_evidence MUST cite at least one real field from this exact list — do not invent a field name: ${CITABLE_SNAPSHOT_FIELDS.join(", ")}, ${PRIOR_RECORD_CITABLE_FIELD} only when the priorRecord section is captured, and ${EXECUTION_FACTS_CITABLE_FIELD} only when the executionFacts section holds at least one investor-confirmed fact.
- If you cannot point to something concrete for a dimension, its verdict must be insufficient_evidence — this is a completely normal, expected outcome for some dimensions (e.g. no risksConsideredText was ever recorded), not a failure on your part.
- Be honest and specific — don't default everything to "reasonable". A dimension with real, cited weaknesses is "weak"; a dimension genuinely well-handled with clear evidence is "strong".
- Never invent a fact (a number, an event, a company detail) beyond what's in the data you were given.

The priorRecord section is the investor's own earlier record on this ticker exactly as it was frozen when this decision was made — what was actually in front of them (and of the AI) at the time. You may assess whether the decision engaged with it (e.g. a re-entry condition the investor had set earlier, or reasoning that repeats or departs from their earlier reasoning), citing "priorRecord". A past action there is not evidence that this decision was right or wrong, and a past outcome is never proof of decision quality. Never infer performance from it.
${QUOTED_HISTORY_RULES}
If the section says NOT CAPTURED, that history is unknown: do not cite priorRecord, and neither credit nor penalize the decision for it.

The executionFacts section is POST-DECISION information, like laterContexts and Outcome: it was not available when the decision was made and says nothing about what the investor knew then (everything frozen in the snapshot — the texts, case sections, portfolio state, market context, Strategy/DNA in effect, priorRecord — is AT-DECISION information). It holds only what the investor CONFIRMED about follow-through: which same-ticker trades they say executed this decision (side, date, quantity, trade price, amount) and how many nearby trades they marked as unrelated. Use it only to describe follow-through — what was done, when, and at what size relative to the decided size — as a fact about the investor's process, citing "executionFacts". It is never a verdict: a size that matches or differs from the decided size, an execution or a non-execution, or a trade marked unrelated to a PASS/HOLD, is not by itself evidence that the decision was good or bad. A trade price is the price of that trade, never a return: do not compute or infer performance from it, and never treat execution or non-execution as proof the decision was good or bad. If the section says NOT ASSERTED, whether and how the decision was executed is unknown — never "not executed" — do not cite executionFacts, and neither credit nor penalize the decision for it.

Then write narrativeSummaryText: a short (2-4 sentence), plain-language summary a busy person could read alone — mention process quality, thesis accuracy, and outcome as three distinct things (never conflate "made money" with "good process"), and end with one concrete, specific takeaway for next time.`;

const TOOL = {
  name: "submit_decision_review",
  description: "Submit a two-layer Decision Review: narrative summary, thesis accuracy, and 7 dimension verdicts.",
  input_schema: {
    type: "object" as const,
    properties: {
      narrativeSummaryText: { type: "string" as const },
      thesisAccuracy: {
        type: "string" as const,
        enum: ["confirmed", "partially_confirmed", "refuted", "inconclusive", "insufficient_evidence"],
      },
      dimensions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            dimension: {
              type: "string" as const,
              enum: [
                "thesis_quality",
                "evidence_quality",
                "risk_awareness",
                "valuation_awareness",
                "portfolio_fit",
                "strategy_consistency",
                "exit_conditions",
              ],
            },
            verdict: {
              type: "string" as const,
              enum: ["strong", "reasonable", "weak", "insufficient_evidence"],
            },
            rationaleText: { type: "string" as const },
            citedSnapshotFields: { type: "array" as const, items: { type: "string" as const } },
          },
          required: ["dimension", "verdict", "rationaleText", "citedSnapshotFields"],
        },
      },
    },
    required: ["narrativeSummaryText", "thesisAccuracy", "dimensions"],
  },
};

// Exported for direct unit testing — see tests/unit/format-price-size.test.ts,
// which proves priceAtDecision and sizeDollars are never presented in a
// way that could be misread as the same number (the real LLY bug this
// was extracted to fix: see format-price-size.ts).
export function formatOutcome(o: DecisionOutcome): string {
  const parts = [
    `Price at decision: $${o.priceAtDecision} — current price: ${o.currentPrice !== null ? `$${o.currentPrice}` : "unavailable"}`,
    o.priceChangePercent !== null ? `Price change since decision: ${o.priceChangePercent >= 0 ? "+" : ""}${o.priceChangePercent.toFixed(1)}%` : "Price change: unavailable",
  ];
  if (o.sizeDollars !== null) {
    parts.push(formatSizeDollarsLine("Size at decision", o.sizeDollars, "above"));
    if (o.pnlUsd !== null) parts.push(`P&L: $${o.pnlUsd.toFixed(2)} (${o.pnlPercent?.toFixed(1)}%)`);
  } else {
    parts.push("No size was recorded (nothing was actually bought/sold).");
  }
  parts.push(o.stillHeld ? "Still held today." : "Not currently held.");
  return parts.join("\n");
}

// Exported for direct unit testing (tests/unit/decision-follow-through.test.ts).
export function formatExecutionFacts(facts: ExecutionFactsForReview, sizeDollars: number | null): string {
  if (facts.executed.length === 0 && facts.unrelatedCount === 0) {
    return "NOT ASSERTED — the investor has not marked any trade as executing this decision or as unrelated to it. Whether and how it was executed is UNKNOWN (not \"not executed\").";
  }
  const lines = [
    facts.executed.length === 0
      ? "Executed by: no trade — every nearby same-ticker trade the investor reviewed was marked unrelated."
      : "Executed by (confirmed by the investor):",
    ...facts.executed.map(
      (t) =>
        `- ${t.transactionType} ${t.quantity ?? "?"} @ ${t.price !== null ? "$" + t.price.toFixed(2) : "?"}/share on ${t.transactionDate.slice(0, 10)}, amount $${Math.abs(t.amount).toFixed(2)} (the trade price — NOT a return)${t.note ? ` — investor note: "${t.note}"` : ""}`
    ),
    sizeDollars !== null
      ? formatSizeDollarsLine("Decided size (recorded at decision time)", sizeDollars, "above")
      : "Decided size (recorded at decision time): none was recorded.",
    `Same-ticker trades the investor marked as NOT executions of this decision: ${facts.unrelatedCount}`,
  ];
  return lines.join("\n");
}

// Exported for direct unit testing (tests/unit/prior-record-ai-context.test.ts).
export function formatInput(input: ReviewInput): string {
  const parts = [
    `Decision: ${input.decisionType} ${input.ticker} on ${input.decisionDate}`,
    `\n=== userReasoningText (verbatim) ===\n${input.userReasoningText}`,
    `\n=== thesisText / thesisInterpretationText ===\n${input.thesisText}\n${input.thesisInterpretationText ?? "(no AI interpretation recorded)"}`,
    `\n=== risksConsideredText ===\n${input.risksConsideredText ?? "(none recorded)"}`,
    `\n=== exitConditionsText ===\n${input.exitConditionsText ?? "(none recorded)"}`,
    `\n=== aiRealtimeAssessmentText (given at decision time) ===\n${input.aiRealtimeAssessmentText ?? "(none)"}`,
    `\n=== laterContexts (added after the decision — authoritative over anything above that they correct) ===\n${input.laterContexts.map((lc) => `[${lc.addedAt}] ${lc.text}`).join("\n") || "(none)"}`,
    `\n=== caseMarketIntelligence (at decision time) ===\n${input.caseMarketIntelligenceSummary}`,
    `\n=== case bull/bear/catalysts/invalidation/blindspot/devil's-advocate/personalFit/portfolioFit ===`,
    `caseBullCaseText: ${input.caseBullCaseText ?? "(none)"}`,
    `caseBearCaseText: ${input.caseBearCaseText ?? "(none)"}`,
    `caseCatalystsText: ${input.caseCatalystsText ?? "(none)"}`,
    `caseInvalidationConditionsText: ${input.caseInvalidationConditionsText ?? "(none)"}`,
    `caseMarketBlindspotText: ${input.caseMarketBlindspotText ?? "(none)"}`,
    `caseDevilsAdvocateText: ${input.caseDevilsAdvocateText ?? "(none)"}`,
    `casePersonalFitText: ${input.casePersonalFitText ?? "(none)"}`,
    `casePortfolioFitText: ${input.casePortfolioFitText ?? "(none)"}`,
    `\n=== portfolioStateAtDecision ===\ncash: $${input.portfolioStateAtDecision.cash.toFixed(2)}, positions: ${JSON.stringify(input.portfolioStateAtDecision.positions)}`,
    `\n=== marketContext (broad market at decision time) ===\n${JSON.stringify(input.marketContextAtDecision)}`,
    `\n=== strategyPrinciplesInEffect ===\n${input.strategyPrinciplesInEffect.map((p) => `- (${p.principleType}${p.evidenceStrength ? `, ${p.evidenceStrength}` : ""}) ${p.statementText}`).join("\n") || "(none yet)"}`,
    `\n=== dnaHypothesesInEffect ===\n${input.dnaHypothesesInEffect.map((h) => `- (${h.evidenceStrength}) ${h.statementText}`).join("\n") || "(none yet)"}`,
    `\n=== predictionsAndResolutions ===\n${input.predictionsWithResolutions.map((p) => `- [${p.status}] (${p.kind ?? "kind unknown — created before forecast/reentry_condition existed"}) ${p.claimText}${p.resolutionNote ? ` — ${p.resolutionNote}` : ""}`).join("\n") || "(no predictions were extracted from this thesis)"}`,
    `\n=== priorRecord (frozen at decision time) ===\n${formatPriorRecordContext(input.priorRecordAtDecision)}`,
    `\n=== executionFacts (POST-DECISION: investor-confirmed follow-through — not part of the frozen snapshot) ===\n${formatExecutionFacts(input.executionFacts, input.sizeDollars)}`,
    `\n=== Outcome (computed in code, a fact — not yours to judge) ===\n${formatOutcome(input.outcome)}`,
  ];
  return parts.join("\n");
}

export async function synthesizeDecisionReview(input: ReviewInput): Promise<ProposedDecisionReview> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_decision_review" },
    messages: [{ role: "user", content: formatInput(input) }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a decision review via the expected tool call.");
  }

  return toolUse.input as ProposedDecisionReview;
}
