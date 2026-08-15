import { anthropic, CLAUDE_MODEL } from "./client";
import { CITABLE_SNAPSHOT_FIELDS } from "@/lib/review/validate-review-dimensions";
import type { DecisionOutcome } from "@/lib/review/decision-outcome";

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
  strategyPrinciplesInEffect: { statementText: string; principleType: string }[];
  dnaHypothesesInEffect: { statementText: string; evidenceStrength: string }[];
  predictionsWithResolutions: { claimText: string; status: string; resolutionNote: string | null }[];
  outcome: DecisionOutcome;
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

const SYSTEM_PROMPT = `You review a personal investor's past investing decision, using only what they actually knew/recorded at decision time (frozen in a Decision Snapshot) plus what's happened since (Outcome, already computed in code and given to you as a fact — you do not compute or judge P&L yourself).

You produce two things:

1. thesisAccuracy: based ONLY on the given prediction resolutions (each already resolved by the investor themselves as confirmed/refuted/inconclusive — you do not decide whether a prediction came true, only synthesize an overall category from resolutions you're given). If there are no predictions, or none have been resolved, use "insufficient_evidence" — that is a normal, expected result, not a failure.

2. Exactly these 7 ReviewDimension verdicts, each strong/reasonable/weak/insufficient_evidence, each with a rationale AND a list of citedSnapshotFields:
${DIMENSION_LIST}

Ground rules for the dimensions:
- Every verdict except insufficient_evidence MUST cite at least one real field from this exact list — do not invent a field name: ${CITABLE_SNAPSHOT_FIELDS.join(", ")}.
- If you cannot point to something concrete for a dimension, its verdict must be insufficient_evidence — this is a completely normal, expected outcome for some dimensions (e.g. no risksConsideredText was ever recorded), not a failure on your part.
- Be honest and specific — don't default everything to "reasonable". A dimension with real, cited weaknesses is "weak"; a dimension genuinely well-handled with clear evidence is "strong".
- Never invent a fact (a number, an event, a company detail) beyond what's in the data you were given.

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

function formatOutcome(o: DecisionOutcome): string {
  const parts = [
    `Price at decision: $${o.priceAtDecision} — current price: ${o.currentPrice !== null ? `$${o.currentPrice}` : "unavailable"}`,
    o.priceChangePercent !== null ? `Price change since decision: ${o.priceChangePercent >= 0 ? "+" : ""}${o.priceChangePercent.toFixed(1)}%` : "Price change: unavailable",
  ];
  if (o.sizeDollars !== null) {
    parts.push(`Size at decision: $${o.sizeDollars.toFixed(2)}`);
    if (o.pnlUsd !== null) parts.push(`P&L: $${o.pnlUsd.toFixed(2)} (${o.pnlPercent?.toFixed(1)}%)`);
  } else {
    parts.push("No size was recorded (nothing was actually bought/sold).");
  }
  parts.push(o.stillHeld ? "Still held today." : "Not currently held.");
  return parts.join("\n");
}

function formatInput(input: ReviewInput): string {
  const parts = [
    `Decision: ${input.decisionType} ${input.ticker} on ${input.decisionDate}`,
    `\n=== userReasoningText (verbatim) ===\n${input.userReasoningText}`,
    `\n=== thesisText / thesisInterpretationText ===\n${input.thesisText}\n${input.thesisInterpretationText ?? "(no AI interpretation recorded)"}`,
    `\n=== risksConsideredText ===\n${input.risksConsideredText ?? "(none recorded)"}`,
    `\n=== exitConditionsText ===\n${input.exitConditionsText ?? "(none recorded)"}`,
    `\n=== aiRealtimeAssessmentText (given at decision time) ===\n${input.aiRealtimeAssessmentText ?? "(none)"}`,
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
    `\n=== strategyPrinciplesInEffect ===\n${input.strategyPrinciplesInEffect.map((p) => `- (${p.principleType}) ${p.statementText}`).join("\n") || "(none yet)"}`,
    `\n=== dnaHypothesesInEffect ===\n${input.dnaHypothesesInEffect.map((h) => `- (${h.evidenceStrength}) ${h.statementText}`).join("\n") || "(none yet)"}`,
    `\n=== predictionsAndResolutions ===\n${input.predictionsWithResolutions.map((p) => `- [${p.status}] ${p.claimText}${p.resolutionNote ? ` — ${p.resolutionNote}` : ""}`).join("\n") || "(no predictions were extracted from this thesis)"}`,
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
