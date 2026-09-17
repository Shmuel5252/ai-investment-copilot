// Strategy Identity Resolution — tested with an INJECTED, deterministic
// match-classifier function, never a real Anthropic call (same
// convention as resolve-hypothesis-identity.test.ts).
// resolveObservedPrincipleIdentities() and filterToObservedCandidates()
// themselves — the real production logic — are what's under test.
import { describe, expect, it } from "vitest";
import {
  resolveObservedPrincipleIdentities,
  filterToObservedCandidates,
  type ExistingObservedPrincipleForMatching,
  type ObservedPrincipleMatchFn,
} from "@/lib/strategy/resolve-principle-identity";
import type { ValidatedObservedPrinciple } from "@/lib/strategy/validate-principles";

function principle(statement: string, evidence: ValidatedObservedPrinciple["evidence"]): ValidatedObservedPrinciple {
  return {
    statement,
    evidence,
    supportingCount: evidence.length,
    contradictingCount: 0,
    evidenceStrength: "insufficient_evidence",
  };
}

describe("filterToObservedCandidates", () => {
  it("keeps only principles whose CURRENT version has principleType 'observed'", () => {
    const principles = [
      { id: "declared-1", versions: [{ principleType: "declared" }] },
      { id: "observed-1", versions: [{ principleType: "observed" }] },
      { id: "validated-1", versions: [{ principleType: "validated" }] },
      { id: "observed-2", versions: [{ principleType: "observed" }] },
    ];

    const result = filterToObservedCandidates(principles);

    expect(result.map((p) => p.id).sort()).toEqual(["observed-1", "observed-2"]);
  });

  it("a principle whose current version was later changed away from observed is excluded (checks versions[0], not history)", () => {
    // versions[0] is always "current" by the same MAX(version_number)
    // convention as everywhere else in this codebase — this fixture
    // simulates a principle whose LATEST entry is no longer observed.
    const principles = [{ id: "p1", versions: [{ principleType: "declared" }] }];
    expect(filterToObservedCandidates(principles)).toEqual([]);
  });
});

describe("resolveObservedPrincipleIdentities", () => {
  it("matches an existing OBSERVED identity and creates a new version when evidence genuinely grows", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "old-leverage",
        statementText: "You are cautious about using leverage without conviction.",
        evidenceForCounting: [{ interviewAnswerId: "sqqq-answer", stance: "supporting" }],
      },
    ];
    const proposed = [
      principle("You tend to avoid leveraged or speculative instruments without concrete information.", [
        { interviewAnswerId: "sqqq-answer", stance: "supporting", description: "re-cited, same underlying transaction." },
        { interviewAnswerId: "new-answer", stance: "supporting", description: "genuinely new citation." },
      ]),
    ];
    const classifyMatch: ObservedPrincipleMatchFn = async (_statement, candidates) =>
      candidates.some((c) => c.id === "old-leverage")
        ? { matchedId: "old-leverage", reason: "same claim, different wording" }
        : { matchedId: null, reason: "no match" };

    const resolutions = await resolveObservedPrincipleIdentities(
      proposed,
      existing,
      new Map([
        ["sqqq-answer", "SQQQ#1"],
        ["new-answer", "NEW#1"],
      ]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    const r = resolutions[0]!;
    expect(r.action).toBe("new_version");
    if (r.action !== "new_version") throw new Error("expected new_version");
    expect(r.principleId).toBe("old-leverage");
    expect(r.supportingCount).toBe(2);
    expect(r.newEvidence.map((e) => e.interviewAnswerId)).toEqual(["new-answer"]);
  });

  it("matching existing identity with NO genuinely new evidence produces no_new_information, no write", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "old-1",
        statementText: "Old statement.",
        evidenceForCounting: [{ interviewAnswerId: "a1", stance: "supporting" }],
      },
    ];
    const proposed = [
      principle("Re-worded old statement.", [
        { interviewAnswerId: "a1", stance: "supporting", description: "re-cited" },
      ]),
    ];
    const classifyMatch: ObservedPrincipleMatchFn = async () => ({ matchedId: "old-1", reason: "same claim" });

    const resolutions = await resolveObservedPrincipleIdentities(
      proposed,
      existing,
      new Map([["a1", "X#1"]]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({ action: "no_new_information", principleId: "old-1", statement: "Old statement." });
  });

  it("two proposals in the SAME batch judged equivalent merge into one new identity, not two (within-batch dedup)", async () => {
    const proposed = [
      principle("You tend to realize profits gradually.", [
        { interviewAnswerId: "mp-1", stance: "supporting", description: "partial sell" },
      ]),
      principle("You tend to sell a profitable position for a new opportunity.", [
        { interviewAnswerId: "mp-2", stance: "supporting", description: "final sell" },
      ]),
    ];
    const classifyMatch: ObservedPrincipleMatchFn = async (statement, candidates) => {
      const firstBatchCandidate = candidates.find((c) => c.id.startsWith("__new_"));
      if (statement.includes("new opportunity") && firstBatchCandidate) {
        return { matchedId: firstBatchCandidate.id, reason: "same underlying observation, restated" };
      }
      return { matchedId: null, reason: "no match" };
    };

    const resolutions = await resolveObservedPrincipleIdentities(
      proposed,
      [],
      new Map([
        ["mp-1", "MP#1"],
        ["mp-2", "MP#1"],
      ]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
    if (resolutions[0]?.action === "new_identity") {
      expect(resolutions[0].evidence.map((e) => e.interviewAnswerId).sort()).toEqual(["mp-1", "mp-2"]);
      expect(resolutions[0].supportingCount).toBe(1);
    }
  });

  it("ambiguous match against an existing principle on a related topic => new identity, never a forced merge", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "fear-sell",
        statementText: "You tend to sell winning positions out of fear of losing the gain.",
        evidenceForCounting: [{ interviewAnswerId: "other-answer", stance: "supporting" }],
      },
    ];
    const proposed = [
      principle("You tend to sell a profitable position to redeploy capital into a new opportunity.", [
        { interviewAnswerId: "mp-answer", stance: "supporting", description: "reallocation, not fear" },
      ]),
    ];
    const classifyMatch: ObservedPrincipleMatchFn = async () => ({
      matchedId: null,
      reason: "different trigger — fear/risk-aversion vs. opportunity cost — not the same claim",
    });

    const resolutions = await resolveObservedPrincipleIdentities(
      proposed,
      existing,
      new Map([["mp-answer", "MP#1"]]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
  });

  it("classifier failure (fail-closed matchedId: null) results in a new identity, never a forced merge", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "existing-1",
        statementText: "Some existing observed pattern.",
        evidenceForCounting: [{ interviewAnswerId: "x", stance: "supporting" }],
      },
    ];
    const proposed = [principle("A new proposal.", [{ interviewAnswerId: "y", stance: "supporting", description: "d" }])];
    // Simulates classifyHypothesisMatch's own internal fail-closed
    // contract (dna-identity.ts: any error/malformed response resolves
    // to matchedId: null) — the injected fixture here plays that role.
    const classifyMatch: ObservedPrincipleMatchFn = async () => ({
      matchedId: null,
      reason: "Identity match call failed — failing closed to a new identity.",
    });

    const resolutions = await resolveObservedPrincipleIdentities(
      proposed,
      existing,
      new Map([
        ["x", "X#1"],
        ["y", "Y#1"],
      ]),
      classifyMatch
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.action).toBe("new_identity");
  });

  it("recomputes Evidence Strength from the combined production case keys rather than inheriting the old version's strength", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "old-1",
        statementText: "Old statement.",
        evidenceForCounting: [{ interviewAnswerId: "a", stance: "supporting" }],
      },
    ];
    const proposed = [
      principle("Old statement, extended.", [
        { interviewAnswerId: "b", stance: "supporting", description: "d" },
        { interviewAnswerId: "c", stance: "supporting", description: "d" },
      ]),
    ];
    const classifyMatch: ObservedPrincipleMatchFn = async () => ({ matchedId: "old-1", reason: "match" });

    const resolutions = await resolveObservedPrincipleIdentities(
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

  it("does not mutate its `existing` input", async () => {
    const existing: ExistingObservedPrincipleForMatching[] = [
      {
        id: "old-1",
        statementText: "Old statement.",
        evidenceForCounting: [{ interviewAnswerId: "a", stance: "supporting" }],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));
    const proposed = [principle("New matched statement.", [{ interviewAnswerId: "b", stance: "supporting", description: "d" }])];
    const classifyMatch: ObservedPrincipleMatchFn = async () => ({ matchedId: "old-1", reason: "match" });

    await resolveObservedPrincipleIdentities(
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
});
