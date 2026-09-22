import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";

// Decision Independence V1 — the ONE shared, pure (no DB, no AI) function
// that decides how many independent decisions a claim's cited evidence
// really represents. DNA and Strategy both count through it; Learning
// Insight is out of scope and still uses countIndependentCases directly.
//
// What it generalizes: the old case key was one label per answer (its
// position episode). Each cited item now carries a small SET of labels —
// its episode plus the id of every effective confirmed LinkFact that
// contains its transaction — and STRONG groups are the connected components
// under "shares a label". With no facts this is exactly the old behavior.
//
// Uncertain dependence is layered on top, never on the labels:
//   - a WEAK edge joins two strong groups when a cross-ticker,
//     opposite-side pair of their cited transactions within maxGapDays is
//     corroborated by (a) an exclusive-counterpart isolation test or (b) the
//     investor naming the counterpart ticker in their own answer text. It
//     lowers the SUPPORTING count only (S_lb) — never the contradicting one.
//   - bare temporal proximity is REVIEW-ONLY: reported, never counted.
//   - an effective "independent" fact suppresses the pair's edge.
//
// Everything is computed from the persisted inputs handed in. There is no
// parameter through which an AI, or any caller, can inject a candidate.
export const INDEPENDENCE_POLICY_VERSION = "independence-policy-v1";
export const INDEPENDENCE_POLICY = { maxGapDays: 14, isolationMarginDays: 3 } as const;

const DAY_MS = 86_400_000;
const UNMAPPED_LABEL = "unmapped";

export interface IndependenceTransaction {
  id: string;
  ticker: string | null;
  transactionType: string;
  transactionDate: Date;
}

/** answerText is the investor's own words — never the app-generated question. */
export interface IndependenceAnswer {
  id: string;
  transactionId: string | null;
  answerText: string;
}

/** An EFFECTIVE (chain-head) investor-authored fact — see src/db/repositories/link-facts.ts. */
export interface EffectiveLinkFact {
  id: string;
  verdict: "linked" | "independent";
  transactionIds: readonly string[];
}

export interface IndependenceContext {
  /** transaction id -> position-episode key (computePositions().episodeKeyByTransactionId). */
  episodeKeyByTransactionId: ReadonlyMap<string, string>;
  transactions: readonly IndependenceTransaction[];
  answers: readonly IndependenceAnswer[];
  facts: readonly EffectiveLinkFact[];
}

export interface EvidenceCitation {
  /** null = evidence not sourced from an InterviewAnswer (learning-insight agreement, manual note). */
  interviewAnswerId: string | null;
  stance: "supporting" | "contradicting";
  /** Required when interviewAnswerId is null (it is the citation's only identity). */
  evidenceId?: string;
}

export type WeakEdgeReason = "exclusive_counterpart" | "named_counterpart";

export interface BasisGroupReason {
  kind: "same_episode" | "confirmed_link" | "unanchored" | "unmapped";
  ref: string;
}

export interface BasisGroup {
  key: string;
  stance: "supporting" | "contradicting";
  citations: string[];
  reasons: BasisGroupReason[];
}

export interface BasisWeakEdge {
  a: string;
  b: string;
  reasons: WeakEdgeReason[];
  /** false when both endpoints are contradicting groups: recorded, but it cannot change S_lb or C_ub. */
  affectsSupport: boolean;
  transactionPairs: [string, string][];
}

export interface BasisReviewOnly {
  a: string;
  b: string;
  transactionPairs: [string, string][];
}

// Also the persisted shape (independence_basis_json): enough to reproduce
// WHY a version was counted as it was. Plain JSON, deterministic ordering,
// no prose, no dates.
export interface IndependenceBasis {
  schemaVersion: 1;
  policyVersion: string;
  policy: { maxGapDays: number; isolationMarginDays: number };
  /** S_lb: supporting independent decisions if every weak edge is real. */
  supportingLower: number;
  /** S_ub: supporting independent decisions if no weak edge is real (display/audit only). */
  supportingUpper: number;
  /** C_ub: contradicting groups — weak edges never collapse them. There is deliberately no C_lb. */
  contradictingUpper: number;
  /** The ONLY numbers calculateEvidenceStrength may receive. */
  confidenceInputs: { supporting: number; contradicting: number };
  /** true = no weak edge exists, so the counts are not merely bounds. */
  exact: boolean;
  /** Cited items with no transaction anchor (null-transaction answer, or non-answer evidence): counted as their own case, exactly as before. */
  unanchoredCitations: number;
  groups: BasisGroup[];
  confirmedFactIds: string[];
  independentFactIds: string[];
  weakEdges: BasisWeakEdge[];
  reviewOnly: BasisReviewOnly[];
}

export interface EvidenceIndependenceResolver {
  /** True when the answer id is a persisted answer of this investor (the validators' "real citation" test). */
  hasAnswer(answerId: string): boolean;
  resolve(citations: readonly EvidenceCitation[]): IndependenceBasis;
}

interface Trade {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  time: number;
  episode: string;
}

interface Item {
  ref: string;
  stance: "supporting" | "contradicting";
  labels: string[];
  /** Anchor transaction id when the item is a resolvable trade. */
  anchor: string | null;
  unanchored: boolean;
}

// THE production envelope. `contradicting[i]` says group i holds a
// contradicting citation; `weakEdges` are index pairs of groups a weak edge
// might join. S_lb = weak-edge components holding no contradicting group;
// C_ub = contradicting groups; S_ub = supporting-only groups (no weak edge
// real). Merging two groups never raises S or C, and the worst world —
// every supporting group absorbed by a contradicting one, no two
// contradicting groups merged — is realizable, so
// calculateEvidenceStrength(S_lb, C_ub) is EXACTLY the minimum tier over
// every feasible resolution of the weak edges. Closed form: production
// never enumerates worlds (a brute-force oracle exists only in tests).
export function envelopeCounts(
  contradicting: readonly boolean[],
  weakEdges: readonly (readonly [number, number])[]
): { supportingLower: number; supportingUpper: number; contradictingUpper: number } {
  const parent = contradicting.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const [a, b] of weakEdges) parent[find(a)] = find(b);
  const componentHasContradiction = new Map<number, boolean>();
  contradicting.forEach((has, i) => {
    const root = find(i);
    componentHasContradiction.set(root, (componentHasContradiction.get(root) ?? false) || has);
  });
  return {
    supportingLower: [...componentHasContradiction.values()].filter((has) => !has).length,
    supportingUpper: contradicting.filter((has) => !has).length,
    contradictingUpper: contradicting.filter((has) => has).length,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createIndependenceResolver(context: IndependenceContext): EvidenceIndependenceResolver {
  const maxGapMs = INDEPENDENCE_POLICY.maxGapDays * DAY_MS;
  const marginMs = INDEPENDENCE_POLICY.isolationMarginDays * DAY_MS;

  // Only buy/sell rows with a ticker and a derivable episode take part —
  // candidates and the "busy account" test both. (A trade with no episode
  // key cannot occur for a persisted row; ignoring it can only make an
  // isolation signal fire, never suppress one — the fail-closed direction.)
  const tradeById = new Map<string, Trade>();
  const trades: Trade[] = [];
  for (const t of context.transactions) {
    if (t.ticker === null || t.ticker === "") continue;
    if (t.transactionType !== "buy" && t.transactionType !== "sell") continue;
    const episode = context.episodeKeyByTransactionId.get(t.id);
    if (episode === undefined) continue;
    const trade: Trade = { id: t.id, ticker: t.ticker, side: t.transactionType, time: t.transactionDate.getTime(), episode };
    tradeById.set(t.id, trade);
    trades.push(trade);
  }

  const answersById = new Map(context.answers.map((a) => [a.id, a]));
  const answersByTransaction = new Map<string, IndependenceAnswer[]>();
  for (const a of context.answers) {
    if (a.transactionId === null) continue;
    const list = answersByTransaction.get(a.transactionId) ?? [];
    list.push(a);
    answersByTransaction.set(a.transactionId, list);
  }

  const linkedFactsByTransaction = new Map<string, string[]>();
  const independentFacts: { id: string; members: Set<string> }[] = [];
  for (const f of context.facts) {
    if (f.verdict === "linked") {
      for (const txnId of f.transactionIds) {
        const list = linkedFactsByTransaction.get(txnId) ?? [];
        list.push(f.id);
        linkedFactsByTransaction.set(txnId, list);
      }
    } else {
      independentFacts.push({ id: f.id, members: new Set(f.transactionIds) });
    }
  }

  const tickerPatterns = new Map<string, RegExp>();
  // Case-sensitive Latin token: the investor writes tickers in capitals; a
  // lowercase "can"/"it"/"on"/"all" is an ordinary word, and Hebrew letters
  // (prefix attachments like ב־MP, ל-MRVL) are non-Latin so they bound it.
  function mentions(text: string, ticker: string): boolean {
    let pattern = tickerPatterns.get(ticker);
    if (!pattern) {
      pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(ticker)}(?![A-Za-z0-9])`);
      tickerPatterns.set(ticker, pattern);
    }
    return pattern.test(text);
  }

  // The investor named the OTHER trade's ticker in their own answer about
  // this trade. Own-ticker mentions never count: the ticker searched for is
  // always the counterpart's, and cross-ticker is already required.
  function namedCounterpart(a: Trade, b: Trade): boolean {
    return (
      (answersByTransaction.get(a.id) ?? []).some((ans) => mentions(ans.answerText, b.ticker)) ||
      (answersByTransaction.get(b.id) ?? []).some((ans) => mentions(ans.answerText, a.ticker))
    );
  }

  // "Exclusive counterpart": nothing else happened in the account around
  // this pair — no other buy/sell inside [earliest - margin, latest +
  // margin] outside the two trades' own episodes. On this investor's real
  // history that flags 0.04% of cross-ticker pairs; bare proximity flags
  // 6-13% and would percolate through rebalance days.
  function exclusiveCounterpart(a: Trade, b: Trade): boolean {
    const lo = Math.min(a.time, b.time) - marginMs;
    const hi = Math.max(a.time, b.time) + marginMs;
    for (const t of trades) {
      if (t.time < lo || t.time > hi) continue;
      if (t.episode === a.episode || t.episode === b.episode) continue;
      return false;
    }
    return true;
  }

  function resolve(citations: readonly EvidenceCitation[]): IndependenceBasis {
    // ---- 1. items and their labels ---------------------------------
    const items: Item[] = citations.map((c) => {
      if (c.interviewAnswerId === null) {
        if (c.evidenceId === undefined) {
          throw new Error("resolveEvidenceIndependence: a citation without an interview answer must carry its evidenceId.");
        }
        const ref = `evidence:${c.evidenceId}`;
        return { ref, stance: c.stance, labels: [ref], anchor: null, unanchored: true };
      }
      const ref = `answer:${c.interviewAnswerId}`;
      const answer = answersById.get(c.interviewAnswerId);
      // Unknown answer: the old global sentinel — all of them collapse to one case.
      if (!answer) return { ref, stance: c.stance, labels: [UNMAPPED_LABEL], anchor: null, unanchored: false };
      // Null-transaction answer: its own case, exactly as before.
      if (answer.transactionId === null) return { ref, stance: c.stance, labels: [ref], anchor: null, unanchored: true };
      const episode = context.episodeKeyByTransactionId.get(answer.transactionId);
      if (episode === undefined) return { ref, stance: c.stance, labels: [UNMAPPED_LABEL], anchor: null, unanchored: false };
      const factLabels = (linkedFactsByTransaction.get(answer.transactionId) ?? []).map((id) => `fact:${id}`);
      return {
        ref,
        stance: c.stance,
        labels: [`episode:${episode}`, ...factLabels],
        anchor: tradeById.has(answer.transactionId) ? answer.transactionId : null,
        unanchored: false,
      };
    });

    // ---- 2. strong groups: components under shared labels ----------
    const parent = items.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const firstWithLabel = new Map<string, number>();
    items.forEach((item, i) => {
      for (const label of item.labels) {
        const seen = firstWithLabel.get(label);
        if (seen === undefined) firstWithLabel.set(label, i);
        else parent[find(i)] = find(seen);
      }
    });

    const members = new Map<number, number[]>();
    items.forEach((_, i) => {
      const root = find(i);
      members.set(root, [...(members.get(root) ?? []), i]);
    });

    interface Group {
      key: string;
      contradicting: boolean;
      citations: string[];
      reasons: BasisGroupReason[];
      anchors: string[];
    }
    const confirmedFactIds = new Set<string>();
    const groups: Group[] = [...members.values()].map((idxs) => {
      const groupItems = idxs.map((i) => items[i]!);
      const labels = [...new Set(groupItems.flatMap((it) => it.labels))].sort(compare);
      const reasons: BasisGroupReason[] = [];
      for (const label of labels) {
        if (label.startsWith("episode:")) reasons.push({ kind: "same_episode", ref: label.slice("episode:".length) });
        else if (label.startsWith("fact:")) {
          // A fact only collapses anything when it links >= 2 distinct cited anchors here.
          const carriers = new Set(groupItems.filter((it) => it.labels.includes(label)).map((it) => it.ref));
          if (carriers.size >= 2) {
            reasons.push({ kind: "confirmed_link", ref: label.slice("fact:".length) });
            confirmedFactIds.add(label.slice("fact:".length));
          }
        } else if (label === UNMAPPED_LABEL) reasons.push({ kind: "unmapped", ref: UNMAPPED_LABEL });
        else reasons.push({ kind: "unanchored", ref: label });
      }
      return {
        key: labels[0]!,
        contradicting: groupItems.some((it) => it.stance === "contradicting"),
        citations: [...new Set(groupItems.map((it) => it.ref))].sort(compare),
        reasons,
        anchors: [...new Set(groupItems.map((it) => it.anchor).filter((a): a is string => a !== null))].sort(compare),
      };
    });
    groups.sort((x, y) => compare(x.key, y.key));

    // ---- 3. weak edges / review-only pairs between groups ----------
    const edgeReasons = new Map<string, Set<WeakEdgeReason>>();
    const edgePairs = new Map<string, [string, string][]>();
    const reviewPairs = new Map<string, [string, string][]>();
    const independentFactIds = new Set<string>();

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const gi = groups[i]!;
        const gj = groups[j]!;
        const edgeKey = `${i}|${j}`;
        for (const idA of gi.anchors) {
          for (const idB of gj.anchors) {
            const a = tradeById.get(idA);
            const b = tradeById.get(idB);
            if (!a || !b) continue;
            if (a.ticker === b.ticker || a.side === b.side || Math.abs(a.time - b.time) > maxGapMs) continue;

            const suppressor = independentFacts.find((f) => f.members.has(idA) && f.members.has(idB));
            if (suppressor) {
              independentFactIds.add(suppressor.id);
              continue;
            }

            const pair: [string, string] = compare(idA, idB) <= 0 ? [idA, idB] : [idB, idA];
            const reasons: WeakEdgeReason[] = [];
            if (exclusiveCounterpart(a, b)) reasons.push("exclusive_counterpart");
            if (namedCounterpart(a, b)) reasons.push("named_counterpart");

            if (reasons.length > 0) {
              const set = edgeReasons.get(edgeKey) ?? new Set<WeakEdgeReason>();
              reasons.forEach((r) => set.add(r));
              edgeReasons.set(edgeKey, set);
              edgePairs.set(edgeKey, [...(edgePairs.get(edgeKey) ?? []), pair]);
            } else {
              reviewPairs.set(edgeKey, [...(reviewPairs.get(edgeKey) ?? []), pair]);
            }
          }
        }
      }
    }

    const sortPairs = (pairs: [string, string][]) =>
      [...pairs].sort((p, q) => compare(p[0], q[0]) || compare(p[1], q[1]));
    const weakEdges: BasisWeakEdge[] = [];
    const weakEdgeIndexes: [number, number][] = [];
    const reviewOnly: BasisReviewOnly[] = [];

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const edgeKey = `${i}|${j}`;
        const gi = groups[i]!;
        const gj = groups[j]!;
        const reasons = edgeReasons.get(edgeKey);
        if (reasons) {
          weakEdges.push({
            a: gi.key,
            b: gj.key,
            reasons: [...reasons].sort(compare) as WeakEdgeReason[],
            affectsSupport: !gi.contradicting || !gj.contradicting,
            transactionPairs: sortPairs(edgePairs.get(edgeKey)!),
          });
          weakEdgeIndexes.push([i, j]);
        } else if (reviewPairs.has(edgeKey)) {
          reviewOnly.push({ a: gi.key, b: gj.key, transactionPairs: sortPairs(reviewPairs.get(edgeKey)!) });
        }
      }
    }

    // ---- 4. closed-form envelope (see envelopeCounts) --------------
    const { supportingLower, supportingUpper, contradictingUpper } = envelopeCounts(
      groups.map((g) => g.contradicting),
      weakEdgeIndexes
    );

    return {
      schemaVersion: 1,
      policyVersion: INDEPENDENCE_POLICY_VERSION,
      policy: { ...INDEPENDENCE_POLICY },
      supportingLower,
      supportingUpper,
      contradictingUpper,
      confidenceInputs: { supporting: supportingLower, contradicting: contradictingUpper },
      exact: weakEdges.length === 0,
      unanchoredCitations: new Set(items.filter((it) => it.unanchored).map((it) => it.ref)).size,
      groups: groups.map((g) => ({
        key: g.key,
        stance: g.contradicting ? "contradicting" : "supporting",
        citations: g.citations,
        reasons: g.reasons,
      })),
      confirmedFactIds: [...confirmedFactIds].sort(compare),
      independentFactIds: [...independentFactIds].sort(compare),
      weakEdges,
      reviewOnly,
    };
  }

  return { hasAnswer: (answerId) => answersById.has(answerId), resolve };
}

export interface AssessedEvidence {
  /** S_lb — persisted as supportingEvidenceCount. */
  supportingCount: number;
  /** C_ub — persisted as contradictingEvidenceCount. */
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
  independenceBasis: IndependenceBasis;
}

// The single place every DNA/Strategy path turns citations into
// count + tier + basis: generation validation, grounding, identity
// resolution and remediation all call this — there is no second counting
// path to diverge.
export function assessCitations(
  independence: EvidenceIndependenceResolver,
  citations: readonly EvidenceCitation[]
): AssessedEvidence {
  const basis = independence.resolve(citations);
  return {
    supportingCount: basis.confidenceInputs.supporting,
    contradictingCount: basis.confidenceInputs.contradicting,
    evidenceStrength: calculateEvidenceStrength(basis.confidenceInputs.supporting, basis.confidenceInputs.contradicting),
    independenceBasis: basis,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => compare(x, y))
        .map(([k, v]) => [k, canonicalize(v)])
    );
  }
  return value;
}

// Canonical serialization: keys sorted at every level, arrays keep their
// (already deterministic) order. jsonb re-orders keys on storage, so
// byte-identity is defined over THIS function, not over a raw column read.
export function serializeIndependenceBasis(basis: IndependenceBasis): string {
  return JSON.stringify(canonicalize(basis));
}
