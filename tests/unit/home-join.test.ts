import { describe, expect, it } from "vitest";
import { deriveNextActions, NEXT_ACTION_KINDS, type NextActionsInput } from "@/lib/next-actions/next-actions";
import { deriveDecisionAttention, type DeriveDecisionAttentionInput } from "@/lib/monitoring/decision-attention";
import { joinNextActionsToAttention } from "@/components/home/join-next-actions";

// Frontend V1 unit 2 — the one presentation join on Home. The inputs are the
// REAL outputs of the two production engines, never hand-ordered lists, so
// "order preserved" means preserved from what the backend actually derived.

const TODAY = new Date("2026-09-30T12:00:00Z");
const d = (s: string) => new Date(`${s}T12:00:00Z`);

// Three decisions: A and B will be in attention (a due review date), C will not.
const decisions = [
  { id: "dec-a", ticker: "AAAA", decisionType: "BUY", decisionDate: d("2026-08-01"), reviewByDate: d("2026-09-10") },
  { id: "dec-b", ticker: "BBBB", decisionType: "BUY", decisionDate: d("2026-08-05"), reviewByDate: d("2026-09-01") },
  { id: "dec-c", ticker: "CCCC", decisionType: "PASS", decisionDate: d("2026-07-01"), reviewByDate: null },
];

function attentionFixture() {
  const input: DeriveDecisionAttentionInput = {
    today: TODAY,
    timeZone: "UTC",
    decisions: decisions.map((x) => ({ ...x, reviews: [], predictions: [], snapshot: null })),
    transactions: [],
    historyLatestTransactionDate: d("2026-09-20"),
    portfolio: { status: "ok", warningCount: 0, positions: [], episodeKeyByTransactionId: new Map() },
  };
  return deriveDecisionAttention(input);
}

function actionsFixture() {
  const input: NextActionsInput = {
    today: TODAY,
    decisions: decisions.map((x, i) => ({ ...x, reviewCount: 0, unclassifiedCandidateCount: i === 0 ? 2 : 0 })),
    openConditions: [{ predictionId: "p-1", decisionId: "dec-c", ticker: "CCCC", decisionType: "PASS", checkableByDate: d("2026-09-01") }],
    cases: [{ id: "case-1", ticker: "DDDD", status: "researching", updatedAt: d("2026-08-01") }],
    episodes: [{ anchorable: true, hasRationale: false }],
    reach: { dna: { uncitedStatements: 4, regenerationMayChangeReach: true }, strategy: { uncitedStatements: 0, regenerationMayChangeReach: false } },
  };
  return deriveNextActions(input);
}

describe("joinNextActionsToAttention", () => {
  const attention = attentionFixture();
  const actions = actionsFixture();
  const ids = attention.attention.map((i) => i.decisionId);
  const joined = joinNextActionsToAttention(ids, actions);

  it("the fixture really puts A and B in attention and C outside it", () => {
    expect(new Set(ids)).toEqual(new Set(["dec-a", "dec-b"]));
    expect(attention.items.find((i) => i.decisionId === "dec-c")?.state).not.toBe("attention");
  });

  it("a decision-scoped action of an attention decision renders with that decision", () => {
    const a = joined.byDecision.get("dec-a")!.map((x) => x.kind);
    expect(a).toContain("RESOLVE_EXECUTION_CANDIDATES");
    expect(a).toContain("REVIEW_UNREVIEWED_DECISION");
    expect(joined.byDecision.get("dec-b")!.map((x) => x.kind)).toContain("REVIEW_UNREVIEWED_DECISION");
  });

  it("no joined action renders again under the next steps, and none is lost or created", () => {
    const joinedKeys = [...joined.byDecision.values()].flat().map((a) => a.key);
    const remainingKeys = joined.remaining.map((a) => a.key);
    expect(remainingKeys.filter((k) => joinedKeys.includes(k))).toEqual([]);
    expect([...joinedKeys, ...remainingKeys].sort()).toEqual(actions.map((a) => a.key).sort());
    expect(joined.remaining.every((a) => !a.decision || !ids.includes(a.decision.id))).toBe(true);
  });

  it("actions of a decision outside attention stay in the next steps", () => {
    expect(joined.remaining.some((a) => a.decision?.id === "dec-c")).toBe(true);
  });

  it("keeps the attention engine order: the join never touches it", () => {
    const before = attention.attention.map((i) => i.decisionId);
    joinNextActionsToAttention(ids, actions);
    expect(attention.attention.map((i) => i.decisionId)).toEqual(before);
    // the engine orders due items by earliest due date: B (09-01) before A (09-10)
    expect(before).toEqual(["dec-b", "dec-a"]);
  });

  it("keeps the backend's catalogue order among the remaining actions and inside each decision", () => {
    const positionIn = (list: { key: string }[]) => list.map((a) => actions.findIndex((x) => x.key === a.key));
    const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1]! < x);
    expect(increasing(positionIn(joined.remaining))).toBe(true);
    for (const list of joined.byDecision.values()) expect(increasing(positionIn(list))).toBe(true);
    const rank = (k: string) => NEXT_ACTION_KINDS.indexOf(k as (typeof NEXT_ACTION_KINDS)[number]);
    const ranks = joined.remaining.map((a) => rank(a.kind));
    expect(ranks.every((r, i) => i === 0 || ranks[i - 1]! <= r)).toBe(true);
  });

  it("is a pure partition by decision id: it recomputes no policy", () => {
    // the same action objects come back, unmodified
    const all = [...[...joined.byDecision.values()].flat(), ...joined.remaining];
    for (const a of all) expect(actions).toContain(a);
    // with no attention decisions nothing joins, and the list is returned as is
    const none = joinNextActionsToAttention([], actions);
    expect(none.byDecision.size).toBe(0);
    expect(none.remaining).toEqual(actions);
  });
});
