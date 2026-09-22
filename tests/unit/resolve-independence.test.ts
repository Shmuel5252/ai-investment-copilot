import { describe, expect, it } from "vitest";
import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";
import { MP_ANSWERS, MP_TRADES, cite, contextFromTrades as ctx, rng, type AnswerSpec, type TradeSpec } from "../helpers/independence";
import {
  INDEPENDENCE_POLICY,
  INDEPENDENCE_POLICY_VERSION,
  assessCitations,
  createIndependenceResolver,
  envelopeCounts,
  serializeIndependenceBasis,
  type EffectiveLinkFact,
  type EvidenceCitation,
  type IndependenceContext,
} from "@/lib/evidence/resolve-independence";

// Decision Independence V1 — the shared resolver, tested through the REAL
// production functions only (real computePositions for episode keys, real
// calculateEvidenceStrength, real countIndependentCases as the legacy
// oracle). No DB, no AI, no mocks.
const DAY = 86_400_000;
const RANK: Record<EvidenceStrength, number> = { insufficient_evidence: 0, weak: 1, moderate: 2, strong: 3 };

describe("1. backward compatibility: no facts + no weak edges == countIndependentCases", () => {
  it("matches the legacy counter on 3000 random claims (mapped, null-anchor, unmapped answers; mixed stances)", () => {
    const rand = rng(1);
    for (let trial = 0; trial < 3000; trial++) {
      const episodeKeys = new Map<string, string>();
      const answers: { id: string; transactionId: string | null; answerText: string }[] = [];
      const answerCount = 1 + Math.floor(rand() * 8);
      for (let i = 0; i < answerCount; i++) {
        const kind = rand();
        if (kind < 0.2) answers.push({ id: `a${i}`, transactionId: null, answerText: "" });
        else if (kind < 0.3) answers.push({ id: `a${i}`, transactionId: `unmapped-${i}`, answerText: "" }); // no episode key
        else {
          const episode = `EP#${Math.floor(rand() * 4)}`;
          episodeKeys.set(`t${i}`, episode);
          answers.push({ id: `a${i}`, transactionId: `t${i}`, answerText: "" });
        }
      }
      const citations: EvidenceCitation[] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 10); i++) {
        citations.push({ interviewAnswerId: `a${Math.floor(rand() * answerCount)}`, stance: rand() < 0.35 ? "contradicting" : "supporting" });
      }

      const resolver = createIndependenceResolver({ episodeKeyByTransactionId: episodeKeys, transactions: [], answers, facts: [] });
      const basis = resolver.resolve(citations);

      // The legacy keying, written out: null anchor -> the answer's own id; unmapped -> one global sentinel; else the episode.
      const byId = new Map(answers.map((a) => [a.id, a]));
      const legacyKey = (c: EvidenceCitation) => {
        const a = byId.get(c.interviewAnswerId!)!;
        return a.transactionId === null ? a.id : episodeKeys.get(a.transactionId) ?? "__unmapped__";
      };
      const legacy = countIndependentCases(citations.map((c) => ({ ...c, stance: c.stance })), legacyKey);

      expect(basis.confidenceInputs).toEqual({ supporting: legacy.supportingCount, contradicting: legacy.contradictingCount });
      expect(basis.exact).toBe(true);
      expect(basis.supportingUpper).toBe(basis.supportingLower);
    }
  });

  it("same-episode behavior is unchanged: MP buy + partial sell + final sell are ONE case", () => {
    const resolver = createIndependenceResolver(ctx(MP_TRADES.slice(0, 3), MP_ANSWERS.slice(0, 3)));
    const basis = resolver.resolve([cite("a-mp-buy"), cite("a-mp-s1"), cite("a-mp-s2")]);
    expect(basis.groups).toHaveLength(1);
    expect(basis.groups[0]?.reasons).toEqual([{ kind: "same_episode", ref: "MP#1" }]);
    expect(basis.confidenceInputs).toEqual({ supporting: 1, contradicting: 0 });
  });
});

// ---------------------------------------------------------------------
// 2-4. The closed-form envelope vs an exhaustive oracle.
// ---------------------------------------------------------------------
function worldCounts(contradicting: boolean[], edges: [number, number][], mask: number) {
  const parent = contradicting.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  edges.forEach(([a, b], i) => {
    if (mask & (1 << i)) parent[find(a)] = find(b);
  });
  const comp = new Map<number, boolean>();
  contradicting.forEach((c, i) => comp.set(find(i), (comp.get(find(i)) ?? false) || c));
  let s = 0;
  let c = 0;
  for (const has of comp.values()) {
    if (has) c++;
    else s++;
  }
  return { s, c };
}

describe("2. brute-force oracle (test-only): the production envelope IS the exact minimum tier", () => {
  it("on 6000 random claim graphs, f(S_lb, C_ub) equals the minimum tier over EVERY feasible weak-edge world", () => {
    const rand = rng(2);
    let realizable = 0;
    for (let trial = 0; trial < 6000; trial++) {
      const n = 2 + Math.floor(rand() * 7);
      const contradicting = Array.from({ length: n }, () => rand() < 0.35);
      const all: [number, number][] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) all.push([i, j]);
      const p = [0.1, 0.25, 0.5][Math.floor(rand() * 3)]!;
      const edges = all.filter(() => rand() < p).slice(0, 10);

      let minRank = 99;
      const attained = new Set<string>();
      for (let mask = 0; mask < 1 << edges.length; mask++) {
        const { s, c } = worldCounts(contradicting, edges, mask);
        attained.add(`${s},${c}`);
        minRank = Math.min(minRank, RANK[calculateEvidenceStrength(s, c)]);
      }

      const env = envelopeCounts(contradicting, edges);
      expect(RANK[calculateEvidenceStrength(env.supportingLower, env.contradictingUpper)]).toBe(minRank);
      // The pessimistic pair is a REAL world, not just a bound.
      if (attained.has(`${env.supportingLower},${env.contradictingUpper}`)) realizable++;
    }
    expect(realizable).toBe(6000);
  });
});

describe("3. weak-edge monotonicity: adding an unresolved edge never raises confidence", () => {
  it("S_lb never rises, C_ub never changes, and the tier never rises, for every added edge on random graphs", () => {
    const rand = rng(3);
    for (let trial = 0; trial < 3000; trial++) {
      const n = 2 + Math.floor(rand() * 7);
      const contradicting = Array.from({ length: n }, () => rand() < 0.35);
      const edges: [number, number][] = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.floor(rand() * n);
        const b = Math.floor(rand() * n);
        if (a === b) continue;
        const before = envelopeCounts(contradicting, edges);
        edges.push([a, b]);
        const after = envelopeCounts(contradicting, edges);
        expect(after.supportingLower).toBeLessThanOrEqual(before.supportingLower);
        expect(after.contradictingUpper).toBe(before.contradictingUpper);
        expect(RANK[calculateEvidenceStrength(after.supportingLower, after.contradictingUpper)]).toBeLessThanOrEqual(
          RANK[calculateEvidenceStrength(before.supportingLower, before.contradictingUpper)]
        );
      }
    }
  });
});

describe("4. stance asymmetry: unresolved links never reduce C_ub", () => {
  it("C_ub equals the number of contradicting groups whatever weak edges exist", () => {
    const rand = rng(4);
    for (let trial = 0; trial < 2000; trial++) {
      const n = 2 + Math.floor(rand() * 8);
      const contradicting = Array.from({ length: n }, () => rand() < 0.5);
      const edges: [number, number][] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < 0.5) edges.push([i, j]);
      expect(envelopeCounts(contradicting, edges).contradictingUpper).toBe(contradicting.filter(Boolean).length);
    }
  });

  it("end to end: two contradicting endpoints of an isolated pair stay TWO contradicting cases (a weak edge never flatters), while a confirmed fact collapses them to one", () => {
    const weak = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS)).resolve([
      cite("a-mp-s2", "contradicting"),
      cite("a-mrvl", "contradicting"),
    ]);
    expect(weak.weakEdges).toHaveLength(1);
    expect(weak.weakEdges[0]?.affectsSupport).toBe(false);
    expect(weak.confidenceInputs).toEqual({ supporting: 0, contradicting: 2 });

    const fact: EffectiveLinkFact = { id: "F1", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] };
    const known = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, [fact])).resolve([
      cite("a-mp-s2", "contradicting"),
      cite("a-mrvl", "contradicting"),
    ]);
    expect(known.confidenceInputs).toEqual({ supporting: 0, contradicting: 1 });
    expect(known.exact).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Real MP -> MRVL golden + candidate policy
// ---------------------------------------------------------------------
describe("the real MP -> MRVL reallocation (golden)", () => {
  const resolver = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS));

  it("the final MP sale and the MRVL buy are ONE weak-linked decision: S_lb=1, S_ub=2, C_ub=0, tier stays insufficient", () => {
    const basis = resolver.resolve([cite("a-mp-s2"), cite("a-mrvl")]);
    expect(basis.supportingLower).toBe(1);
    expect(basis.supportingUpper).toBe(2);
    expect(basis.contradictingUpper).toBe(0);
    expect(basis.exact).toBe(false);
    expect(basis.weakEdges).toHaveLength(1);
    expect(basis.weakEdges[0]?.reasons).toEqual(["exclusive_counterpart", "named_counterpart"]);
    expect(assessCitations(resolver, [cite("a-mp-s2"), cite("a-mrvl")]).evidenceStrength).toBe("insufficient_evidence");
  });

  it("the MP ENTRY and the MRVL buy stay independent (same side: never a candidate), so an entry claim is not suppressed", () => {
    const basis = resolver.resolve([cite("a-mp-buy"), cite("a-mrvl")]);
    expect(basis.confidenceInputs).toEqual({ supporting: 2, contradicting: 0 });
    expect(basis.weakEdges).toEqual([]);
    expect(basis.exact).toBe(true);
  });

  it("citing every MP answer plus the MRVL buy still counts the reallocation once", () => {
    const basis = resolver.resolve([cite("a-mp-buy"), cite("a-mp-s1"), cite("a-mp-s2"), cite("a-mrvl")]);
    expect(basis.groups).toHaveLength(2);
    expect(basis.confidenceInputs.supporting).toBe(1);
  });
});

describe("5. bare temporal proximity is REVIEW-ONLY and never affects counts", () => {
  // A busy account around the pair (other tickers, other episodes) defeats
  // isolation; the answers name nothing, so there is no corroboration.
  const BUSY: TradeSpec[] = [
    { id: "a-sell", ticker: "AAA", type: "sell", date: "2026-03-10" },
    { id: "b-buy", ticker: "BBB", type: "buy", date: "2026-03-12" },
    { id: "x1", ticker: "XX1", type: "buy", date: "2026-03-11" },
    { id: "x2", ticker: "XX2", type: "sell", date: "2026-03-11" },
  ];
  const ANS: AnswerSpec[] = [
    { id: "ans-a", txn: "a-sell", text: "sold because it stalled" },
    { id: "ans-b", txn: "b-buy", text: "bought because I liked it" },
  ];

  it("an opposite-side cross-ticker pair within 14 days without corroboration is listed as review-only and counts as TWO", () => {
    const basis = createIndependenceResolver(ctx(BUSY, ANS)).resolve([cite("ans-a"), cite("ans-b")]);
    expect(basis.weakEdges).toEqual([]);
    expect(basis.reviewOnly).toHaveLength(1);
    expect(basis.reviewOnly[0]?.transactionPairs).toEqual([["a-sell", "b-buy"]]);
    expect(basis.confidenceInputs).toEqual({ supporting: 2, contradicting: 0 });
    expect(basis.supportingLower).toBe(basis.supportingUpper);
    expect(basis.exact).toBe(true);
  });

  it("same-day-any-side is REJECTED: two same-day buys of different tickers are not even review-only", () => {
    const trades: TradeSpec[] = [
      { id: "b1", ticker: "AAA", type: "buy", date: "2026-03-10" },
      { id: "b2", ticker: "BBB", type: "buy", date: "2026-03-10" },
    ];
    const basis = createIndependenceResolver(
      ctx(trades, [
        { id: "x", txn: "b1", text: "BBB" },
        { id: "y", txn: "b2", text: "AAA" },
      ])
    ).resolve([cite("x"), cite("y")]);
    expect(basis.weakEdges).toEqual([]);
    expect(basis.reviewOnly).toEqual([]);
    expect(basis.confidenceInputs.supporting).toBe(2);
  });
});

describe("6. exclusive-counterpart isolation", () => {
  const PAIR: TradeSpec[] = [
    { id: "s", ticker: "SSS", type: "sell", date: "2026-05-10T00:00:00.000Z" },
    { id: "b", ticker: "BBB", type: "buy", date: "2026-05-12T00:00:00.000Z" },
  ];
  const ANS: AnswerSpec[] = [
    { id: "as", txn: "s" },
    { id: "ab", txn: "b" },
  ];
  const run = (extra: TradeSpec[]) => createIndependenceResolver(ctx([...PAIR, ...extra], ANS)).resolve([cite("as"), cite("ab")]);

  it("a quiet account makes the pair an exclusive counterpart: a weak edge that lowers S_lb", () => {
    const basis = run([]);
    expect(basis.weakEdges[0]?.reasons).toEqual(["exclusive_counterpart"]);
    expect(basis.confidenceInputs.supporting).toBe(1);
    expect(basis.supportingUpper).toBe(2);
  });

  it("any other trade of another episode inside the margin breaks isolation (inclusive at exactly 3 days)", () => {
    expect(run([{ id: "o", ticker: "OOO", type: "buy", date: "2026-05-15T00:00:00.000Z" }]).weakEdges).toEqual([]); // = latest + 3d exactly
    expect(run([{ id: "o", ticker: "OOO", type: "buy", date: "2026-05-07T00:00:00.000Z" }]).weakEdges).toEqual([]); // = earliest - 3d exactly
  });

  it("a trade just OUTSIDE the margin does not break isolation", () => {
    expect(run([{ id: "o", ticker: "OOO", type: "buy", date: "2026-05-15T00:00:00.001Z" }]).weakEdges).toHaveLength(1);
    expect(run([{ id: "o", ticker: "OOO", type: "buy", date: "2026-05-06T23:59:59.999Z" }]).weakEdges).toHaveLength(1);
  });

  it("trades of the pair's OWN episodes never count as activity", () => {
    const own: TradeSpec[] = [
      { id: "s-earlier", ticker: "SSS", type: "buy", date: "2026-05-09T00:00:00.000Z" }, // SSS episode opens before the sale
      { id: "b-later", ticker: "BBB", type: "buy", date: "2026-05-13T00:00:00.000Z" }, // BBB adds to its open episode
    ];
    expect(run(own).weakEdges).toHaveLength(1);
  });

  it("percolation regression on a realistic-density history: bare proximity is dense but never counted, isolation almost never fires on unrelated evidence", () => {
    // ~140 trades: 12 bulk rebalance days of 10 trades (5 buys of new tickers, 5 sells of held ones) plus 20 sparse
    // singles — the same shape as the real investor's history (most trades have a same-day opposite-side partner).
    const rand = rng(6);
    const trades: TradeSpec[] = [];
    const held: string[] = [];
    let tickerNo = 0;
    let day = Date.parse("2026-01-05T00:00:00.000Z");
    const push = (type: "buy" | "sell") => {
      if (type === "sell" && held.length > 0) {
        const ticker = held.splice(Math.floor(rand() * held.length), 1)[0]!;
        trades.push({ id: `t${trades.length}`, ticker, type, date: new Date(day).toISOString(), qty: 10 });
      } else {
        const ticker = `TK${tickerNo++}`;
        held.push(ticker);
        trades.push({ id: `t${trades.length}`, ticker, type: "buy", date: new Date(day).toISOString(), qty: 10 });
      }
    };
    for (let d = 0; d < 12; d++) {
      for (let k = 0; k < 10; k++) push(k % 2 === 0 ? "buy" : "sell");
      day += (6 + Math.floor(rand() * 5)) * DAY;
      if (d % 2 === 1) for (let s = 0; s < 3; s++) { push(rand() < 0.5 ? "buy" : "sell"); day += (9 + Math.floor(rand() * 6)) * DAY; }
    }
    expect(trades.length).toBeGreaterThanOrEqual(120);

    const answers: AnswerSpec[] = trades.map((t) => ({ id: `ans-${t.id}`, txn: t.id }));
    const context = ctx(trades, answers);
    const resolver = createIndependenceResolver(context);

    let sets = 0;
    let withReviewOnly = 0;
    let withWeak = 0;
    for (let trial = 0; trial < 4000; trial++) {
      const picked: TradeSpec[] = [];
      const seenTickers = new Set<string>();
      let guard = 0;
      while (picked.length < 5 && guard++ < 200) {
        const t = trades[Math.floor(rand() * trades.length)]!;
        if (seenTickers.has(t.ticker)) continue;
        seenTickers.add(t.ticker);
        picked.push(t);
      }
      if (picked.length < 5) continue;
      sets++;
      const basis = resolver.resolve(picked.map((t) => cite(`ans-${t.id}`)));
      if (basis.reviewOnly.length > 0) withReviewOnly++;
      if (basis.weakEdges.length > 0) withWeak++;
      // No named counterpart exists (answers are empty), so every weak edge here would be an isolation weak edge —
      // and bare proximity alone can never have produced a count change.
      expect(basis.weakEdges.every((e) => e.reasons.length === 1 && e.reasons[0] === "exclusive_counterpart")).toBe(true);
      expect(basis.confidenceInputs.supporting).toBeGreaterThanOrEqual(basis.groups.length - basis.weakEdges.length);
    }
    // The fixture really is dense: bare proximity is everywhere ...
    expect(withReviewOnly / sets).toBeGreaterThan(0.2);
    // ... yet almost none of it turns into a count change: isolation on unrelated evidence stays rare.
    expect(withWeak / sets).toBeLessThan(0.02);
  });
});

describe("7. named-counterpart corroboration (deterministic, user text only)", () => {
  // A busy account so isolation can never fire: only the investor's words can corroborate.
  const BASE: TradeSpec[] = [
    { id: "s", ticker: "SSS", type: "sell", date: "2026-05-10" },
    { id: "b", ticker: "MRVL", type: "buy", date: "2026-05-12" },
    { id: "f1", ticker: "FF1", type: "buy", date: "2026-05-11" },
    { id: "f2", ticker: "FF2", type: "sell", date: "2026-05-11" },
  ];
  const run = (textOnSell: string, textOnBuy = "", trades: TradeSpec[] = BASE) =>
    createIndependenceResolver(
      ctx(trades, [
        { id: "as", txn: "s", text: textOnSell },
        { id: "ab", txn: "b", text: textOnBuy },
      ])
    ).resolve([cite("as"), cite("ab")]);
  const weakReasons = (b: ReturnType<typeof run>) => b.weakEdges.flatMap((e) => e.reasons);

  it("naming the counterpart ticker in either answer creates a weak edge (named_counterpart)", () => {
    expect(weakReasons(run("מכרתי כדי לקנות MRVL"))).toEqual(["named_counterpart"]);
    expect(weakReasons(run("", "financed by selling SSS"))).toEqual(["named_counterpart"]);
  });

  it("Hebrew prefix attachments and punctuation bound the token; near-miss tokens do not match", () => {
    for (const text of ["ל־MRVL", "ב-MRVL", "(MRVL)", "MRVL.", "MRVL,", "כדיMRVL"]) expect(weakReasons(run(text)), text).toEqual(["named_counterpart"]);
    for (const text of ["MRVLX", "xMRVL", "MRVL2", "2MRVL", "MRVL_", "mrvl", "Mrvl"]) {
      // `_` is not a Latin alphanumeric, so it bounds a token; every other listed variant must NOT match.
      if (text === "MRVL_") expect(weakReasons(run(text)), text).toEqual(["named_counterpart"]);
      else expect(run(text).weakEdges, text).toEqual([]);
    }
  });

  it("an own-ticker mention is not corroboration", () => {
    expect(run("I sold SSS because SSS stalled", "MRVL looked cheap").weakEdges).toEqual([]);
  });

  it("only the investor's answer text counts — nothing else in the context can corroborate", () => {
    const context = ctx(BASE, [
      { id: "as", txn: "s", text: "no names here" },
      { id: "ab", txn: "b", text: "no names here either" },
    ]);
    // IndependenceAnswer has no question field at all: the app-generated question (which always names its own ticker) cannot leak in.
    expect(Object.keys(context.answers[0]!).sort()).toEqual(["answerText", "id", "transactionId"]);
    expect(createIndependenceResolver(context).resolve([cite("as"), cite("ab")]).weakEdges).toEqual([]);
  });

  it("uses every persisted answer anchored to an endpoint, cited or not", () => {
    const resolver = createIndependenceResolver(
      ctx(BASE, [
        { id: "as", txn: "s", text: "no names" },
        { id: "as-other", txn: "s", text: "later I wrote: it was to buy MRVL" },
        { id: "ab", txn: "b", text: "no names" },
      ])
    );
    expect(weakReasons(resolver.resolve([cite("as"), cite("ab")]))).toEqual(["named_counterpart"]);
  });

  describe("collision tickers (ALL / CAN / IT / ON) are ordinary English words", () => {
    const trades = (counterpart: string): TradeSpec[] => [
      { id: "s", ticker: "SSS", type: "sell", date: "2026-05-10" },
      { id: "b", ticker: counterpart, type: "buy", date: "2026-05-12" },
      { id: "f1", ticker: "FF1", type: "buy", date: "2026-05-11" },
    ];
    const weak = (counterpart: string, text: string) => run(text, "", trades(counterpart)).weakEdges.length > 0;

    it("lowercase / capitalized English words never match", () => {
      expect(weak("ALL", "all of it was fine, we can go on")).toBe(false);
      expect(weak("CAN", "I can do it on my own, all good")).toBe(false);
      expect(weak("IT", "it was time; It happens")).toBe(false);
      expect(weak("ON", "I put it on hold; On Monday")).toBe(false);
    });

    it("the uppercase token matches only its own ticker, and never inside a longer word", () => {
      expect(weak("ALL", "sold to buy ALL after the news")).toBe(true);
      expect(weak("ALL", "SMALL ALLOWED ALLY BALLPARK")).toBe(false);
      expect(weak("CAN", "moved into CAN")).toBe(true);
      expect(weak("CAN", "CANDY CANNOT")).toBe(false);
      expect(weak("IT", "rotated into IT")).toBe(true);
      expect(weak("IT", "ITEM SITE")).toBe(false);
      expect(weak("ON", "bought ON semis")).toBe(true);
      expect(weak("ON", "CONDITION ONE")).toBe(false);
    });

    it("a collision word that is NOT the counterpart's ticker corroborates nothing", () => {
      expect(weak("MRVL", "IT and ALL and CAN and ON")).toBe(false);
    });
  });

  it("the 14-day cap: exactly 14 days counts, one millisecond more is not even a review candidate", () => {
    const at = (gapMs: number): TradeSpec[] => [
      { id: "s", ticker: "SSS", type: "sell", date: "2026-05-01T00:00:00.000Z" },
      { id: "b", ticker: "MRVL", type: "buy", date: new Date(Date.parse("2026-05-01T00:00:00.000Z") + gapMs).toISOString() },
    ];
    const exactly = run("MRVL", "", at(14 * DAY));
    expect(exactly.weakEdges).toHaveLength(1);
    const over = run("MRVL", "", at(14 * DAY + 1));
    expect(over.weakEdges).toEqual([]);
    expect(over.reviewOnly).toEqual([]);
  });

  it("requires opposite sides and different tickers, even with a mention", () => {
    const buyBuy: TradeSpec[] = BASE.map((t) => (t.id === "s" ? { ...t, type: "buy" as const } : t));
    expect(run("MRVL", "", buyBuy).weakEdges).toEqual([]);
    expect(run("MRVL", "", buyBuy).reviewOnly).toEqual([]);
    const sellSell: TradeSpec[] = BASE.map((t) => (t.id === "b" ? { ...t, type: "sell" as const } : t));
    expect(run("MRVL", "", sellSell).weakEdges).toEqual([]);
    const sameTicker: TradeSpec[] = BASE.map((t) => (t.id === "b" ? { ...t, ticker: "SSS" } : t));
    expect(run("SSS", "", sameTicker).weakEdges).toEqual([]);
  });
});

describe("8. claim locality: dependence never propagates through an uncited item", () => {
  const F1: EffectiveLinkFact = { id: "F1", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] };
  const resolver = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, [F1]));

  it("the confirmed link between the MP sale and the MRVL buy does not reach the MP entry through the uncited sale", () => {
    const basis = resolver.resolve([cite("a-mp-buy"), cite("a-mrvl")]);
    expect(basis.confidenceInputs.supporting).toBe(2);
    expect(basis.confirmedFactIds).toEqual([]);
  });

  it("citing both endpoints collapses them exactly", () => {
    const basis = resolver.resolve([cite("a-mp-s2"), cite("a-mrvl")]);
    expect(basis.confidenceInputs.supporting).toBe(1);
    expect(basis.confirmedFactIds).toEqual(["F1"]);
    expect(basis.exact).toBe(true);
    expect(basis.groups[0]?.reasons.map((r) => r.kind).sort()).toEqual(["confirmed_link", "same_episode", "same_episode"]);
  });

  it("two facts sharing an UNCITED hub do not join the endpoints on either side of it", () => {
    const trades: TradeSpec[] = [
      { id: "A", ticker: "AAA", type: "sell", date: "2026-01-05" },
      { id: "B", ticker: "BBB", type: "buy", date: "2026-03-05" },
      { id: "C", ticker: "CCC", type: "sell", date: "2026-05-05" },
    ];
    const facts: EffectiveLinkFact[] = [
      { id: "F-AB", verdict: "linked", transactionIds: ["A", "B"] },
      { id: "F-BC", verdict: "linked", transactionIds: ["B", "C"] },
    ];
    const r = createIndependenceResolver(ctx(trades, [{ id: "xa", txn: "A" }, { id: "xb", txn: "B" }, { id: "xc", txn: "C" }], facts));
    expect(r.resolve([cite("xa"), cite("xc")]).confidenceInputs.supporting).toBe(2); // hub B uncited
    expect(r.resolve([cite("xa"), cite("xb"), cite("xc")]).confidenceInputs.supporting).toBe(1); // hub B cited
  });

  it("a weak edge is only ever formed between CITED anchors", () => {
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS)).resolve([cite("a-mp-buy"), cite("a-mp-s1")]);
    expect(basis.groups).toHaveLength(1); // one episode; the uncited MRVL buy plays no part
    expect(basis.weakEdges).toEqual([]);
  });
});

describe("9/10/11. KNOWN_LINKED and KNOWN_INDEPENDENT", () => {
  it("KNOWN_LINKED collapses the cited endpoints for BOTH stances; a group with disagreeing stances counts as contradicting", () => {
    const F1: EffectiveLinkFact = { id: "F1", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] };
    const r = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, [F1]));
    expect(r.resolve([cite("a-mp-s2"), cite("a-mrvl")]).confidenceInputs).toEqual({ supporting: 1, contradicting: 0 });
    expect(r.resolve([cite("a-mp-s2", "contradicting"), cite("a-mrvl", "contradicting")]).confidenceInputs).toEqual({ supporting: 0, contradicting: 1 });
    expect(r.resolve([cite("a-mp-s2", "supporting"), cite("a-mrvl", "contradicting")]).confidenceInputs).toEqual({ supporting: 0, contradicting: 1 });
  });

  it("KNOWN_INDEPENDENT suppresses the weak edge for exactly that pair and reports the fact", () => {
    const F2: EffectiveLinkFact = { id: "F2", verdict: "independent", transactionIds: ["mp-s2", "mrvl-buy"] };
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, [F2])).resolve([cite("a-mp-s2"), cite("a-mrvl")]);
    expect(basis.weakEdges).toEqual([]);
    expect(basis.reviewOnly).toEqual([]);
    expect(basis.confidenceInputs.supporting).toBe(2);
    expect(basis.exact).toBe(true);
    expect(basis.independentFactIds).toEqual(["F2"]);
  });

  it("KNOWN_INDEPENDENT cannot split a same-episode group", () => {
    const F: EffectiveLinkFact = { id: "F3", verdict: "independent", transactionIds: ["mp-s1", "mp-s2"] };
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, [F])).resolve([cite("a-mp-s1"), cite("a-mp-s2")]);
    expect(basis.groups).toHaveLength(1);
    expect(basis.confidenceInputs.supporting).toBe(1);
  });

  it("if a linked and an independent fact ever cover the same pair, linked wins (fail closed)", () => {
    const facts: EffectiveLinkFact[] = [
      { id: "F-L", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] },
      { id: "F-I", verdict: "independent", transactionIds: ["mp-s2", "mrvl-buy"] },
    ];
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, facts)).resolve([cite("a-mp-s2"), cite("a-mrvl")]);
    expect(basis.confidenceInputs.supporting).toBe(1);
  });
});

describe("12. null-anchor tripwire", () => {
  const r = createIndependenceResolver({
    episodeKeyByTransactionId: new Map([["t1", "EP#1"]]),
    transactions: [],
    answers: [
      { id: "n1", transactionId: null, answerText: "" },
      { id: "n2", transactionId: null, answerText: "" },
      { id: "m1", transactionId: "t1", answerText: "" },
    ],
    facts: [],
  });

  it("each null-transaction answer stays its own case (today's behavior) and is COUNTED in unanchoredCitations", () => {
    const basis = r.resolve([cite("n1"), cite("n2"), cite("m1")]);
    expect(basis.confidenceInputs.supporting).toBe(3);
    expect(basis.unanchoredCitations).toBe(2);
    expect(basis.groups.filter((g) => g.reasons.some((x) => x.kind === "unanchored"))).toHaveLength(2);
  });

  it("the same null-anchor answer cited twice is one case, one unanchored citation", () => {
    const basis = r.resolve([cite("n1"), cite("n1", "contradicting")]);
    expect(basis.groups).toHaveLength(1);
    expect(basis.unanchoredCitations).toBe(1);
    expect(basis.confidenceInputs).toEqual({ supporting: 0, contradicting: 1 });
  });

  it("no anchored citation means unanchoredCitations is 0", () => {
    expect(r.resolve([cite("m1")]).unanchoredCitations).toBe(0);
  });

  it("evidence with no answer needs its evidenceId, is its own case, and is unanchored", () => {
    expect(() => r.resolve([{ interviewAnswerId: null, stance: "supporting" }])).toThrow(/evidenceId/);
    const basis = r.resolve([
      { interviewAnswerId: null, stance: "supporting", evidenceId: "ev-1" },
      { interviewAnswerId: null, stance: "supporting", evidenceId: "ev-2" },
    ]);
    expect(basis.confidenceInputs.supporting).toBe(2);
    expect(basis.unanchoredCitations).toBe(2);
  });

  it("unknown answer ids collapse to the single legacy 'unmapped' case", () => {
    const basis = r.resolve([cite("ghost-1"), cite("ghost-2")]);
    expect(basis.groups).toHaveLength(1);
    expect(basis.groups[0]?.reasons).toEqual([{ kind: "unmapped", ref: "unmapped" }]);
    expect(r.hasAnswer("ghost-1")).toBe(false);
    expect(r.hasAnswer("n1")).toBe(true);
  });
});

describe("13. basis determinism", () => {
  const facts: EffectiveLinkFact[] = [
    { id: "F1", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] },
    { id: "F2", verdict: "independent", transactionIds: ["mp-buy", "mrvl-buy"] },
  ];
  const citations = [cite("a-mp-buy"), cite("a-mp-s1"), cite("a-mp-s2", "contradicting"), cite("a-mrvl")];

  it("identical semantic input gives byte-identical serialized basis, whatever the input ordering", () => {
    const base = ctx(MP_TRADES, MP_ANSWERS, facts);
    const expected = serializeIndependenceBasis(createIndependenceResolver(base).resolve(citations));

    const rand = rng(13);
    const shuffle = <T,>(xs: readonly T[]) => [...xs].sort(() => rand() - 0.5);
    for (let i = 0; i < 25; i++) {
      const shuffled: IndependenceContext = {
        episodeKeyByTransactionId: new Map(shuffle([...base.episodeKeyByTransactionId])),
        transactions: shuffle(base.transactions),
        answers: shuffle(base.answers),
        facts: shuffle(base.facts).map((f) => ({ ...f, transactionIds: shuffle(f.transactionIds) })),
      };
      expect(serializeIndependenceBasis(createIndependenceResolver(shuffled).resolve(shuffle(citations)))).toBe(expected);
    }
  });

  it("survives a jsonb round trip (Postgres re-orders object keys) byte for byte", () => {
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS, facts)).resolve(citations);
    const reorder = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reorder)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)]))
          : v;
    const roundTripped = reorder(JSON.parse(JSON.stringify(basis)));
    expect(serializeIndependenceBasis(roundTripped as typeof basis)).toBe(serializeIndependenceBasis(basis));
  });

  it("is plain JSON: no undefined, no Date, no prose, and it carries the policy version", () => {
    const basis = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS)).resolve([cite("a-mp-s2"), cite("a-mrvl")]);
    expect(JSON.parse(JSON.stringify(basis))).toEqual(basis);
    expect(basis.policyVersion).toBe(INDEPENDENCE_POLICY_VERSION);
    expect(basis.policy).toEqual(INDEPENDENCE_POLICY);
    expect(basis.schemaVersion).toBe(1);
  });

  it("the confidence inputs are exactly (S_lb, C_ub): calculateEvidenceStrength over them reproduces assessCitations", () => {
    const r = createIndependenceResolver(ctx(MP_TRADES, MP_ANSWERS));
    const assessed = assessCitations(r, [cite("a-mp-s2"), cite("a-mrvl"), cite("a-mp-buy", "contradicting")]);
    expect(assessed.supportingCount).toBe(assessed.independenceBasis.supportingLower);
    expect(assessed.contradictingCount).toBe(assessed.independenceBasis.contradictingUpper);
    expect(assessed.evidenceStrength).toBe(calculateEvidenceStrength(assessed.supportingCount, assessed.contradictingCount));
  });
});
