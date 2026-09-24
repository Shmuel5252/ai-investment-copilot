// Decision Follow-Through V1 — adversarial evidence pass (pure): DST/zone
// boundaries of the day rule, and the Review execution section under the two
// "outcome bait" scenarios (over-executed + big gain, under-executed + big
// loss): the section carries the same neutral facts either way — no
// performance, no verdict words, no current price.
import { describe, expect, it } from "vitest";
import { canExecute, validateExecutionFactShape } from "@/lib/execution/execution-facts";
import { formatExecutionFacts, formatInput, type ReviewInput } from "@/lib/ai/review";

const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const buy = (date: string) => ({ transactionType: "buy", transactionDate: at(date) });

describe("day rule at zone and DST boundaries (Asia/Jerusalem)", () => {
  it("UTC previous day / Jerusalem same day: allowed", () => {
    // 22:30Z on the 10th = 01:30 on the 11th in Jerusalem (IDT); a trade dated the 11th is the decision's own day there
    const d = { decisionType: "BUY", decisionDate: at("2026-06-10T22:30:00Z") };
    expect(canExecute(d, buy("2026-06-11"), "Asia/Jerusalem")).toBe(true);
    expect(canExecute(d, buy("2026-06-11"), "UTC")).toBe(true); // next day in UTC — also allowed
  });
  it("UTC same day / Jerusalem next day: refused in Jerusalem, allowed in UTC", () => {
    const d = { decisionType: "BUY", decisionDate: at("2026-06-10T22:30:00Z") };
    expect(canExecute(d, buy("2026-06-10"), "UTC")).toBe(true);
    expect(canExecute(d, buy("2026-06-10"), "Asia/Jerusalem")).toBe(false);
  });
  it("DST end (2026-10-25 02:00 IDT → IST) and DST start (2026-03-27 02:00 IST → IDT) do not move the decision day wrongly", () => {
    // 22:30Z on Oct 24 is 01:30 IDT on Oct 25 (still UTC+3): the decision day is the 25th
    const beforeEnd = { decisionType: "BUY", decisionDate: at("2026-10-24T22:30:00Z") };
    expect(canExecute(beforeEnd, buy("2026-10-24"), "Asia/Jerusalem")).toBe(false);
    expect(canExecute(beforeEnd, buy("2026-10-25"), "Asia/Jerusalem")).toBe(true);
    // 22:30Z on Oct 25 is 00:30 IST on Oct 26 (now UTC+2): the decision day is the 26th
    const afterEnd = { decisionType: "BUY", decisionDate: at("2026-10-25T22:30:00Z") };
    expect(canExecute(afterEnd, buy("2026-10-25"), "Asia/Jerusalem")).toBe(false);
    expect(canExecute(afterEnd, buy("2026-10-26"), "Asia/Jerusalem")).toBe(true);
    // 21:30Z on Oct 25 is 23:30 IST on Oct 25: still the 25th
    const lateOn25 = { decisionType: "BUY", decisionDate: at("2026-10-25T21:30:00Z") };
    expect(canExecute(lateOn25, buy("2026-10-25"), "Asia/Jerusalem")).toBe(true);
    // 22:30Z on Mar 26 is 00:30 IST on Mar 27 (UTC+2 until 02:00): the decision day is the 27th
    const beforeStart = { decisionType: "BUY", decisionDate: at("2026-03-26T22:30:00Z") };
    expect(canExecute(beforeStart, buy("2026-03-26"), "Asia/Jerusalem")).toBe(false);
    expect(canExecute(beforeStart, buy("2026-03-27"), "Asia/Jerusalem")).toBe(true);
  });
  it("the validator and canExecute agree on every boundary case", () => {
    const decision = { id: "d", investorId: "i", ticker: "T", decisionType: "BUY", decisionDate: at("2026-10-24T22:30:00Z") };
    for (const [date, zone] of [["2026-10-24", "Asia/Jerusalem"], ["2026-10-25", "Asia/Jerusalem"], ["2026-10-24", "UTC"], ["2026-10-23", "UTC"]] as const) {
      const tx = { id: "t", investorId: "i", ticker: "T", ...buy(date) };
      const ok = validateExecutionFactShape({ investorId: "i", verdict: "executed", decision, transaction: tx, timeZone: zone }).length === 0;
      expect(ok).toBe(canExecute(decision, tx, zone));
    }
  });
});

const base: Omit<ReviewInput, "executionFacts" | "outcome" | "sizeDollars"> = {
  ticker: "ACME", decisionType: "BUY", decisionDate: "2026-09-08T10:00:00.000Z", priceAtDecision: 100, userReasoningText: "r",
  risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: null, thesisText: "t", thesisInterpretationText: null,
  portfolioStateAtDecision: { cash: 0, positions: [] }, marketContextAtDecision: { indexLevel: null, indexChange1d: null, volatilityIndexValue: null },
  caseMarketIntelligenceSummary: "{}", caseBullCaseText: null, caseBearCaseText: null, caseCatalystsText: null, caseInvalidationConditionsText: null,
  caseMarketBlindspotText: null, caseDevilsAdvocateText: null, casePersonalFitText: null, casePortfolioFitText: null, strategyPrinciplesInEffect: [],
  dnaHypothesesInEffect: [], predictionsWithResolutions: [], laterContexts: [], priorRecordAtDecision: null,
};
const outcome = (currentPrice: number) => ({ priceAtDecision: 100, currentPrice, priceChangePercent: currentPrice - 100, sizeDollars: 500, positionValueNowUsd: 5 * currentPrice, pnlUsd: 5 * currentPrice - 500, pnlPercent: currentPrice - 100, stillHeld: true, asOfDate: "2026-09-24T00:00:00.000Z" });
const section = (text: string) => text.slice(text.indexOf("=== executionFacts"), text.indexOf("=== Outcome"));
// Words that would turn the section into a judgment or a performance claim. "NOT a return" / "NOT a price"
// are the section's own negations and are stripped before scanning.
const VERDICT_WORDS = /%|\bgain|\bloss|profit|\breturn\b|outperform|underperform|\bcorrect\b|\bwrong\b|good decision|bad decision|validated|confirmed the thesis|current price|since decision|\bnow\b/i;
const scan = (s: string) => s.replace(/NOT a return|NOT a price/g, "");

describe("execution facts ≠ decision quality (Review section under outcome bait)", () => {
  it("over-executed + large gain: the section reports only the action, its facts and the decided size", () => {
    const text = formatInput({ ...base, sizeDollars: 500, executionFacts: { executed: [{ transactionType: "buy", transactionDate: "2026-09-09T00:00:00.000Z", quantity: 6.7, price: 100, amount: -670, note: null }], unrelatedCount: 0 }, outcome: outcome(180) });
    const s = section(text);
    expect(s).toContain("POST-DECISION");
    expect(s).toContain("- buy 6.7 @ $100.00/share on 2026-09-09, amount $670.00 (the trade price — NOT a return)");
    expect(s).toContain("Decided size (recorded at decision time): $500.00 (the dollar amount being invested — NOT a price; unrelated to the per-share Price above)");
    expect(scan(s)).not.toMatch(VERDICT_WORDS);
    expect(s).not.toContain("180"); // the current price lives only in the separate Outcome section
    expect(text.indexOf("=== Outcome")).toBeGreaterThan(text.indexOf("=== executionFacts"));
  });
  it("under-executed + large loss: identical structure, no judgment either way", () => {
    const text = formatInput({ ...base, sizeDollars: 500, executionFacts: { executed: [{ transactionType: "buy", transactionDate: "2026-09-09T00:00:00.000Z", quantity: 2, price: 100, amount: -200, note: "only a starter" }], unrelatedCount: 1 }, outcome: outcome(40) });
    const s = section(text);
    expect(s).toContain("- buy 2 @ $100.00/share on 2026-09-09, amount $200.00 (the trade price — NOT a return) — investor note: \"only a starter\"");
    expect(s).toContain("Same-ticker trades the investor marked as NOT executions of this decision: 1");
    expect(scan(s)).not.toMatch(VERDICT_WORDS);
    expect(s).not.toContain("40");
  });
  it("PASS with a contrary trade marked unrelated: a fact about the record, no 'executed', no verdict", () => {
    const s = formatExecutionFacts({ executed: [], unrelatedCount: 2 }, null);
    expect(s).toContain("Executed by: no trade — every nearby same-ticker trade the investor reviewed was marked unrelated.");
    expect(s).toContain("Decided size (recorded at decision time): none was recorded.");
    expect(scan(s)).not.toMatch(VERDICT_WORDS);
  });
  it("NOT ASSERTED never reads as 'not executed'", () => {
    const s = formatExecutionFacts({ executed: [], unrelatedCount: 0 }, 500);
    expect(s).toMatch(/UNKNOWN/);
    expect(s).not.toMatch(/was not executed|not executed\./);
  });
});
