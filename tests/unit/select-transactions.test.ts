import { describe, expect, it } from "vitest";
import { selectStructuralAnchors, MAX_GUIDED_QUESTIONS } from "@/lib/interview/select-transactions";
import type { AnchorHistory, HistoryTransaction } from "@/lib/interview/anchor-context";
import { readFileSync } from "node:fs";

// Unit 7C-B — the guided interview sample is STRUCTURAL ONLY: no outcome
// metric takes part in eligibility, slot choice or tie-breaking, and the
// session is presented chronologically.

type Spec = { id: string; ticker?: string; type: "buy" | "sell"; date: string; qty: number; price: number; order?: number | null };
const tx = (s: Spec): HistoryTransaction => ({
  id: s.id,
  ticker: s.ticker ?? "AAA",
  transactionType: s.type,
  quantity: s.qty,
  price: s.price,
  amount: (s.type === "buy" ? -1 : 1) * s.qty * s.price,
  transactionDate: new Date(`${s.date}T00:00:00Z`),
  intraDayOrder: s.order ?? null,
});
const history = (specs: Spec[]): AnchorHistory => ({ transactions: specs.map(tx), openingStates: [], corporateActions: [] });
const none = { answeredTransactionIds: new Set<string>() };

const H: Spec[] = [
  { id: "a-b1", ticker: "AAA", type: "buy", date: "2026-01-05", qty: 10, price: 10 },
  { id: "a-b2", ticker: "AAA", type: "buy", date: "2026-02-05", qty: 10, price: 12 },
  { id: "a-s1", ticker: "AAA", type: "sell", date: "2026-03-05", qty: 5, price: 30 },
  { id: "a-s2", ticker: "AAA", type: "sell", date: "2026-04-05", qty: 15, price: 1 },
  { id: "b-b1", ticker: "BBB", type: "buy", date: "2026-05-05", qty: 1000, price: 50 },
  { id: "c-b1", ticker: "CCC", type: "buy", date: "2026-06-05", qty: 2, price: 3 },
];

describe("selectStructuralAnchors", () => {
  it("uses no outcome category, only structural slots", () => {
    const picked = selectStructuralAnchors(history(H), none);
    for (const p of picked) expect(["initial_buy", "add_buy", "partial_sell", "full_sell", "largest_entry", "most_recent"]).toContain(p.slot);
    const source = readFileSync("src/lib/interview/select-transactions.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/realizedPnl|holdingPeriod|sellTrace|biggest_gain|biggest_loss|longest_hold|quickest_flip/);
  });

  it("fills initial buy, add-on, partial sell, full sell, largest entry and most recent, each once", () => {
    const bySlot = Object.fromEntries(selectStructuralAnchors(history(H), none).map((p) => [p.slot, p.transaction.id]));
    expect(bySlot).toEqual({
      initial_buy: "c-b1", // most recent initial buy
      add_buy: "a-b2",
      partial_sell: "a-s1",
      full_sell: "a-s2",
      largest_entry: "b-b1", // 1000 × $50, its own cost at the time
      most_recent: "a-b1", // every newer action is already taken by another slot
    });
  });

  it("deduplicates deterministically: an action already taken passes to the next candidate", () => {
    const picked = selectStructuralAnchors(history(H), none);
    expect(new Set(picked.map((p) => p.transaction.id)).size).toBe(picked.length);
    // c-b1 is already the initial-buy slot, so most_recent passes down to the newest untaken action
    expect(picked.find((p) => p.slot === "most_recent")!.transaction.id).toBe("a-b1");
    const more = selectStructuralAnchors(history([...H, { id: "d-b1", ticker: "DDD", type: "buy", date: "2026-07-01", qty: 1, price: 1 }]), none);
    expect(more.find((p) => p.slot === "initial_buy")!.transaction.id).toBe("d-b1");
    expect(more.find((p) => p.slot === "most_recent")!.transaction.id).toBe("c-b1");
  });

  it("presents the session chronologically and caps it", () => {
    const picked = selectStructuralAnchors(history(H), none);
    const dates = picked.map((p) => p.transaction.transactionDate.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(selectStructuralAnchors(history(H), { ...none, maxCount: 2 })).toHaveLength(2);
    expect(MAX_GUIDED_QUESTIONS).toBe(6);
  });

  it("does not let a result change the sample: swapping sell prices leaves the selection identical", () => {
    const swapped = H.map((s) => (s.id === "a-s1" ? { ...s, price: 1 } : s.id === "a-s2" ? { ...s, price: 30 } : s));
    const ids = (specs: Spec[]) => selectStructuralAnchors(history(specs), none).map((p) => [p.slot, p.transaction.id]);
    expect(ids(swapped)).toEqual(ids(H));
  });

  it("skips an initial buy that already has an effective answer", () => {
    const picked = selectStructuralAnchors(history(H), { answeredTransactionIds: new Set(["c-b1"]) });
    expect(picked.find((p) => p.slot === "initial_buy")!.transaction.id).toBe("b-b1");
    expect(picked.some((p) => p.transaction.id === "c-b1" && p.slot === "initial_buy")).toBe(false);
  });

  describe("Unit 7C-F delta: every already-answered action is skipped, by exact transaction", () => {
    // Two candidates for every role, on one ticker, so a slot can pass to its next candidate.
    const TWO: Spec[] = [
      { id: "i1", type: "buy", date: "2026-01-02", qty: 10, price: 5 },
      { id: "a1", type: "buy", date: "2026-01-10", qty: 10, price: 5 },
      { id: "a2", type: "buy", date: "2026-01-20", qty: 10, price: 5 },
      { id: "p1", type: "sell", date: "2026-02-01", qty: 5, price: 6 },
      { id: "p2", type: "sell", date: "2026-02-10", qty: 5, price: 6 },
      { id: "f1", type: "sell", date: "2026-02-20", qty: 20, price: 6 },
      { id: "i2", type: "buy", date: "2026-03-01", qty: 10, price: 5 },
      { id: "f2", type: "sell", date: "2026-03-10", qty: 10, price: 6 },
    ];
    const slotOf = (answered: string[], slot: string) => selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set(answered) }).find((p) => p.slot === slot)?.transaction.id;

    it.each([
      ["initial_buy", "i2", "i1"],
      ["add_buy", "a2", "a1"],
      ["partial_sell", "p2", "p1"],
      ["full_sell", "f2", "f1"],
    ])("an answered %s is excluded and the slot takes its next candidate", (slot, newest, next) => {
      expect(slotOf([], slot)).toBe(newest);
      expect(slotOf([newest], slot)).toBe(next);
      expect(selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set([newest]) }).some((p) => p.transaction.id === newest)).toBe(false);
    });

    it("identity is the exact transaction: other actions on the same ticker, date and episode stay eligible", () => {
      const picked = selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set(["p2"]) }).map((p) => p.transaction.id);
      expect(picked).not.toContain("p2");
      expect(picked).toEqual(expect.arrayContaining(["p1", "f2", "a2"]));
    });

    it("no selected anchor is ever an answered one, and nothing is repeated to fill slots", () => {
      const answered = ["i2", "a2", "p2", "f2", "f1", "a1"];
      const picked = selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set(answered) });
      for (const p of picked) expect(answered).not.toContain(p.transaction.id);
      expect(new Set(picked.map((p) => p.transaction.id)).size).toBe(picked.length);
      expect(picked.map((p) => p.transaction.id).sort()).toEqual(["i1", "p1"]);
      const all = selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set(TWO.map((s) => s.id)) });
      expect(all).toEqual([]);
    });

    it("stays outcome-independent and chronological after filtering", () => {
      const swapped = TWO.map((s) => (s.type === "sell" ? { ...s, price: s.price === 6 ? 2 : 6 } : s));
      const ids = (specs: Spec[]) => selectStructuralAnchors(history(specs), { answeredTransactionIds: new Set(["f2"]) }).map((p) => [p.slot, p.transaction.id]);
      expect(ids(swapped)).toEqual(ids(TWO));
      const dates = selectStructuralAnchors(history(TWO), { answeredTransactionIds: new Set(["f2"]) }).map((p) => p.transaction.transactionDate.getTime());
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
    });
  });

  it("excludes actions whose same-day order is not established, and sells not backed by holdings", () => {
    const specs: Spec[] = [
      { id: "x-b", ticker: "XXX", type: "buy", date: "2026-03-01", qty: 4, price: 2 },
      { id: "x-s", ticker: "XXX", type: "sell", date: "2026-03-01", qty: 4, price: 3 },
      { id: "y-s", ticker: "YYY", type: "sell", date: "2026-03-02", qty: 4, price: 3 },
    ];
    const ids = selectStructuralAnchors(history(specs), none).map((p) => p.transaction.id);
    expect(ids).toEqual([]);
    const declared = specs.map((s) => (s.ticker === "XXX" ? { ...s, order: s.type === "buy" ? 1 : 2 } : s));
    expect(selectStructuralAnchors(history(declared), none).map((p) => p.transaction.id).sort()).toEqual(["x-b", "x-s"]);
  });

  it("every selected anchor carries its point-in-time context", () => {
    for (const p of selectStructuralAnchors(history(H), none)) {
      expect(p.context.anchor.transactionId).toBe(p.transaction.id);
      if (p.context.anchor.side === "sell") expect(p.context.anchor.price).toBeNull();
    }
  });
});
