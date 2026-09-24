// Decision Follow-Through V1 — pure rules (execution facts, side/day/zone,
// replay vs conflict, chain heads), the Review formatter/citation for
// execution facts, and the REAL review prompt captured at the mocked client.
import { describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as { system: string; content: string }[] }));
vi.mock("@/lib/ai/client", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: async (req: { system: string; messages: { content: string }[]; tools: { name: string }[] }) => {
        sent.calls.push({ system: req.system, content: req.messages[0]!.content });
        return { content: [{ type: "tool_use", name: req.tools[0]!.name, input: { narrativeSummaryText: "n", thesisAccuracy: "insufficient_evidence", dimensions: [] } }] };
      },
    },
  },
}));

import {
  canExecute,
  classifyAssertion,
  EXECUTED_SIDE,
  selectEffectiveExecutionFacts,
  validateExecutionFactShape,
  type ExecutionFactRow,
} from "@/lib/execution/execution-facts";
import { formatExecutionFacts, formatInput, synthesizeDecisionReview, type ReviewInput } from "@/lib/ai/review";
import { validateReviewDimensions } from "@/lib/review/validate-review-dimensions";

const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const decision = { id: "d1", investorId: "inv", ticker: "ACME", decisionType: "BUY", decisionDate: at("2026-09-08T10:00:00Z") };
const trade = (o: Partial<{ id: string; investorId: string; ticker: string | null; transactionType: string; transactionDate: Date }>) => ({
  id: "t1", investorId: "inv", ticker: "ACME", transactionType: "buy", transactionDate: at("2026-09-09"), ...o,
});
const problems = (verdict: "executed" | "unrelated", tx: ReturnType<typeof trade> | null, d = decision, timeZone = "UTC") =>
  validateExecutionFactShape({ investorId: "inv", verdict, decision: d, transaction: tx, timeZone });

describe("execution-fact rules", () => {
  it("maps decision types to the one trade side that can execute them; PASS/HOLD have none", () => {
    expect(EXECUTED_SIDE).toEqual({ BUY: "buy", ADD: "buy", REDUCE: "sell", SELL: "sell", PASS: null, HOLD: null });
  });

  it("canExecute: side must match and the trade day must not precede the decision day in the investor's zone", () => {
    expect(canExecute(decision, trade({ transactionDate: at("2026-09-08") }), "UTC")).toBe(true); // same day
    expect(canExecute(decision, trade({ transactionDate: at("2026-09-07") }), "UTC")).toBe(false); // day before
    expect(canExecute(decision, trade({ transactionType: "sell" }), "UTC")).toBe(false);
    expect(canExecute({ ...decision, decisionType: "PASS" }, trade({}), "UTC")).toBe(false);
    expect(canExecute({ ...decision, decisionType: "HOLD" }, trade({}), "UTC")).toBe(false);
    expect(canExecute({ ...decision, decisionType: "SELL" }, trade({ transactionType: "sell" }), "UTC")).toBe(true);
    // 22:30Z on the 8th is already the 9th in Jerusalem: a trade dated the 8th precedes it there, not in UTC
    const late = { ...decision, decisionDate: at("2026-09-08T22:30:00Z") };
    expect(canExecute(late, trade({ transactionDate: at("2026-09-08") }), "UTC")).toBe(true);
    expect(canExecute(late, trade({ transactionDate: at("2026-09-08") }), "Asia/Jerusalem")).toBe(false);
    expect(canExecute(late, trade({ transactionDate: at("2026-09-09") }), "Asia/Jerusalem")).toBe(true);
  });

  it("validateExecutionFactShape: ownership, trade-ness, ticker, side and day — every violated rule is named", () => {
    expect(problems("executed", trade({}))).toEqual([]);
    expect(problems("unrelated", trade({ transactionType: "sell", transactionDate: at("2026-01-01") }))).toEqual([]); // "unrelated" has no side/day rule
    expect(problems("executed", null)).toEqual(["Unknown transaction."]);
    expect(problems("executed", trade({ investorId: "other" }))).toContain("The transaction does not belong to this investor.");
    expect(problems("executed", trade({}), { ...decision, investorId: "other" })).toContain("The decision does not belong to this investor.");
    expect(problems("executed", trade({ transactionType: "dividend" }))).toContain("Only a buy or sell trade can be asserted.");
    expect(problems("executed", trade({ ticker: "OTHER" }))).toContain("The trade is not in the decision's ticker.");
    expect(problems("executed", trade({ ticker: " acme " }))).toEqual([]); // normalized
    expect(problems("executed", trade({}), { ...decision, decisionType: "PASS" })).toEqual(["A PASS decision is not executed by a trade."]);
    expect(problems("unrelated", trade({}), { ...decision, decisionType: "PASS" })).toEqual([]);
    expect(problems("executed", trade({ transactionType: "sell" }))).toEqual(["A BUY decision is executed by a buy, not a sell."]);
    expect(problems("executed", trade({ transactionDate: at("2026-09-07") }))).toEqual([
      "A trade dated before the decision day cannot have executed it (if the decision was actually made earlier, add Later Context).",
    ]);
  });

  it("classifyAssertion: nothing yet → insert; identical → replay; different → conflict (notes normalized)", () => {
    const f: ExecutionFactRow = { id: "f1", decisionId: "d1", transactionId: "t1", verdict: "executed", note: null, supersedesFactId: null };
    expect(classifyAssertion({ decisionId: "d1", transactionId: "t9", verdict: "executed", note: null }, [f])).toEqual({ kind: "insert" });
    expect(classifyAssertion({ decisionId: "d1", transactionId: "t1", verdict: "executed", note: null }, [f])).toEqual({ kind: "replay", fact: f });
    expect(classifyAssertion({ decisionId: "d1", transactionId: "t1", verdict: "unrelated", note: null }, [f])).toEqual({ kind: "conflict", fact: f });
    expect(classifyAssertion({ decisionId: "d1", transactionId: "t1", verdict: "executed", note: "partial" }, [f])).toEqual({ kind: "conflict", fact: f });
    expect(classifyAssertion({ decisionId: "d1", transactionId: "t1", verdict: "executed", note: null }, [])).toEqual({ kind: "insert" });
  });

  it("effective facts are the chain heads", () => {
    const rows = [
      { id: "a", supersedesFactId: null },
      { id: "b", supersedesFactId: "a" },
      { id: "c", supersedesFactId: "b" },
      { id: "x", supersedesFactId: null },
    ];
    expect(selectEffectiveExecutionFacts(rows).map((r) => r.id)).toEqual(["c", "x"]);
  });
});

const baseReview: Omit<ReviewInput, "executionFacts"> = {
  ticker: "ACME", decisionType: "BUY", decisionDate: "2026-09-08T10:00:00.000Z", priceAtDecision: 100, sizeDollars: 500, userReasoningText: "r",
  risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: null, thesisText: "t", thesisInterpretationText: null,
  portfolioStateAtDecision: { cash: 0, positions: [] }, marketContextAtDecision: { indexLevel: null, indexChange1d: null, volatilityIndexValue: null },
  caseMarketIntelligenceSummary: "{}", caseBullCaseText: null, caseBearCaseText: null, caseCatalystsText: null, caseInvalidationConditionsText: null,
  caseMarketBlindspotText: null, caseDevilsAdvocateText: null, casePersonalFitText: null, casePortfolioFitText: null, strategyPrinciplesInEffect: [],
  dnaHypothesesInEffect: [], predictionsWithResolutions: [], laterContexts: [], priorRecordAtDecision: null,
  outcome: { priceAtDecision: 100, currentPrice: null, priceChangePercent: null, sizeDollars: 500, positionValueNowUsd: null, pnlUsd: null, pnlPercent: null, stillHeld: false, asOfDate: "2026-09-24T00:00:00.000Z" },
};
const executed = { transactionType: "buy", transactionDate: "2026-09-09T00:00:00.000Z", quantity: 1.8121, price: 369.72, amount: -670, note: "in two parts" };

describe("Review: execution facts", () => {
  it("formats NOT ASSERTED as unknown, never as not executed", () => {
    const text = formatExecutionFacts({ executed: [], unrelatedCount: 0 }, 500);
    expect(text).toMatch(/^NOT ASSERTED/);
    expect(text).toContain('UNKNOWN (not "not executed")');
  });

  it("formats confirmed executions as the trade price (not a return), beside the decided size, with unrelated count", () => {
    const text = formatExecutionFacts({ executed: [executed], unrelatedCount: 2 }, 500);
    expect(text).toContain("Executed by (confirmed by the investor):");
    expect(text).toContain('- buy 1.8121 @ $369.72/share on 2026-09-09, amount $670.00 (the trade price — NOT a return) — investor note: "in two parts"');
    expect(text).toContain("Decided size (recorded at decision time): $500.00 (the dollar amount being invested — NOT a price; unrelated to the per-share Price above)");
    expect(text).toContain("Same-ticker trades the investor marked as NOT executions of this decision: 2");
    expect(formatExecutionFacts({ executed: [], unrelatedCount: 1 }, null)).toContain("Executed by: no trade — every nearby same-ticker trade the investor reviewed was marked unrelated.");
    expect(formatExecutionFacts({ executed: [], unrelatedCount: 1 }, null)).toContain("Decided size (recorded at decision time): none was recorded.");
  });

  it("the review input carries the section between priorRecord and Outcome", () => {
    const text = formatInput({ ...baseReview, executionFacts: { executed: [executed], unrelatedCount: 0 } });
    const i = text.indexOf("=== priorRecord");
    const j = text.indexOf("=== executionFacts (POST-DECISION");
    const k = text.indexOf("=== Outcome");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });

  it("executionFacts is citable only when at least one fact is asserted", () => {
    const proposal = [{ dimension: "exit_conditions", verdict: "strong" as const, rationaleText: "sized as decided", citedSnapshotFields: ["executionFacts"] }];
    expect(validateReviewDimensions(proposal).find((d) => d.dimension === "exit_conditions")).toMatchObject({ verdict: "insufficient_evidence", citedSnapshotFields: [] });
    expect(validateReviewDimensions(proposal, { executionFactsAsserted: false }).find((d) => d.dimension === "exit_conditions")).toMatchObject({ verdict: "insufficient_evidence", citedSnapshotFields: [] });
    expect(validateReviewDimensions(proposal, { executionFactsAsserted: true }).find((d) => d.dimension === "exit_conditions")).toMatchObject({ verdict: "strong", citedSnapshotFields: ["executionFacts"] });
  });

  it("the real review prompt constrains execution facts to process quality and forbids performance inference", async () => {
    sent.calls.length = 0;
    await synthesizeDecisionReview({ ...baseReview, executionFacts: { executed: [executed], unrelatedCount: 0 } });
    expect(sent.calls).toHaveLength(1);
    const { system, content } = sent.calls[0]!;
    for (const rule of [
      "POST-DECISION information, like laterContexts and Outcome",
      "is not by itself evidence that the decision was good or bad",
      "A trade price is the price of that trade, never a return: do not compute or infer performance from it",
      "never treat execution or non-execution as proof the decision was good or bad",
      "If the section says NOT ASSERTED, whether and how the decision was executed is unknown — never \"not executed\"",
      "executionFacts only when the executionFacts section holds at least one investor-confirmed fact",
    ]) expect(system).toContain(rule);
    expect(content).toContain("=== executionFacts (POST-DECISION: investor-confirmed follow-through — not part of the frozen snapshot) ===\nExecuted by (confirmed by the investor):");
  });
});
