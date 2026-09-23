// Import Blockers V1 — stock splits as an explicit input to the REAL
// computePositions() (src/lib/portfolio/positions.ts). Every case runs the
// production accounting walk; nothing here re-implements split math.
import { describe, expect, it } from "vitest";
import { computePositions, type CorporateActionInput, type OpeningStateInput, type TransactionInput } from "@/lib/portfolio/positions";

const at = (d: string) => new Date(`${d}T00:00:00Z`);
let seq = 0;
const buy = (ticker: string, quantity: number, price: number, date: string): TransactionInput => ({
  id: `b${++seq}`, ticker, transactionType: "buy", quantity, price, amount: -(quantity * price), transactionDate: at(date),
});
const sell = (ticker: string, quantity: number, price: number, date: string): TransactionInput => ({
  id: `s${++seq}`, ticker, transactionType: "sell", quantity, price, amount: quantity * price, transactionDate: at(date),
});
const split = (ticker: string, date: string, n: number, d: number): CorporateActionInput => ({ ticker, effectiveDate: at(date), ratioNumerator: n, ratioDenominator: d });
const opening = (ticker: string, quantity: number, costBasisPerShare: number, date: string): OpeningStateInput => ({
  ticker, quantity, costBasisPerShare, costBasisConfidence: "known", asOfDate: at(date),
});
const pos = (state: ReturnType<typeof computePositions>, ticker: string) => state.positions.find((p) => p.ticker === ticker);

// The accepted CRWD acceptance fixture (authoritative facts, 2026-09-23).
const CRWD_BUY = buy("CRWD", 0.7383, 423.9, "2026-04-17");
const CRWD_SELL = sell("CRWD", 2.9532, 187.84, "2026-07-13");
const CRWD_SPLIT = split("CRWD", "2026-07-02", 4, 1);

describe("CRWD acceptance fixture — 4:1 split between a BUY and its post-split SELL", () => {
  it("pre-split: 0.7383 @ 423.90; post-split: 2.9532 @ 105.975; total cost basis unchanged", () => {
    const before = computePositions([CRWD_BUY], [], at("2026-07-01"), [CRWD_SPLIT]);
    expect(pos(before, "CRWD")).toMatchObject({ quantity: 0.7383, costBasisPerShare: 423.9 });
    const after = computePositions([CRWD_BUY], [], at("2026-07-02"), [CRWD_SPLIT]);
    expect(pos(after, "CRWD")!.quantity).toBeCloseTo(2.9532, 10);
    expect(pos(after, "CRWD")!.costBasisPerShare!).toBeCloseTo(105.975, 10);
    expect(pos(after, "CRWD")!.quantity * pos(after, "CRWD")!.costBasisPerShare!).toBeCloseTo(0.7383 * 423.9, 8);
  });
  it("the sell closes the position exactly, sufficientHoldings=true, no warning, realized P&L against the adjusted cost", () => {
    const state = computePositions([CRWD_BUY, CRWD_SELL], [], undefined, [CRWD_SPLIT]);
    expect(state.positions).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(state.sellTrace).toHaveLength(1);
    expect(state.sellTrace[0]).toMatchObject({ ticker: "CRWD", sufficientHoldings: true, holdingPeriodDays: 87 });
    expect(state.sellTrace[0]!.realizedPnlPercent).toBeCloseTo(((187.84 - 105.975) / 105.975) * 100, 6);
    // The original rows are untouched inputs: nothing was mutated to make this work.
    expect(CRWD_BUY.quantity).toBe(0.7383);
    expect(CRWD_SELL.quantity).toBe(2.9532);
  });
  it("without the split the same rows are an oversell (the pre-unit behaviour)", () => {
    const state = computePositions([CRWD_BUY, CRWD_SELL], []);
    expect(state.warnings.map((w) => w.ticker)).toEqual(["CRWD"]);
    expect(state.sellTrace[0]!.sufficientHoldings).toBe(false);
  });
});

describe("split semantics", () => {
  it("multiplies quantity and divides average cost; total cost basis is invariant", () => {
    const s = computePositions([buy("A", 10, 100, "2026-01-01")], [], undefined, [split("A", "2026-02-01", 3, 1)]);
    expect(pos(s, "A")!.quantity).toBeCloseTo(30, 10);
    expect(pos(s, "A")!.costBasisPerShare!).toBeCloseTo(100 / 3, 10);
    expect(pos(s, "A")!.quantity * pos(s, "A")!.costBasisPerShare!).toBeCloseTo(1000, 8);
  });
  it("reverse split (1:10) shrinks quantity and raises average cost", () => {
    const s = computePositions([buy("R", 100, 2, "2026-01-01")], [], undefined, [split("R", "2026-02-01", 1, 10)]);
    expect(pos(s, "R")!.quantity).toBeCloseTo(10, 10);
    expect(pos(s, "R")!.costBasisPerShare!).toBeCloseTo(20, 10);
  });
  it("a trade dated ON the effective date is already in post-split units (action before transactions)", () => {
    const s = computePositions([buy("A", 1, 100, "2026-01-01"), sell("A", 4, 30, "2026-02-01")], [], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(s.positions).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.sellTrace[0]!.sufficientHoldings).toBe(true);
    const buyOnDate = computePositions([buy("A", 1, 100, "2026-01-01"), buy("A", 4, 25, "2026-02-01")], [], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(buyOnDate, "A")!.quantity).toBeCloseTo(8, 10); // 1×4 (adjusted) + 4 (already post-split)
    expect(pos(buyOnDate, "A")!.quantity * pos(buyOnDate, "A")!.costBasisPerShare!).toBeCloseTo(200, 8);
  });
  it("opening state BEFORE the split is adjusted; ON or AFTER the effective date it is post-split and never multiplied", () => {
    const beforeSplit = computePositions([], [opening("A", 1, 100, "2026-01-01")], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(beforeSplit, "A")).toMatchObject({ quantity: 4, costBasisPerShare: 25 });
    const onDate = computePositions([], [opening("A", 4, 25, "2026-02-01")], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(onDate, "A")).toMatchObject({ quantity: 4, costBasisPerShare: 25 });
    const afterSplit = computePositions([], [opening("A", 4, 25, "2026-03-01")], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(afterSplit, "A")).toMatchObject({ quantity: 4, costBasisPerShare: 25 });
    // mixed: a pre-split buy plus a post-split-dated opening state — only the buy is multiplied
    const mixed = computePositions([buy("A", 1, 100, "2026-01-15")], [opening("A", 4, 25, "2026-03-01")], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(mixed, "A")!.quantity).toBeCloseTo(8, 10);
    expect(pos(mixed, "A")!.quantity * pos(mixed, "A")!.costBasisPerShare!).toBeCloseTo(200, 8);
  });
  it("asOfDate: before the split → unadjusted; at or after → adjusted (effective_date <= asOfDate)", () => {
    const rows = [buy("A", 1, 100, "2026-01-01")];
    const actions = [split("A", "2026-02-01", 4, 1)];
    expect(pos(computePositions(rows, [], at("2026-01-31"), actions), "A")!.quantity).toBe(1);
    expect(pos(computePositions(rows, [], at("2026-02-01"), actions), "A")!.quantity).toBeCloseTo(4, 10);
    expect(pos(computePositions(rows, [], at("2026-06-01"), actions), "A")!.quantity).toBeCloseTo(4, 10);
  });
  it("a split after the final transaction still adjusts the open position", () => {
    const s = computePositions([buy("A", 2, 50, "2026-01-01")], [], undefined, [split("A", "2026-09-01", 2, 1)]);
    expect(pos(s, "A")).toMatchObject({ quantity: 4, costBasisPerShare: 25 });
  });
  it("multiple splits compound in date order (4:1 then 1:2 = 2×)", () => {
    const s = computePositions([buy("A", 1, 100, "2026-01-01")], [], undefined, [split("A", "2026-03-01", 1, 2), split("A", "2026-02-01", 4, 1)]);
    expect(pos(s, "A")!.quantity).toBeCloseTo(2, 10);
    expect(pos(s, "A")!.costBasisPerShare!).toBeCloseTo(50, 10);
  });
  it("no holding at the effective date → no-op; other tickers untouched; splits never touch cash", () => {
    const s = computePositions([buy("B", 1, 10, "2026-01-01"), buy("A", 1, 100, "2026-03-01")], [], undefined, [split("A", "2026-02-01", 4, 1)]);
    expect(pos(s, "A")).toMatchObject({ quantity: 1, costBasisPerShare: 100 }); // bought after the split: already post-split
    expect(pos(s, "B")).toMatchObject({ quantity: 1, costBasisPerShare: 10 });
    expect(s.cash).toBeCloseTo(-110, 8);
  });
  it("rejects a non-positive ratio loudly", () => {
    expect(() => computePositions([buy("A", 1, 1, "2026-01-01")], [], undefined, [split("A", "2026-02-01", 0, 1)])).toThrow(/non-positive ratio/);
    expect(() => computePositions([buy("A", 1, 1, "2026-01-01")], [], undefined, [split("A", "2026-02-01", 1, 0)])).toThrow(/non-positive ratio/);
  });
  it("omitting corporateActions is identical to passing an empty list", () => {
    const rows = [buy("A", 3, 10, "2026-01-01"), sell("A", 1, 12, "2026-02-01"), buy("B", 2, 5, "2026-01-05")];
    const pin = at("2026-12-31");
    expect(JSON.stringify(computePositions(rows, [], pin))).toBe(JSON.stringify(computePositions(rows, [], pin, [])));
  });
});

describe("properties", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  it("total cost basis is invariant under any split; a split followed by its inverse restores quantity and cost (300 trials)", () => {
    const rand = rng(11);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 9);
      const d = 1 + Math.floor(rand() * 9);
      if (n === d) continue;
      const rows: TransactionInput[] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) rows.push(buy("A", 1 + Math.floor(rand() * 20), 5 + Math.floor(rand() * 100), `2026-01-${String(1 + i).padStart(2, "0")}`));
      const base = computePositions(rows, []);
      const once = computePositions(rows, [], undefined, [split("A", "2026-02-01", n, d)]);
      const twice = computePositions(rows, [], undefined, [split("A", "2026-02-01", n, d), split("A", "2026-03-01", d, n)]);
      const b = pos(base, "A")!, o = pos(once, "A")!, t = pos(twice, "A")!;
      expect(o.quantity).toBeCloseTo((b.quantity * n) / d, 8);
      expect(o.quantity * o.costBasisPerShare!).toBeCloseTo(b.quantity * b.costBasisPerShare!, 6);
      expect(t.quantity).toBeCloseTo(b.quantity, 8);
      expect(t.costBasisPerShare!).toBeCloseTo(b.costBasisPerShare!, 6);
      expect(once.cash).toBe(base.cash);
    }
  });
});
