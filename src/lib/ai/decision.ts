import { anthropic, CLAUDE_MODEL } from "./client";
import type { MarketIntelligence } from "@/lib/market/fmp";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import { formatSizeDollarsLine } from "./format-price-size";
import { assertNonEmptyStrings } from "./case";

// Three things happen together at the moment a Decision is recorded
// (docs/architecture.md §2.6): the user's free-form reasoning gets
// interpreted into a specific, falsifiable Thesis (data-model.md §5:
// thesis_text is the user's own words, verbatim — kept exactly as
// written by the caller; only ai_interpretation_text and the extracted
// Predictions below are AI output), checkable claims get extracted from
// it (Prediction, resolved later by Decision Review), and the model
// gives an honest real-time take grounded in the same real data the
// investor had in front of them. All three come from one call since
// they're read from the same context anyway.

export interface DnaContextItem {
  statementText: string;
  evidenceStrength: string;
}

export interface StrategyContextItem {
  statementText: string;
  principleType: string;
  evidenceStrength: string | null;
}

export interface DecisionContextInput {
  ticker: string;
  decisionType: "BUY" | "PASS" | "HOLD" | "ADD" | "REDUCE" | "SELL";
  sizeDollars?: number;
  reasoningText: string;
  risksConsideredText?: string;
  exitConditionsText?: string;
  marketIntelligence: MarketIntelligence;
  marketContext: {
    indexLevel: number;
    indexChange1d: number;
    indexChange1m: number | null;
    volatilityIndexValue: number | null;
  };
  portfolioFit: PortfolioFit;
  dnaHypotheses: DnaContextItem[];
  strategyPrinciples: StrategyContextItem[];
}

export interface ProposedPrediction {
  claimText: string;
  /**
   * "forecast": a stated belief about what WILL happen ("I think X will
   * happen"). "reentry_condition": a trigger for reconsidering the
   * decision later ("I'd reconsider if X happens") — not a claim that X
   * will happen. A live check caught this collapsed into one thing: an
   * exit condition extracted and later judged exactly like a forecast,
   * "refuted" reading as "the reasoning was wrong" when it only meant
   * one specific trigger didn't fire (docs/backlog.md).
   */
  kind: "forecast" | "reentry_condition";
  /**
   * A whole number of days from today, ONLY when the investor's own
   * reasoning stated or clearly implied a concrete timeframe (e.g. "next
   * earnings" ~90, "within 6 months" ~180, "by year end" ~computed from
   * today) — otherwise null. This is deliberately a day-count, not a
   * calendar date: computing "today + N days" is deterministic and
   * belongs in code (CLAUDE.md "AI vs Code" — timestamps/time ranges are
   * never the LLM's job). A live verification run caught the model doing
   * that arithmetic itself and landing on a date in the *past* relative
   * to "today" for a thesis that said "next year" — this field shape
   * exists specifically so that mistake is structurally impossible: the
   * LLM only estimates a duration in the abstract, never anchors it
   * against a specific "today" it can get wrong.
   */
  timeframeDays: number | null;
}

export interface DecisionContextSynthesis {
  thesisInterpretationText: string;
  predictions: ProposedPrediction[];
  realtimeAssessmentText: string;
}

const SYSTEM_PROMPT = `You help a personal investor at the exact moment they're recording a real investing decision. You are given their own reasoning verbatim, plus real, already-fetched data: market data for the ticker, broad market context (index/volatility), computed portfolio-fit numbers, and — if any exist — this investor's own DNA hypotheses and Strategy principles. Every hypothesis/principle you're given already has real evidence behind it — thin/unconfirmed (insufficient_evidence) ones have already been excluded before reaching you, so nothing here needs to be second-guessed as too weak to use.

Write thesisInterpretationText, realtimeAssessmentText, and each prediction's claimText in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms (e.g. P/E, margin of safety) in English exactly as an investor writing in natural mixed Hebrew/English would — that mixed style is expected, not a fallback. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically).

Three jobs, all grounded only in what you're actually given:

1. thesisInterpretationText: restate the investor's reasoning as a specific, falsifiable thesis in your own clearer words. If the reasoning is too vague or generic to produce a specific thesis, say that plainly rather than inventing specificity that isn't there.

2. predictions: extract 0-5 concrete, checkable claims implied by the reasoning (e.g. a growth rate, a price level, an event). Zero predictions is a completely normal, expected result when the reasoning doesn't contain a checkable claim — do not invent one to have something to return. Every claim needs a "kind":
   - "forecast" — the investor is stating what they believe WILL happen ("I think revenue growth stays above 20%").
   - "reentry_condition" — the investor is stating what would make them RECONSIDER this decision later, for a PASS/HOLD/REDUCE especially ("I'd reconsider if it pulls back 15%", "I'd add more only if guidance improves"). This is a trigger, not a prediction that it will happen — do not phrase it as one (never "X will happen"; phrase it as the condition itself, e.g. "A pullback of 15% or more" or "Guidance improving in the next earnings report").
   - If the reasoning lists SEVERAL alternative reconsideration triggers ("I'd reconsider if X, or Y, or Z"), extract EACH one as its OWN separate reentry_condition claim — never collapse several real alternatives into just one and drop the rest, and never invent a single merged claim that blends them together.
   If you reference a price anywhere in a claim, it must be the actual per-share Price given in the market data — never the Investment size dollar amount, which is not a price at all. Only set timeframeDays if the investor's own reasoning stated or clearly implied an actual timeframe (e.g. "by next earnings" ~90, "within 6 months" ~180, "next year" ~365) — express it as a whole number of days from today, your best estimate of that duration. Do NOT compute or state an actual calendar date yourself; the application computes "today + timeframeDays" in code, precisely so a duration-estimate mistake can't turn into a date that's nonsensically in the past. Leave timeframeDays null if no real timeframe was stated.

3. realtimeAssessmentText: an honest, real-time gut-check. Reference the actual numbers you were given (price, portfolio exposure/concentration, index/volatility levels). If this decision is in tension with a specific Strategy principle or DNA hypothesis you were given, say so plainly and name it — but be honest about evidence strength for DNA hypotheses (don't treat "weak" as confirmed). If nothing you were given conflicts with this decision, say that plainly too rather than manufacturing a concern.

"Investment size" and "Price" are two different, unrelated numbers — size is the dollar amount being invested, price is the per-share market price. They are not expected to match or relate to each other in any simple way (a $500 investment in a $1278.83/share stock just buys a fraction of a share — completely normal, not an inconsistency). Never describe a "mismatch" or "data inconsistency" between them.

Never invent a fact (revenue, guidance, analyst view, news) beyond what's in the data you were handed. Keep each field to 2-4 sentences (predictions' claimText should be one sentence each).`;

const TOOL = {
  name: "synthesize_decision_context",
  description: "Interpret a real-time investing decision: thesis interpretation, extracted predictions, and an honest real-time assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      thesisInterpretationText: { type: "string" as const },
      predictions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            claimText: { type: "string" as const },
            kind: {
              type: "string" as const,
              enum: ["forecast", "reentry_condition"],
              description:
                "forecast: a stated belief about what WILL happen. reentry_condition: a trigger for reconsidering the decision later — not a claim that it will happen.",
            },
            timeframeDays: {
              type: ["integer", "null"] as const,
              description: "Whole number of days from today — an estimated duration, never a calendar date. Only if the investor's own reasoning stated or implied a real timeframe; otherwise null.",
            },
          },
          required: ["claimText", "kind", "timeframeDays"],
        },
      },
      realtimeAssessmentText: { type: "string" as const },
    },
    required: ["thesisInterpretationText", "predictions", "realtimeAssessmentText"],
  },
};

// Exported for direct unit testing — see tests/unit/format-price-size.test.ts,
// which regression-tests this exact output stayed byte-identical after
// the shared formatSizeDollarsLine() extraction.
export function formatContext(input: DecisionContextInput): string {
  const m = input.marketIntelligence;
  const mc = input.marketContext;
  const f = input.portfolioFit;

  const parts = [
    `Decision: ${input.decisionType} ${input.ticker}`,
    // Deliberately its own clearly-labeled line, not a bare "(~$X)"
    // parenthetical next to the ticker — that ambiguous placement (right
    // where a per-share price most commonly appears in financial text)
    // is exactly what caused a real, live-caught bug: the model
    // confused this dollar amount with the per-share Price below and
    // both invented a "data mismatch" between them and mislabeled it as
    // an entry price in an extracted prediction. See format-price-size.ts
    // for why this line goes through a shared helper, not local text.
    input.sizeDollars
      ? formatSizeDollarsLine("Investment size", input.sizeDollars, "below")
      : "Investment size: not specified for this decision type.",
    `\nInvestor's own reasoning (verbatim): "${input.reasoningText}"`,
    input.risksConsideredText ? `Risks the investor noted: "${input.risksConsideredText}"` : "Risks the investor noted: none recorded.",
    input.exitConditionsText ? `Exit conditions the investor noted: "${input.exitConditionsText}"` : "Exit conditions the investor noted: none recorded.",

    `\n=== Market data for ${m.ticker} ===`,
    `Price: $${m.price} per share (${m.changePercentage >= 0 ? "+" : ""}${m.changePercentage.toFixed(2)}% today)`,
    `Sector: ${m.sector ?? "unknown"} / Industry: ${m.industry ?? "unknown"}`,
    m.valuationRatiosAvailable
      ? `P/E ${m.peRatioTtm ?? "n/a"}, P/B ${m.priceToBookRatioTtm ?? "n/a"}, P/S ${m.priceToSalesRatioTtm ?? "n/a"}`
      : "Valuation ratios unavailable on the current data plan.",

    `\n=== Broad market context ===`,
    `S&P 500: ${mc.indexLevel} (${mc.indexChange1d >= 0 ? "+" : ""}${mc.indexChange1d.toFixed(2)}% today, ${mc.indexChange1m === null ? "1-month change unavailable" : `${mc.indexChange1m >= 0 ? "+" : ""}${mc.indexChange1m.toFixed(2)}% over ~1 month`})`,
    `VIX (volatility): ${mc.volatilityIndexValue ?? "unavailable"}`,

    `\n=== Portfolio fit ===`,
    `Total portfolio value: $${f.totalPortfolioValueUsd.toFixed(2)}${f.totalPortfolioValueApproximate ? " (approximate)" : ""}`,
    `Existing exposure to ${input.ticker}: ${f.existingWeightPercent.toFixed(1)}% of portfolio`,
    f.projectedWeightPercent !== null ? `Projected exposure after this decision: ${f.projectedWeightPercent.toFixed(1)}%` : "",
    f.largestCurrentPositionTicker ? `Current largest position: ${f.largestCurrentPositionTicker} at ${f.largestCurrentPositionWeightPercent?.toFixed(1)}%` : "",
    ...f.warnings.map((w) => `Warning: ${w}`),
  ];

  if (input.dnaHypotheses.length > 0) {
    parts.push(
      "\n=== This investor's DNA hypotheses ===",
      ...input.dnaHypotheses.map((h) => `- (${h.evidenceStrength}) ${h.statementText}`)
    );
  } else {
    parts.push("\n=== This investor's DNA hypotheses === none yet.");
  }

  if (input.strategyPrinciples.length > 0) {
    parts.push(
      "\n=== This investor's current Strategy principles ===",
      ...input.strategyPrinciples.map(
        (p) => `- (${p.principleType}${p.evidenceStrength ? `, ${p.evidenceStrength}` : ""}) ${p.statementText}`
      )
    );
  } else {
    parts.push("\n=== This investor's current Strategy principles === none yet.");
  }

  return parts.filter(Boolean).join("\n");
}

export async function synthesizeDecisionContext(
  input: DecisionContextInput
): Promise<DecisionContextSynthesis> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "synthesize_decision_context" },
    messages: [{ role: "user", content: formatContext(input) }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a decision-context synthesis via the expected tool call.");
  }

  // Same trust boundary as case.ts (assertNonEmptyStrings, docs/backlog.md
  // "עדיפות גבוהה") — a required tool-response field silently disappearing
  // is exactly what No Fake Certainty exists to catch, not just a
  // validation nicety. The two flat fields reuse the check directly;
  // predictions[].claimText needs one call per array element so the
  // error can name which prediction failed (an empty predictions array
  // is a normal result and is never checked here — nothing to validate).
  const result = toolUse.input as DecisionContextSynthesis;
  assertNonEmptyStrings(result, ["thesisInterpretationText", "realtimeAssessmentText"], "synthesize_decision_context");
  result.predictions.forEach((prediction, index) => {
    assertNonEmptyStrings(prediction, ["claimText"], `synthesize_decision_context predictions[${index}]`);
  });

  return result;
}
