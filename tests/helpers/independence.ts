import { computePositions, type TransactionInput } from "@/lib/portfolio/positions";
import {
  INDEPENDENCE_POLICY,
  INDEPENDENCE_POLICY_VERSION,
  createIndependenceResolver,
  type EffectiveLinkFact,
  type EvidenceCitation,
  type EvidenceIndependenceResolver,
  type IndependenceBasis,
  type IndependenceContext,
} from "@/lib/evidence/resolve-independence";

// Test scaffolding only. Older tests describe independence as a
// "answer id -> case key" map. This builds the REAL shared resolver from
// such a map (each answer gets a synthetic transaction whose episode key IS
// its case key; no trades, so no candidate can ever exist) — there is no
// second counting implementation here, and equal keys collapse exactly as
// they always did.
export function resolverFromCaseKeys(caseKeys: ReadonlyMap<string, string>): EvidenceIndependenceResolver {
  return createIndependenceResolver({
    episodeKeyByTransactionId: new Map([...caseKeys.values()].map((key) => [`txn:${key}`, key])),
    transactions: [],
    answers: [...caseKeys].map(([id, key]) => ({ id, transactionId: `txn:${key}`, answerText: "" })),
    facts: [],
  });
}

// A minimal, internally consistent basis for fixtures that only need a
// well-formed value to hand to a repository.
export function fixtureBasis(supporting = 0, contradicting = 0): IndependenceBasis {
  return {
    schemaVersion: 1,
    policyVersion: INDEPENDENCE_POLICY_VERSION,
    policy: { ...INDEPENDENCE_POLICY },
    supportingLower: supporting,
    supportingUpper: supporting,
    contradictingUpper: contradicting,
    confidenceInputs: { supporting, contradicting },
    exact: true,
    unanchoredCitations: 0,
    groups: [],
    confirmedFactIds: [],
    independentFactIds: [],
    weakEdges: [],
    reviewOnly: [],
  };
}

// Small seeded PRNG so every property test is reproducible.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TradeSpec {
  id: string;
  ticker: string;
  type: "buy" | "sell";
  date: string;
  qty?: number;
}
export interface AnswerSpec {
  id: string;
  txn: string | null;
  text?: string;
}

// Episode keys come from the REAL computePositions over the fixture trades.
export function contextFromTrades(
  trades: TradeSpec[],
  answers: AnswerSpec[] = [],
  facts: EffectiveLinkFact[] = []
): IndependenceContext {
  const inputs: TransactionInput[] = trades.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    transactionType: t.type,
    quantity: t.qty ?? 10,
    price: 10,
    amount: t.type === "buy" ? -100 : 100,
    transactionDate: new Date(t.date),
  }));
  return {
    episodeKeyByTransactionId: computePositions(inputs, []).episodeKeyByTransactionId,
    transactions: trades.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      transactionType: t.type,
      transactionDate: new Date(t.date),
    })),
    answers: answers.map((a) => ({ id: a.id, transactionId: a.txn, answerText: a.text ?? "" })),
    facts,
  };
}

export const cite = (id: string, stance: "supporting" | "contradicting" = "supporting"): EvidenceCitation => ({
  interviewAnswerId: id,
  stance,
});

// The real MP -> MRVL shape (dates / sides / quantities from the persisted history).
export const MP_TRADES: TradeSpec[] = [
  { id: "mp-buy", ticker: "MP", type: "buy", date: "2026-08-05", qty: 10 },
  { id: "mp-s1", ticker: "MP", type: "sell", date: "2026-08-24", qty: 6 },
  { id: "mp-s2", ticker: "MP", type: "sell", date: "2026-08-28", qty: 4 },
  { id: "mrvl-buy", ticker: "MRVL", type: "buy", date: "2026-08-28", qty: 5 },
];
export const MP_ANSWERS: AnswerSpec[] = [
  { id: "a-mp-buy", txn: "mp-buy", text: "נכנסתי ל-MP בגלל הסיפור" },
  { id: "a-mp-s1", txn: "mp-s1", text: "מימשתי חלק כדי לפנות כסף להשקעות נוספות" },
  { id: "a-mp-s2", txn: "mp-s2", text: "מכרתי את היתרה כדי לפנות כסף לקנייה של MRVL" },
  { id: "a-mrvl", txn: "mrvl-buy", text: "כדי לפנות כסף מכרתי את היתרה ב־MP" },
];
