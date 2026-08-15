import { describe, expect, it } from "vitest";
import { computeDecisionOutcome } from "@/lib/review/decision-outcome";

const asOfDate = new Date("2026-08-15");

describe("computeDecisionOutcome", () => {
  it("computes price change and $ P&L for a sized BUY that gained", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: 1000,
      currentPrice: 110,
      currentlyHeldQuantity: 10,
      asOfDate,
    });
    expect(outcome.priceChangePercent).toBeCloseTo(10);
    expect(outcome.positionValueNowUsd).toBeCloseTo(1100);
    expect(outcome.pnlUsd).toBeCloseTo(100);
    expect(outcome.pnlPercent).toBeCloseTo(10);
    expect(outcome.stillHeld).toBe(true);
  });

  it("computes a negative P&L for a sized position that lost value", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: 1000,
      currentPrice: 80,
      currentlyHeldQuantity: 10,
      asOfDate,
    });
    expect(outcome.priceChangePercent).toBeCloseTo(-20);
    expect(outcome.pnlUsd).toBeCloseTo(-200);
  });

  it("leaves $ fields null when no size was recorded (e.g. a PASS decision)", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: null,
      currentPrice: 130,
      currentlyHeldQuantity: 0,
      asOfDate,
    });
    expect(outcome.priceChangePercent).toBeCloseTo(30); // the raw price fact is still computed...
    expect(outcome.positionValueNowUsd).toBeNull(); // ...but nothing was sized, so no $ P&L is fabricated
    expect(outcome.pnlUsd).toBeNull();
    expect(outcome.pnlPercent).toBeNull();
    expect(outcome.stillHeld).toBe(false);
  });

  it("leaves price-derived fields null when the current price is genuinely unavailable, rather than guessing", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: 500,
      currentPrice: null,
      currentlyHeldQuantity: 5,
      asOfDate,
    });
    expect(outcome.priceChangePercent).toBeNull();
    expect(outcome.positionValueNowUsd).toBeNull();
    expect(outcome.pnlUsd).toBeNull();
    expect(outcome.stillHeld).toBe(true); // still held is independent of price availability
  });

  it("does not divide by zero if priceAtDecision is somehow 0", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 0,
      sizeDollars: 100,
      currentPrice: 50,
      currentlyHeldQuantity: 1,
      asOfDate,
    });
    expect(outcome.priceChangePercent).toBeNull();
    expect(outcome.positionValueNowUsd).toBeNull();
  });

  it("marks stillHeld false when the position was fully exited (SELL)", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: null,
      currentPrice: 90,
      currentlyHeldQuantity: 0,
      asOfDate,
    });
    expect(outcome.stillHeld).toBe(false);
    expect(outcome.priceChangePercent).toBeCloseTo(-10); // still an honest fact: price fell after the sell
  });

  it("treats a near-zero held quantity (float dust) as not held", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: null,
      currentPrice: 100,
      currentlyHeldQuantity: 1e-12,
      asOfDate,
    });
    expect(outcome.stillHeld).toBe(false);
  });

  it("round-trips asOfDate as an ISO string", () => {
    const outcome = computeDecisionOutcome({
      priceAtDecision: 100,
      sizeDollars: null,
      currentPrice: 100,
      currentlyHeldQuantity: 0,
      asOfDate,
    });
    expect(outcome.asOfDate).toBe(asOfDate.toISOString());
  });
});
