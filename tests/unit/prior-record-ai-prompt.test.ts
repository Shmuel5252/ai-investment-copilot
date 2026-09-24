// Prior Record → AI Decision Context V1 — investor-authored prose that itself
// mentions prices/outcomes (Owner decision, final review): kept VERBATIM, labeled
// as investor-authored historical text, never promoted into a structured field,
// and both REAL prompts (captured at the Anthropic client boundary, mocked here)
// constrain how such numbers may be used.
import { describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as { system: string; content: string }[] }));
vi.mock("@/lib/ai/client", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: async (req: { system: string; messages: { content: string }[]; tools: { name: string }[] }) => {
        sent.calls.push({ system: req.system, content: req.messages[0]!.content });
        const name = req.tools[0]!.name;
        const input = name === "synthesize_decision_context"
          ? { thesisInterpretationText: "t", realtimeAssessmentText: "a", predictions: [] }
          : { narrativeSummaryText: "n", thesisAccuracy: "insufficient_evidence", dimensions: [] };
        return { content: [{ type: "tool_use", name, input }] };
      },
    },
  },
}));

import { formatPriorRecordContext, projectPriorRecordForAi, QUOTED_HISTORY_RULES } from "@/lib/prior-record/ai-context";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { synthesizeDecisionContext, type DecisionContextInput } from "@/lib/ai/decision";
import { synthesizeDecisionReview, type ReviewInput } from "@/lib/ai/review";

const REASONING = "Bought at $1598.37 because the story is intact.";
const LATER = "Update: it went up 30% after this PASS — I was too cautious.";
const RATIONALE = "Sold at $80 after it went up 30%.";

const brief: PriorRecordBrief = {
  version: 1, ticker: "NUMX", generatedAt: "2026-09-24T00:00:00.000Z", asOf: "2026-09-24T00:00:00.000Z", historyThrough: "2026-09-20T00:00:00.000Z", accounting: "ok",
  position: { status: "held", quantity: 3.25, costBasisPerShare: 1492.62 },
  decisions: [{
    decisionId: "d1", decisionType: "PASS", decisionDate: "2026-08-20T09:00:00.000Z", reviewByDate: null, priceAtDecision: "1598.37", sizeDollars: null,
    reasoningText: REASONING, risksConsideredText: null, exitConditionsText: null,
    predictions: [{ id: "p1", claimText: "pullback first", kind: null, status: "refuted", checkableByDate: null, resolvedAt: "2026-09-01T00:00:00.000Z", resolutionNote: "broke out to $1740+" }],
    reviewCount: 1, latestReview: { reviewId: "r1", reviewDate: "2026-09-01T00:00:00.000Z", decisionQualityOverall: "weak", thesisAccuracy: "refuted" },
    laterContexts: [{ addedAt: "2026-09-02T00:00:00.000Z", text: LATER }],
  }],
  episodes: [{
    key: "NUMX#1", status: "closed", firstDate: "2026-03-01T00:00:00.000Z", exitDate: "2026-04-01T00:00:00.000Z", holdingDays: 31, buyCount: 1, sellCount: 1,
    entry: { date: "2026-03-01T00:00:00.000Z", quantity: 2, price: 61.54 },
    sells: [{ date: "2026-04-01T00:00:00.000Z", realizedPnlPercent: 30.01, holdingPeriodDays: 31, trusted: true }],
    rationale: [{ answerId: "a1", questionText: "Why did you sell?", answerText: RATIONALE, answeredAt: "2026-04-05T00:00:00.000Z" }],
  }],
  summary: { decisionCount: 1, reviewedDecisionCount: 1, episodeCount: 1, openEpisodeCount: 0, rationaleAnswerCount: 1, pendingPredictionCount: 0, pendingReentryConditions: [] },
};

const ctx = projectPriorRecordForAi(brief);
const text = formatPriorRecordContext(ctx);

describe("investor-authored prose with prices/outcomes", () => {
  it("survives verbatim — not redacted, not rewritten", () => {
    expect(ctx.decisions[0]!.reasoningText).toBe(REASONING);
    expect(ctx.decisions[0]!.laterContexts[0]!.text).toBe(LATER);
    expect(ctx.episodes[0]!.rationale[0]!.answerText).toBe(RATIONALE);
    for (const s of [REASONING, LATER, RATIONALE]) expect(text).toContain(`"${s}"`);
  });

  it("no structured price, position, P&L, resolved outcome or verdict field exists in the contract", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(ctx);
    for (const k of ["priceAtDecision", "price", "entry", "costBasisPerShare", "quantity", "position", "sells", "realizedPnlPercent", "holdingPeriodDays", "trusted", "resolvedAt", "resolutionNote", "latestReview", "decisionQualityOverall", "thesisAccuracy"]) {
      expect(keys.has(k)).toBe(false);
    }
    // the structured values of the brief never appear; only the investor's own quoted words carry numbers
    for (const v of ["1492.62", "3.25", "61.54", "30.01", "$1740", "weak", "refuted"]) expect(text).not.toContain(v);
  });

  it("is visibly labeled as investor-authored historical text, under the exact invariant", () => {
    expect(text).toContain(`INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — reasoning: "${REASONING}"`);
    expect(text).toContain(`LATER CONTEXT — INVESTOR-AUTHORED HISTORICAL TEXT (verbatim), added on 2026-09-02 — authoritative over the older text and any AI extraction above: "${LATER}"`);
    expect(text).toContain(`INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — rationale recorded 2026-04-05: Q: Why did you sell? A: "${RATIONALE}"`);
    expect(text).toContain("No structured historical price, performance or outcome fields are supplied here");
    expect(text).toContain("INVESTOR-AUTHORED HISTORICAL TEXT is quoted verbatim and may itself mention such information");
    expect(text).not.toMatch(/contains no prices/i);
  });

  it("both real prompts carry the prohibition on using embedded numbers as performance evidence", async () => {
    for (const rule of [
      "NOT a structured market fact supplied by the system and NOT an independently verified outcome",
      "must NOT be used to calculate a historical return, and must NOT be compared with the current price to infer performance",
      "must NOT become evidence that a prior decision was good or bad",
      "must NOT support repeating or reversing a past action because of how it later turned out",
    ]) expect(QUOTED_HISTORY_RULES).toContain(rule);

    sent.calls.length = 0;
    await synthesizeDecisionContext({
      ticker: "NUMX", decisionType: "BUY", reasoningText: "now",
      marketIntelligence: { ticker: "NUMX", companyName: "N", sector: null, industry: null, price: 100, changePercentage: 0, marketCap: 1, beta: null, fiftyTwoWeekRange: null, description: null, peRatioTtm: null, priceToBookRatioTtm: null, priceToSalesRatioTtm: null, dividendYieldTtm: null, valuationRatiosAvailable: false, fetchedAt: "2026-09-24T00:00:00.000Z", source: "financial_modeling_prep" },
      marketContext: { indexLevel: 1, indexChange1d: 0, indexChange1m: null, volatilityIndexValue: null },
      portfolioFit: { totalPortfolioValueUsd: 1, totalPortfolioValueApproximate: false, existingHoldingQuantity: 0, existingPositionValueUsd: 0, existingWeightPercent: 0, projectedPositionValueUsd: null, projectedWeightPercent: null, holdingsCount: 0, largestCurrentPositionTicker: null, largestCurrentPositionWeightPercent: null, cashValueUsd: 1, cashWeightPercent: 100, projectedCashValueUsd: null, projectedCashWeightPercent: null, sectorExposure: [], industryExposure: [], projectedSectorExposure: null, projectedIndustryExposure: null, warnings: [] },
      dnaHypotheses: [], strategyPrinciples: [], priorRecord: ctx,
    } as DecisionContextInput);
    await synthesizeDecisionReview({
      ticker: "NUMX", decisionType: "BUY", decisionDate: "2026-09-24T00:00:00.000Z", priceAtDecision: 100, sizeDollars: null, userReasoningText: "r", risksConsideredText: null, exitConditionsText: null,
      aiRealtimeAssessmentText: null, thesisText: "t", thesisInterpretationText: null, portfolioStateAtDecision: { cash: 0, positions: [] },
      marketContextAtDecision: { indexLevel: null, indexChange1d: null, volatilityIndexValue: null }, caseMarketIntelligenceSummary: "{}", caseBullCaseText: null, caseBearCaseText: null,
      caseCatalystsText: null, caseInvalidationConditionsText: null, caseMarketBlindspotText: null, caseDevilsAdvocateText: null, casePersonalFitText: null, casePortfolioFitText: null,
      strategyPrinciplesInEffect: [], dnaHypothesesInEffect: [], predictionsWithResolutions: [], laterContexts: [], priorRecordAtDecision: ctx,
      outcome: { priceAtDecision: 100, currentPrice: null, priceChangePercent: null, sizeDollars: null, positionValueNowUsd: null, pnlUsd: null, pnlPercent: null, stillHeld: false, asOfDate: "2026-09-24T00:00:00.000Z" },
    } as ReviewInput);

    expect(sent.calls).toHaveLength(2);
    for (const call of sent.calls) {
      expect(call.system).toContain(QUOTED_HISTORY_RULES);
      expect(call.content).toContain(`"${LATER}"`); // the verbatim prose reaches the model, with its label
      expect(call.content).toContain("INVESTOR-AUTHORED HISTORICAL TEXT (verbatim)");
    }
    expect(sent.calls[0]!.system).toContain("A past BUY does not support buying now");
    expect(sent.calls[1]!.system).toContain("a past outcome is never proof of decision quality");
  });
});
