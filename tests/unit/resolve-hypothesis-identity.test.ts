// Hypothesis Identity orchestration — tested with an INJECTED,
// deterministic match-classifier function, never a real Anthropic call
// (same convention as ground-evidence.test.ts / validate-hypotheses.test.ts).
// resolveHypothesisIdentities() itself — the real production grouping/
// recomputation logic — is what's under test; the classifier fixtures
// below encode the SAME regression scenarios named in the task, as fixed,
// known answers a real classifyHypothesisMatch() call would need separate
// live verification to actually confirm (out of scope here, same
// disclosure as ground-evidence.test.ts's CAN case).
import { describe, expect, it } from "vitest";
import {
  resolveHypothesisIdentities,
  type ExistingHypothesisForMatching,
  type HypothesisMatchFn,
} from "@/lib/dna/resolve-hypothesis-identity";
import type { ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";

function hypothesis(statement: string, evidence: ValidatedHypothesis["evidence"]): ValidatedHypothesis {
  return {
    statement,
    evidence,
    supportingCount: evidence.length,
    contradictingCount: 0,
    evidenceStrength: "insufficient_evidence",
  };
}

describe("resolveHypothesisIdentities", () => {
  it("old leverage caution <-> new leveraged/speculative-instrument caution: exact duplicate evidence across generations creates no new version and no new identity", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "old-leverage",
        statementText: "You are cautious about using leverage without conviction.",
        evidenceForCounting: [{ interviewAnswerId: "sqqq-answer", stance: "supporting" }],
      },
    ];
    const proposed = [
      hypothesis("You tend to avoid leveraged or speculative instruments without concrete information.", [
        { interviewAnswerId: "sqqq-answer", stance: "supporting", description: "Re-cited, same underlying transaction." },
      ]),
    ];
    const classifyMatch: HypothesisMatchFn = async (_statement, candidates) =>
      candidates.some((c) => c.id === "old-leverage")
        ? { matchedId: "old-leverage", reason: "same claim, different wording" }
        : { matchedId: null, reason: "no match" };

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([["sqqq-answer", "SQQQ#1"]]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      action: "no_new_information",
      hypothesisId: "old-leverage",
      statement: "You are cautious about using leverage without conviction.",
    });
  });

  // Mechanism fixture ONLY — the matchedId verdict below is deliberately
  // INJECTED to exercise the new_version/recomputation path; it is NOT an
  // assertion about what the real classifyHypothesisMatch() would decide
  // for this specific statement pair. Checked with a real, authorized
  // live call (this session's smoke test): the real classifier judged the
  // real "high-profile/momentum" vs. "macro-narrative/leading-figure"
  // pair as DISTINCT (matchedId: null) — "different underlying reasoning
  // triggers" — the opposite of the "match" injected here. That's fine
  // and expected: this test exists to prove resolveHypothesisIdentities()
  // correctly handles a MATCH result (recomputes combined evidence,
  // inserts only the genuinely-new citation, never inherits the old
  // count) — it says nothing about whether any particular real pair of
  // statements should or shouldn't match; that judgment belongs entirely
  // to the injected classifier, real or fake.
  it("MATCH result (mechanism fixture, verdict injected — not a claim about this specific real pair): a matched identity with genuinely new evidence creates a new version, recomputed from combined evidence", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "old-narrative",
        statementText: "You are drawn to high-profile, high-momentum names as major bets.",
        evidenceForCounting: [{ interviewAnswerId: "spcx-answer", stance: "supporting" }],
      },
    ];
    const proposed = [
      hypothesis(
        "You tend to enter positions based on strong belief in a macro narrative or a leading figure.",
        [
          { interviewAnswerId: "spcx-answer", stance: "supporting", description: "Musk / large IPO, re-cited." },
          { interviewAnswerId: "mp-answer", stance: "supporting", description: "Trump / rare-earths policy — genuinely new." },
        ]
      ),
    ];
    // Injected verdict for mechanism testing — see the comment above.
    const classifyMatch: HypothesisMatchFn = async (_statement, candidates) =>
      candidates.some((c) => c.id === "old-narrative")
        ? { matchedId: "old-narrative", reason: "(injected for this test) treated as the same underlying claim" }
        : { matchedId: null, reason: "no match" };

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([
        ["spcx-answer", "SPCX#1"],
        ["mp-answer", "MP#1"],
      ]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    const r = resolutions[0]!;
    expect(r.action).toBe("new_version");
    if (r.action !== "new_version") throw new Error("expected new_version");
    expect(r.hypothesisId).toBe("old-narrative");
    // Recomputed over BOTH old (SPCX) and new (MP) -> 2 independent cases —
    // never inherited from the old version's count (which was 1).
    expect(r.supportingCount).toBe(2);
    // Only the genuinely-new-to-persist citation is inserted — the
    // re-cited SPCX answer, already persisted, is not duplicated.
    expect(r.newEvidence.map((e) => e.interviewAnswerId)).toEqual(["mp-answer"]);
  });

  it("gradual-profit-taking <-> profitable-position-reallocation: two proposals in the SAME batch judged equivalent merge into one new identity, not two", async () => {
    const proposed = [
      hypothesis("You tend to realize profits gradually to free capital for new opportunities.", [
        { interviewAnswerId: "mp-1", stance: "supporting", description: "partial sell" },
      ]),
      hypothesis("You tend to sell a profitable position when a new opportunity appears.", [
        { interviewAnswerId: "mp-2", stance: "supporting", description: "final sell" },
      ]),
    ];
    // The second proposal matches the first (added to the pool as a new
    // batch candidate after being processed) — the classifier is only
    // ever asked about POOL entries, so a match here proves the
    // within-batch mechanism, not a match against something pre-existing.
    const classifyMatch: HypothesisMatchFn = async (statement, candidates) => {
      const firstBatchCandidate = candidates.find((c) => c.id.startsWith("__new_"));
      if (statement.includes("opportunity appears") && firstBatchCandidate) {
        return { matchedId: firstBatchCandidate.id, reason: "same reallocation observation, restated" };
      }
      return { matchedId: null, reason: "no match" };
    };

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      [],
      new Map([
        ["mp-1", "MP#1"],
        ["mp-2", "MP#1"], // same episode, same case key — MP's own lifecycle
      ]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
    if (resolutions[0]?.action === "new_identity") {
      expect(resolutions[0].evidence.map((e) => e.interviewAnswerId).sort()).toEqual(["mp-1", "mp-2"]);
      // Both citations are the SAME independent case (MP#1) -> 1, not 2.
      expect(resolutions[0].supportingCount).toBe(1);
    }
  });

  it("sell-winner-from-fear vs sell-winner-to-redeploy: a related but genuinely distinct trigger is NOT merged, even against an existing hypothesis on a similar topic", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "fear-sell",
        statementText: "You tend to sell winning positions out of fear of losing the gain or a pullback.",
        evidenceForCounting: [{ interviewAnswerId: "other-answer", stance: "supporting" }],
      },
    ];
    const proposed = [
      hypothesis("You tend to sell a profitable position to redeploy capital into a new opportunity.", [
        { interviewAnswerId: "mp-answer", stance: "supporting", description: "reallocation, not fear" },
      ]),
    ];
    // The classifier's job is exactly to keep these apart — the fixture
    // encodes the required, correct answer for this named regression.
    const classifyMatch: HypothesisMatchFn = async () => ({
      matchedId: null,
      reason: "different trigger — fear/risk-aversion vs. opportunity cost — not the same claim",
    });

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([["mp-answer", "MP#1"]]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
  });

  it("an existing hypothesis nothing in this batch matches produces no resolution at all (never rewritten, never touched)", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "untouched",
        statementText: "An existing hypothesis about something else entirely.",
        evidenceForCounting: [{ interviewAnswerId: "x", stance: "supporting" }],
      },
    ];
    const proposed = [hypothesis("A totally unrelated new claim.", [{ interviewAnswerId: "y", stance: "supporting", description: "d" }])];
    const classifyMatch: HypothesisMatchFn = async () => ({ matchedId: null, reason: "no match" });

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([
        ["x", "X#1"],
        ["y", "Y#1"],
      ]),
      classifyMatch
    );

    // Only the genuinely new proposal produces a resolution; "untouched"
    // never appears in the output at all — nothing to rewrite, nothing to
    // report as changed.
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
  });

  it("does not mutate its `existing` input (historical identities/evidence stay untouched objects)", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "old-1",
        statementText: "Old statement.",
        evidenceForCounting: [{ interviewAnswerId: "a", stance: "supporting" }],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));
    const proposed = [hypothesis("New matched statement.", [{ interviewAnswerId: "b", stance: "supporting", description: "d" }])];
    const classifyMatch: HypothesisMatchFn = async () => ({ matchedId: "old-1", reason: "match" });

    await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([
        ["a", "A#1"],
        ["b", "B#1"],
      ]),
      classifyMatch
    );

    expect(existing).toEqual(snapshot);
  });

  it("recomputes Evidence Strength from the combined production case keys rather than inheriting the old version's strength", async () => {
    const existing: ExistingHypothesisForMatching[] = [
      {
        id: "old-1",
        statementText: "Old statement.",
        // Old version was insufficient_evidence at 1 supporting case.
        evidenceForCounting: [{ interviewAnswerId: "a", stance: "supporting" }],
      },
    ];
    // Two genuinely new, distinct cases arrive this round -> 3 total,
    // ratio 1.0 -> "moderate" under the real threshold table (not
    // "strong", since total<5) — this must be COMPUTED, never copied
    // forward from the old "insufficient_evidence".
    const proposed = [
      hypothesis("Old statement, extended.", [
        { interviewAnswerId: "b", stance: "supporting", description: "d" },
        { interviewAnswerId: "c", stance: "supporting", description: "d" },
      ]),
    ];
    const classifyMatch: HypothesisMatchFn = async () => ({ matchedId: "old-1", reason: "match" });

    const resolutions = await resolveHypothesisIdentities(
      proposed,
      existing,
      new Map([
        ["a", "A#1"],
        ["b", "B#1"],
        ["c", "C#1"],
      ]),
      classifyMatch
    );

    expect(resolutions[0]?.action).toBe("new_version");
    if (resolutions[0]?.action === "new_version") {
      expect(resolutions[0].supportingCount).toBe(3);
      expect(resolutions[0].evidenceStrength).toBe("moderate");
    }
  });
});
