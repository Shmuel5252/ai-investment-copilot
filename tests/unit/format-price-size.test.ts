import { describe, expect, it } from "vitest";
import { formatSizeDollarsLine } from "@/lib/ai/format-price-size";
import { formatOutcome } from "@/lib/ai/review";
import type { DecisionOutcome } from "@/lib/review/decision-outcome";

describe("formatSizeDollarsLine", () => {
  it("always pairs the dollar amount with an explicit not-a-price clarification", () => {
    const line = formatSizeDollarsLine("Investment size", 500, "below");
    expect(line).toContain("$500.00");
    expect(line).toContain("NOT a price");
    expect(line).toContain("unrelated to the per-share Price below");
  });

  it("points the reference in the direction actually passed", () => {
    expect(formatSizeDollarsLine("Size at decision", 500, "above")).toContain(
      "unrelated to the per-share Price above"
    );
  });
});

describe("decision.ts's Investment size line (regression)", () => {
  it("matches the exact wording already proven to fix the original size/price bug", () => {
    // decision.ts calls formatSizeDollarsLine("Investment size", sizeDollars, "below")
    // — this locks that exact call, and thus the live-caught-bug fix's
    // original wording, in place after the shared-helper extraction.
    expect(formatSizeDollarsLine("Investment size", 500, "below")).toBe(
      "Investment size: $500.00 (the dollar amount being invested — NOT a price; unrelated to the per-share Price below)"
    );
  });
});

describe("formatOutcome (review.ts) — the real LLY numbers", () => {
  // Exact values from the real, persisted LLY Outcome (priceAtDecision
  // $1278.83, sizeDollars $500) — the decision whose Decision Review
  // narrative wrote "the $500 entry" despite this correct data being
  // available. This test proves the *input* formatOutcome() hands the
  // model distinguishes the two numbers explicitly; it can't prove the
  // model reads it correctly (that's the still-open, documented
  // Later-Context-precedence gap in docs/backlog.md), only that the
  // formatter itself no longer presents them ambiguously.
  const lly: DecisionOutcome = {
    priceAtDecision: 1278.83,
    currentPrice: 1148.2,
    priceChangePercent: -10.21480572085421,
    sizeDollars: 500,
    positionValueNowUsd: 448.92597139572894,
    pnlUsd: -51.074028604271064,
    pnlPercent: -10.21480572085421,
    stillHeld: false,
    asOfDate: "2026-09-06T16:23:44.366Z",
  };

  it("labels priceAtDecision as a per-share price", () => {
    const out = formatOutcome(lly);
    expect(out).toContain("Price at decision: $1278.83");
  });

  it("never presents $500 in a way readable as an entry/share price", () => {
    const out = formatOutcome(lly);
    const sizeLine = out.split("\n").find((line) => line.includes("500"));
    expect(sizeLine).toBeDefined();
    expect(sizeLine).toContain("NOT a price");
    expect(sizeLine).toContain("unrelated to the per-share Price above");
    // The only other place "500" could appear is the price line itself —
    // confirm it doesn't, i.e. the two numbers never collide on one line.
    const priceLine = out.split("\n").find((line) => line.startsWith("Price at decision"));
    expect(priceLine).not.toContain("500");
  });

  it("keeps the price-change percentage and P&L lines unchanged", () => {
    const out = formatOutcome(lly);
    expect(out).toContain("current price: $1148.2");
    expect(out).toContain("Price change since decision: -10.2%");
    expect(out).toContain("P&L: $-51.07 (-10.2%)");
    expect(out).toContain("Not currently held.");
  });
});
