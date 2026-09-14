// Investment Episode Independence design — deriveEpisodeKeys() (built
// into computePositions(), src/lib/portfolio/positions.ts) is exercised
// here exclusively through computePositions()'s public
// episodeKeyByTransactionId output, never through a re-implementation of
// its own logic — same discipline as positions.test.ts. Every trace here
// mirrors one from the locked design document (Investment Episode
// Independence — Final Consolidated Design, this session's planning
// work) — section numbers in comments below refer to that document.
import { describe, expect, it } from "vitest";
import {
  computePositions,
  applyTransactionToQuantity,
  QUANTITY_EPSILON as EPS,
  type TransactionInput,
  type OpeningStateInput,
} from "@/lib/portfolio/positions";

let nextId = 0;
function txn(
  ticker: string,
  type: "buy" | "sell",
  quantity: number,
  date: string,
  opts: { intraDayOrder?: number } = {}
): TransactionInput {
  nextId += 1;
  return {
    id: `t${nextId}`,
    ticker,
    transactionType: type,
    quantity,
    price: 1,
    amount: type === "buy" ? -quantity : quantity,
    transactionDate: new Date(date),
    intraDayOrder: opts.intraDayOrder ?? null,
  };
}

function keysFor(transactions: TransactionInput[], openingStates: OpeningStateInput[] = []) {
  return computePositions(transactions, openingStates).episodeKeyByTransactionId;
}

function opening(ticker: string, quantity: number, date = "2020-01-01"): OpeningStateInput {
  return {
    ticker,
    quantity,
    costBasisPerShare: null,
    costBasisConfidence: "approximate",
    asOfDate: new Date(date),
  };
}

describe("deriveEpisodeKeys (via computePositions().episodeKeyByTransactionId)", () => {
  it("MP exact historical trace: BUY + partial SELL + final SELL on three distinct dates -> one episode", () => {
    const buy = txn("MP", "buy", 20.6521, "2026-08-05");
    const sell1 = txn("MP", "sell", 12.1317, "2026-08-24");
    const sell2 = txn("MP", "sell", 8.5204, "2026-08-28"); // closes exactly (20.6521 - 12.1317 - 8.5204 = 0)
    const keys = keysFor([buy, sell1, sell2]);

    expect(keys.get(buy.id!)).toBe("MP#1");
    expect(keys.get(sell1.id!)).toBe("MP#1");
    expect(keys.get(sell2.id!)).toBe("MP#1");
  });

  it("two separate lifecycles of the same ticker (fully closed in between) get separate episode keys", () => {
    const b1 = txn("AAA", "buy", 10, "2026-01-01");
    const s1 = txn("AAA", "sell", 10, "2026-02-01"); // closes
    const b2 = txn("AAA", "buy", 5, "2026-03-01"); // reopens
    const s2 = txn("AAA", "sell", 5, "2026-04-01"); // closes again
    const keys = keysFor([b1, s1, b2, s2]);

    expect(keys.get(b1.id!)).toBe("AAA#1");
    expect(keys.get(s1.id!)).toBe("AAA#1");
    expect(keys.get(b2.id!)).toBe("AAA#2");
    expect(keys.get(s2.id!)).toBe("AAA#2");
  });

  describe("same-day declared ordering", () => {
    it("declared sell-then-buy: interior close+reopen within one same-day group splits into two episodes", () => {
      // start=5; declared order SELL8 then BUY2: 5-8 clamps to 0 (closes,
      // still assigned the live key at the moment it happens), then
      // 0+2=2 (a genuine exact crossing > EPS -> a NEW episode for the
      // buy). A later SELL2 on 2026-02-01 closes the second episode.
      const s1 = txn("DCL", "sell", 8, "2026-01-05", { intraDayOrder: 1 });
      const b1 = txn("DCL", "buy", 2, "2026-01-05", { intraDayOrder: 2 });
      const s2 = txn("DCL", "sell", 2, "2026-02-01");
      const keys = keysFor([s1, b1, s2], [opening("DCL", 5)]);

      expect(keys.get(s1.id!)).toBe("DCL#1");
      expect(keys.get(b1.id!)).toBe("DCL#2");
      expect(keys.get(s2.id!)).toBe("DCL#2");
    });

    it("declared buy-then-sell (reversed order): never reopens within the group, stays one episode", () => {
      // Same two transactions, opposite declared order: BUY2 then SELL8:
      // 5+2=7 (still open), 7-8=-1 clamps to 0 (closes) — one continuous
      // episode, never splits, demonstrating declared order is genuinely
      // respected (a different order than the previous test gives a
      // different result).
      const b1 = txn("DCL2", "buy", 2, "2026-01-05", { intraDayOrder: 1 });
      const s1 = txn("DCL2", "sell", 8, "2026-01-05", { intraDayOrder: 2 });
      const s2 = txn("DCL2", "sell", 2, "2026-02-01");
      const keys = keysFor([b1, s1, s2], [opening("DCL2", 5)]);

      expect(keys.get(b1.id!)).toBe("DCL2#1");
      expect(keys.get(s1.id!)).toBe("DCL2#1");
      // s2 never proves anything (applied to an already-closed exact 0,
      // stays <= EPS, never exceeds it) -> merges into the same fallback
      // (episode #1, the only one that has ever closed for this ticker).
      expect(keys.get(s2.id!)).toBe("DCL2#1");
    });
  });

  it("same-day unresolved ordering never creates a new episode from ceiling alone, and is array-order independent", () => {
    // start=5; {SELL8, BUY2} same day, no declared order -> unresolved:
    // ceiling = 5 + 2 = 7, exactKnown destroyed. A later single BUY100 on
    // ceiling alone pushes it well past EPS but must NEVER prove opening
    // (ceiling > EPS never proves open) — everything stays merged,
    // pending, regardless of which array order the two same-day rows are
    // fed in (DB/array order must never matter for an unresolved group).
    const s1 = txn("UNR", "sell", 8, "2026-01-05");
    const b1 = txn("UNR", "buy", 2, "2026-01-05");
    const b2 = txn("UNR", "buy", 100, "2026-02-01");

    const keysOrderA = keysFor([s1, b1, b2], [opening("UNR", 5)]);
    const keysOrderB = keysFor([b1, s1, b2], [opening("UNR", 5)]);

    for (const keys of [keysOrderA, keysOrderB]) {
      expect(keys.get(s1.id!)).toBe("UNR#1");
      expect(keys.get(b1.id!)).toBe("UNR#1");
      expect(keys.get(b2.id!)).toBe("UNR#1"); // never split off into a new "UNR#2"
    }
  });

  describe("exact epsilon boundary (applyTransactionToQuantity)", () => {
    // Small round multiples of EPS, not "5 minus something near 5" —
    // subtracting two close-in-magnitude numbers the latter way loses
    // precision (catastrophic cancellation) well before EPS's own scale,
    // which would test float noise, not the clamp's actual boundary.
    it("clamps a result strictly below EPS to exactly 0", () => {
      const result = applyTransactionToQuantity(1.5 * EPS, { transactionType: "sell", quantity: EPS });
      expect(result).toBe(0);
    });

    it("does NOT clamp a result exactly equal to EPS", () => {
      const result = applyTransactionToQuantity(2 * EPS, { transactionType: "sell", quantity: EPS });
      expect(result).toBe(EPS);
    });

    it("does not clamp a result just above EPS", () => {
      const result = applyTransactionToQuantity(3 * EPS, { transactionType: "sell", quantity: EPS });
      expect(result).toBeGreaterThan(EPS);
      expect(result).toBeCloseTo(2 * EPS, 20);
    });
  });

  it("closure can be proven from ceiling alone landing in (0, EPS] without restoring exactKnown", () => {
    // start=0 (no opening state, exact). Unresolved {SELL10*EPS, BUY1.5*EPS}
    // -> ceiling=1.5*EPS, exactKnown=null. A single SELL(0.5*EPS) applied to
    // ceiling gives exactly EPS (not clamped, EPS < EPS is false) — closure
    // is proven (EPS <= EPS) even though exactKnown never got exactly 0,
    // consistent with the design's §9 contrast case (12.2).
    const g1a = txn("RES", "sell", 10 * EPS, "2026-01-01");
    const g1b = txn("RES", "buy", 1.5 * EPS, "2026-01-01");
    const g2 = txn("RES", "sell", 0.5 * EPS, "2026-02-01");
    const keys = keysFor([g1a, g1b, g2]);

    expect(keys.get(g1a.id!)).toBe("RES#1");
    expect(keys.get(g1b.id!)).toBe("RES#1");
    expect(keys.get(g2.id!)).toBe("RES#1");
  });

  it("delayed/run-based assignment: Day3 closes as its own episode, Day4+Day5 together prove a new one (design trace 12.3/12.4)", () => {
    // start = 0.5*EPS (exact, already "closed" since <= EPS).
    // Day1: unresolved {SELL10*EPS, BUY2*EPS} -> ceiling = 2.5*EPS, exactKnown=null.
    // Day2: single BUY0.4*EPS on ceiling -> ceiling=2.9*EPS, still ceiling-only,
    //       does NOT prove reopening even though ceiling > EPS.
    // Day3: single SELL100*EPS on ceiling -> clamps to exactly 0 -> singleton
    //       restoration fires (exactKnown=0) -> proven closed -> Days1-3 all
    //       finalize as one episode ("EX1#1").
    // Day4: BUY0.6*EPS on exact 0 -> exactKnown=0.6*EPS, still <= EPS, buffered,
    //       not yet keyed.
    // Day5: BUY5*EPS on exact 0.6*EPS -> exactKnown=5.6*EPS > EPS -> proven
    //       opening -> Day4 AND Day5 together get the new episode ("EX1#2").
    const day1a = txn("EX1", "sell", 10 * EPS, "2026-01-01");
    const day1b = txn("EX1", "buy", 2 * EPS, "2026-01-01");
    const day2 = txn("EX1", "buy", 0.4 * EPS, "2026-01-02");
    const day3 = txn("EX1", "sell", 100 * EPS, "2026-01-03");
    const day4 = txn("EX1", "buy", 0.6 * EPS, "2026-01-04");
    const day5 = txn("EX1", "buy", 5 * EPS, "2026-01-05");
    const keys = keysFor([day1a, day1b, day2, day3, day4, day5], [opening("EX1", 0.5 * EPS)]);

    expect(keys.get(day1a.id!)).toBe("EX1#1");
    expect(keys.get(day1b.id!)).toBe("EX1#1");
    expect(keys.get(day2.id!)).toBe("EX1#1");
    expect(keys.get(day3.id!)).toBe("EX1#1");
    // The load-bearing assertion this trace exists for: two different
    // days, two different (hypothetical) InterviewAnswers, one episode.
    expect(keys.get(day4.id!)).toBe("EX1#2");
    expect(keys.get(day5.id!)).toBe("EX1#2");
  });

  it("pending run with an ambiguous group in the middle stays unresolved despite a large apparent ceiling total (design trace 12.5)", () => {
    // After a proven close (exact 0): Day A BUY0.6*EPS (exact, buffered).
    // Day B unresolved {SELL0.3*EPS, BUY0.2*EPS} -> ceiling=0.8*EPS,
    // exactKnown destroyed. Day C BUY10*EPS on ceiling -> 10.8*EPS, still
    // ceiling-derived -> does NOT prove reopening despite the large total.
    const close = txn("PND", "sell", 5, "2026-01-01"); // closes an opening position exactly
    const dayA = txn("PND", "buy", 0.6 * EPS, "2026-02-01");
    const dayB1 = txn("PND", "sell", 0.3 * EPS, "2026-02-02");
    const dayB2 = txn("PND", "buy", 0.2 * EPS, "2026-02-02");
    const dayC = txn("PND", "buy", 10 * EPS, "2026-02-03");
    const keys = keysFor([close, dayA, dayB1, dayB2, dayC], [opening("PND", 5)]);

    expect(keys.get(close.id!)).toBe("PND#1");
    // None of the post-close activity ever proves an exact crossing, so
    // it all stays merged into the run's fallback target once the
    // chronology ends — same key as the episode that closed before it.
    expect(keys.get(dayA.id!)).toBe("PND#1");
    expect(keys.get(dayB1.id!)).toBe("PND#1");
    expect(keys.get(dayB2.id!)).toBe("PND#1");
    expect(keys.get(dayC.id!)).toBe("PND#1");
  });

  it("a pending run that proves closed again without ever opening merges backward, creating no new case (design trace 12.6)", () => {
    // Continues 12.5's Day A/Day B, but instead of Day C's buy, a
    // SELL0.8*EPS on ceiling=0.8*EPS clamps to exactly 0 -> proven closed
    // again, singleton restores exactKnown=0 -> the whole run (Day A,
    // Day B, this sell) merges into the SAME key the prior close used —
    // no new independent case, even though real activity happened. This
    // is the design's trace exactly as given (chronology ends here).
    const closeBefore = txn("MRG", "sell", 5, "2026-01-01");
    const dayA = txn("MRG", "buy", 0.6 * EPS, "2026-02-01");
    const dayB1 = txn("MRG", "sell", 0.3 * EPS, "2026-02-02");
    const dayB2 = txn("MRG", "buy", 0.2 * EPS, "2026-02-02");
    const dayCPrime = txn("MRG", "sell", 0.8 * EPS, "2026-02-03");

    const keys = keysFor([closeBefore, dayA, dayB1, dayB2, dayCPrime], [opening("MRG", 5)]);

    expect(keys.get(closeBefore.id!)).toBe("MRG#1");
    expect(keys.get(dayA.id!)).toBe("MRG#1");
    expect(keys.get(dayB1.id!)).toBe("MRG#1");
    expect(keys.get(dayB2.id!)).toBe("MRG#1");
    expect(keys.get(dayCPrime.id!)).toBe("MRG#1");
  });

  it("intentional, documented conservative imprecision: a later genuine reopening can still merge with an earlier never-flushed stretch that itself never exceeded EPS (design §17 Non-goals)", () => {
    // Same A/B/C' stretch as the previous test, but chronology does NOT
    // end there — a later, completely unambiguous BUY genuinely reopens
    // the position. Because ceiling never exceeded EPS anywhere in the
    // A/B/C' stretch (0.6*EPS, 0.8*EPS, back to exactly 0 — all <= EPS
    // throughout), no interior flush ever fires for it, so it is still
    // sitting in the SAME buffer when the later buy proves the crossing —
    // the whole stretch, including the later buy, is assigned ONE new
    // key together. This under-counts (2 real episodes collapse into 1
    // key) but never over-counts, exactly the accepted, disclosed
    // imprecision the design's Non-goals section names explicitly — this
    // is NOT the same gap as trace 12.4's Day3 (there, ceiling genuinely
    // exceeded EPS at 2.5*EPS/2.9*EPS before the close, which is exactly
    // what makes that case eligible for an eager, precise split).
    const closeBefore = txn("MRG2", "sell", 5, "2026-01-01");
    const dayA = txn("MRG2", "buy", 0.6 * EPS, "2026-02-01");
    const dayB1 = txn("MRG2", "sell", 0.3 * EPS, "2026-02-02");
    const dayB2 = txn("MRG2", "buy", 0.2 * EPS, "2026-02-02");
    const dayCPrime = txn("MRG2", "sell", 0.8 * EPS, "2026-02-03");
    const laterReopen = txn("MRG2", "buy", 3, "2026-03-01");

    const keys = keysFor(
      [closeBefore, dayA, dayB1, dayB2, dayCPrime, laterReopen],
      [opening("MRG2", 5)]
    );

    expect(keys.get(closeBefore.id!)).toBe("MRG2#1");
    // All four post-close-but-never-flushed transactions plus the later
    // reopening share the SAME new key — merged, not split, but still
    // only ever ONE independent case, never a spurious extra one.
    expect(keys.get(dayA.id!)).toBe("MRG2#2");
    expect(keys.get(dayB1.id!)).toBe("MRG2#2");
    expect(keys.get(dayB2.id!)).toBe("MRG2#2");
    expect(keys.get(dayCPrime.id!)).toBe("MRG2#2");
    expect(keys.get(laterReopen.id!)).toBe("MRG2#2");
  });

  describe("initial-history base case (design trace 12.7)", () => {
    it("a first-ever run that never proves opening stays as one single first-ticker key", () => {
      const s1 = txn("INI", "sell", 2, "2026-01-01");
      const b1 = txn("INI", "buy", 3, "2026-01-01"); // unresolved, no declared order
      const b2 = txn("INI", "buy", 10, "2026-02-01"); // ceiling-only, never proves opening
      const keys = keysFor([s1, b1, b2]);

      expect(keys.get(s1.id!)).toBe("INI#1");
      expect(keys.get(b1.id!)).toBe("INI#1");
      expect(keys.get(b2.id!)).toBe("INI#1");
    });

    it("resolved by explicit product decision this session: a first-ever run that closes exactly (after a genuine excursion above EPS) then reopens DOES split, same as any later run", () => {
      // The exact same Day1-Day5 shape as the delayed-assignment trace
      // above, but with NO opening state at all (start=0 exact, the
      // ticker's very first-ever activity, episodeCounter starts at 0
      // instead of already being 1) — this is the precise scenario where
      // two different sub-cases of the locked design's own trace 12.7
      // contradicted trace 12.4: 12.7 claimed a first-ever run's closure
      // + reopening must stay as one key; 12.4 (and every later run)
      // splits on exactly this pattern. Resolved by explicit user
      // decision in favor of uniform 12.4 behavior (see this session's
      // implementation report) — the fallback-target formula
      // (max(episodeCounter, 1)) already makes the first-ever flush
      // correctly land on "#1" with no special-casing needed beyond that.
      const day1a = txn("INI3", "sell", 10 * EPS, "2026-01-01");
      const day1b = txn("INI3", "buy", 2 * EPS, "2026-01-01");
      const day2 = txn("INI3", "buy", 0.4 * EPS, "2026-01-02");
      const day3 = txn("INI3", "sell", 100 * EPS, "2026-01-03");
      const day4 = txn("INI3", "buy", 0.6 * EPS, "2026-01-04");
      const day5 = txn("INI3", "buy", 5 * EPS, "2026-01-05");
      const keys = keysFor([day1a, day1b, day2, day3, day4, day5]); // no opening state at all

      expect(keys.get(day1a.id!)).toBe("INI3#1");
      expect(keys.get(day1b.id!)).toBe("INI3#1");
      expect(keys.get(day2.id!)).toBe("INI3#1");
      expect(keys.get(day3.id!)).toBe("INI3#1");
      expect(keys.get(day4.id!)).toBe("INI3#2");
      expect(keys.get(day5.id!)).toBe("INI3#2");
    });
  });

  it("keeps episode state fully independent per ticker (no cross-ticker leakage)", () => {
    const aBuy = txn("PTA", "buy", 10, "2026-01-01");
    const aSell = txn("PTA", "sell", 10, "2026-01-02"); // closes
    const bBuy = txn("PTB", "buy", 10, "2026-01-01");
    const bSell = txn("PTB", "sell", 5, "2026-01-02"); // stays open
    const keys = keysFor([aBuy, aSell, bBuy, bSell]);

    expect(keys.get(aBuy.id!)).toBe("PTA#1");
    expect(keys.get(aSell.id!)).toBe("PTA#1");
    expect(keys.get(bBuy.id!)).toBe("PTB#1");
    expect(keys.get(bSell.id!)).toBe("PTB#1");
  });

  it("never assigns a key to a transaction with no id, and never falls back to a raw synthetic id", () => {
    const withId = txn("NID", "buy", 10, "2026-01-01");
    const withoutId: TransactionInput = { ...txn("NID", "sell", 3, "2026-01-02"), id: undefined };
    const keys = keysFor([withId, withoutId]);

    expect(keys.has(withId.id!)).toBe(true);
    expect(keys.size).toBe(1); // the id-less transaction contributes no entry at all
  });

  it("existing computePositions() outputs (quantity, cost basis, sellTrace, warnings) are unaffected by episode derivation", () => {
    const b1 = txn("SAN", "buy", 10, "2026-01-01");
    const s1 = txn("SAN", "sell", 4, "2026-02-01");
    const result = computePositions([b1, s1], []);

    expect(result.positions).toEqual([
      { ticker: "SAN", quantity: 6, costBasisPerShare: 1, costBasisConfidence: "known" },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.sellTrace).toHaveLength(1);
    expect(result.episodeKeyByTransactionId.get(b1.id!)).toBe("SAN#1");
    expect(result.episodeKeyByTransactionId.get(s1.id!)).toBe("SAN#1");
  });
});

describe("deriveEpisodeKeys — property/oracle suite (soundness of the ceiling proof)", () => {
  // Ground truth: brute-force every permutation of one ambiguous group's
  // transactions through the SAME shared applyTransactionToQuantity
  // helper production uses — never a second, parallel reimplementation of
  // the clamp logic. Whenever the ceiling accumulation rule (start + sum
  // of buys in the group, sells never credited) computes <= EPS, EVERY
  // admissible permutation's real outcome must also be <= EPS (Piece A's
  // induction, design §7) — production's closure claim must never be
  // unsound. The reverse is NOT required (and not asserted): production's
  // conservative "still open" default is allowed to be more conservative
  // than any specific permutation's real outcome.
  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const result: T[][] = [];
    for (let i = 0; i < items.length; i++) {
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      for (const p of permutations(rest)) result.push([items[i]!, ...p]);
    }
    return result;
  }

  function randomGroup(n: number, seed: number): { transactionType: "buy" | "sell"; quantity: number }[] {
    // Deterministic pseudo-random (no external dependency) — same seed
    // always produces the same group, so a failure is always reproducible.
    let s = seed;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: n }, () => ({
      transactionType: rand() < 0.5 ? ("buy" as const) : ("sell" as const),
      quantity: rand() * 20,
    }));
  }

  for (const n of [2, 3, 4, 5, 6]) {
    it(`N=${n}: every admissible ordering agrees with the ceiling proof whenever it claims closure`, () => {
      for (let trial = 0; trial < 25; trial++) {
        const startQty = trial % 5; // mix of zero and nonzero starting balances
        const group = randomGroup(n, trial * 97 + n);
        const buySum = group
          .filter((g) => g.transactionType === "buy")
          .reduce((sum, g) => sum + g.quantity, 0);
        const ceiling = startQty + buySum;

        if (ceiling <= EPS) {
          for (const perm of permutations(group)) {
            let real = startQty;
            for (const t of perm) real = applyTransactionToQuantity(real, t);
            expect(real).toBeLessThanOrEqual(EPS);
          }
        }
      }
    });
  }
});
