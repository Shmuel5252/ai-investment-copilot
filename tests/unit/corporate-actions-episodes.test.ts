// Import Blockers V1 — the split timeline inside the episode derivation,
// exercised only through computePositions().episodeKeyByTransactionId (the
// same public output the Decision Independence resolver consumes). The
// episode RULE is unchanged; only quantity arithmetic gains the ratio step.
import { describe, expect, it } from "vitest";
import { computePositions, type CorporateActionInput, type OpeningStateInput, type TransactionInput } from "@/lib/portfolio/positions";

const at = (d: string) => new Date(`${d}T00:00:00Z`);
let seq = 0;
const txn = (ticker: string, type: "buy" | "sell", quantity: number, date: string, intraDayOrder: number | null = null): TransactionInput => ({
  id: `t${++seq}`, ticker, transactionType: type, quantity, price: 1, amount: type === "buy" ? -quantity : quantity, transactionDate: at(date), intraDayOrder,
});
const split = (ticker: string, date: string, n: number, d: number): CorporateActionInput => ({ ticker, effectiveDate: at(date), ratioNumerator: n, ratioDenominator: d });
const keys = (rows: TransactionInput[], actions: CorporateActionInput[] = [], openingStates: OpeningStateInput[] = []) =>
  Object.fromEntries(computePositions(rows, openingStates, undefined, actions).episodeKeyByTransactionId);

describe("episode keys with stock splits", () => {
  it("CRWD-like: buy, 4:1 split, post-split sell → one episode, closed exactly; the next buy starts #2", () => {
    const b = txn("CRWD", "buy", 0.7383, "2026-04-17");
    const s = txn("CRWD", "sell", 2.9532, "2026-07-13");
    const b2 = txn("CRWD", "buy", 1, "2026-08-01");
    expect(keys([b, s, b2], [split("CRWD", "2026-07-02", 4, 1)])).toEqual({ [b.id!]: "CRWD#1", [s.id!]: "CRWD#1", [b2.id!]: "CRWD#2" });
  });
  it("an oversell that a split explains becomes an exact close — the same keys as the clamp would give, now for the right reason", () => {
    const b = txn("A", "buy", 1, "2026-01-01");
    const s = txn("A", "sell", 4, "2026-03-01");
    const b2 = txn("A", "buy", 2, "2026-04-01");
    const withSplit = keys([b, s, b2], [split("A", "2026-02-01", 4, 1)]);
    const without = keys([b, s, b2]);
    expect(withSplit).toEqual({ [b.id!]: "A#1", [s.id!]: "A#1", [b2.id!]: "A#2" });
    expect(without).toEqual(withSplit); // the clamp already closed it; the split makes the close exact
  });
  it("a partial post-split sell keeps the episode open (no false close from unadjusted quantities)", () => {
    const b = txn("A", "buy", 1, "2026-01-01");
    const s = txn("A", "sell", 2, "2026-03-01"); // half of the 4 post-split shares
    const s2 = txn("A", "sell", 2, "2026-05-01");
    const b2 = txn("A", "buy", 5, "2026-06-01");
    expect(keys([b, s, s2, b2], [split("A", "2026-02-01", 4, 1)])).toEqual({ [b.id!]: "A#1", [s.id!]: "A#1", [s2.id!]: "A#1", [b2.id!]: "A#2" });
    // without the split the first sell of 2 > 1 held clamps the run closed, so the second sell is
    // mis-grouped with the NEXT buy (A#2) — the pre-unit misattribution the split now prevents
    expect(keys([b, s, s2, b2])[s2.id!]).toBe("A#2");
  });
  it("a split with no holding is a no-op; a split on another ticker never leaks", () => {
    const a1 = txn("A", "buy", 1, "2026-03-01");
    const b1 = txn("B", "buy", 1, "2026-01-01");
    const b2 = txn("B", "sell", 1, "2026-02-15");
    expect(keys([a1, b1, b2], [split("A", "2026-02-01", 4, 1), split("Z", "2026-02-01", 2, 1)])).toEqual({ [a1.id!]: "A#1", [b1.id!]: "B#1", [b2.id!]: "B#1" });
  });
  it("opening state before the split is scaled, on/after it is not", () => {
    const s = txn("A", "sell", 4, "2026-03-01");
    expect(keys([s], [split("A", "2026-02-01", 4, 1)], [{ ticker: "A", quantity: 1, costBasisPerShare: 1, costBasisConfidence: "known", asOfDate: at("2026-01-01") }])).toEqual({ [s.id!]: "A#1" });
    const sPost = txn("A", "sell", 4, "2026-03-01");
    expect(keys([sPost], [split("A", "2026-02-01", 4, 1)], [{ ticker: "A", quantity: 4, costBasisPerShare: 1, costBasisConfidence: "known", asOfDate: at("2026-02-01") }])).toEqual({ [sPost.id!]: "A#1" });
  });
  it("same-day group on the effective date: the split applies before the whole group, whatever its order declaration", () => {
    const b = txn("A", "buy", 1, "2026-01-01");
    const s1 = txn("A", "sell", 2, "2026-02-01", 1);
    const s2 = txn("A", "sell", 2, "2026-02-01", 2);
    const b2 = txn("A", "buy", 3, "2026-03-01");
    expect(keys([b, s1, s2, b2], [split("A", "2026-02-01", 4, 1)])).toEqual({ [b.id!]: "A#1", [s1.id!]: "A#1", [s2.id!]: "A#1", [b2.id!]: "A#2" });
  });
  it("a reverse split after the last trade that leaves dust: the position is dropped; the already-keyed trade stays #1", () => {
    const b = txn("A", "buy", 1e-8, "2026-01-01");
    const state = computePositions([b], [], undefined, [split("A", "2026-02-01", 1, 100)]);
    expect(state.positions).toEqual([]);
    expect(state.episodeKeyByTransactionId.get(b.id!)).toBe("A#1");
  });
});

describe("no corporate actions ⇒ the existing episode map is unchanged", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  it("300 random histories: passing [] equals omitting the argument, byte for byte", () => {
    const rand = rng(5);
    for (let trial = 0; trial < 300; trial++) {
      const rows: TransactionInput[] = [];
      for (let i = 0; i < 2 + Math.floor(rand() * 10); i++) {
        rows.push(txn(["A", "B"][Math.floor(rand() * 2)]!, rand() < 0.55 ? "buy" : "sell", 1 + Math.floor(rand() * 4), `2026-01-${String(1 + Math.floor(rand() * 9)).padStart(2, "0")}`, rand() < 0.3 ? 1 + Math.floor(rand() * 3) : null));
      }
      const a = [...computePositions(rows, []).episodeKeyByTransactionId].sort();
      const b = [...computePositions(rows, [], undefined, []).episodeKeyByTransactionId].sort();
      expect(b).toEqual(a);
      // and a split on a ticker with no rows changes nothing either
      const c = [...computePositions(rows, [], undefined, [split("ZZZ", "2026-01-05", 3, 1)]).episodeKeyByTransactionId].sort();
      expect(c).toEqual(a);
    }
  });
});
