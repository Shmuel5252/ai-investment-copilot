// DNA Grounding Remediation orchestration — tested with an INJECTED,
// deterministic grounding function, never a real Anthropic call (same
// convention as ground-evidence.test.ts / resolve-hypothesis-identity.test.ts).
// planGroundingRemediation() itself — the real production loop, filtering,
// and recomputation — is what's under test; it calls straight through to
// the real countIndependentCases()/calculateEvidenceStrength(), never a
// test-only reimplementation of either.
//
// Several fixtures below intentionally mirror the REAL numbers found by
// the live, human-approved DNA Evidence Grounding Audit (Autonomous Unit
// 1) for two real, still-unremediated hypotheses — 699cdb50 (tier change)
// and e1239589 (same-tier evidence change) — so these tests double as a
// direct regression check against that specific, already-diagnosed real
// data, not just synthetic scenarios.
import { describe, expect, it } from "vitest";
import {
  planGroundingRemediation,
  type PersistedEvidenceForRemediation,
  type RemediationGroundingFn,
} from "@/lib/dna/remediate-grounding";
import { resolverFromCaseKeys } from "../helpers/independence";

function currentVersion(statementText: string) {
  return { id: "version-1", statementText };
}

describe("planGroundingRemediation", () => {
  it("699cdb50-shaped case: a rejected supporting citation changes both the evidence set AND the strength tier (moderate -> insufficient_evidence)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-mp", interviewAnswerId: "answer-mp", stance: "supporting" },
      { id: "ev-mrvl", interviewAnswerId: "answer-mrvl", stance: "supporting" },
      { id: "ev-can", interviewAnswerId: "answer-can", stance: "supporting" },
    ];
    const checkGrounding: RemediationGroundingFn = async (input) =>
      input.sourceAnswerText === "CAN answer text"
        ? { verdict: "unsupported", reason: "describes a losing position that missed an external target, not a profitable exit for a new opportunity" }
        : { verdict: "supported", reason: "matches the claim" };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("sells a profitable position when a new opportunity appears"),
        rawEvidence,
        answerTextById: new Map([
          ["answer-mp", "MP answer text"],
          ["answer-mrvl", "MRVL answer text"],
          ["answer-can", "CAN answer text"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["answer-mp", "MP#1"],
          ["answer-mrvl", "MRVL#3"],
          ["answer-can", "CAN#1"],
        ])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.version.supportingEvidenceCount).toBe(2);
    expect(plan.version.contradictingEvidenceCount).toBe(0);
    expect(plan.version.evidenceStrength).toBe("insufficient_evidence"); // was moderate at 3
    expect(plan.version.statementText).toBe("sells a profitable position when a new opportunity appears");
    expect(plan.checks).toHaveLength(3);
    expect(plan.checks.find((c) => c.evidenceId === "ev-can")?.verdict).toBe("unsupported");
  });

  it("e1239589-shaped case: two rejected citations change the evidence set (2 independent cases -> 1) while the strength tier stays insufficient_evidence", async () => {
    // Real shape: 4 raw citations, two of them (0159648f, 2d13f878) about
    // the SAME two case keys as the two survivors are about DIFFERENT case
    // keys from each other post-rejection — survivors both resolve to
    // MP#1, so they collapse to ONE independent case, not two.
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "answer-1", stance: "supporting" }, // survives, MP#1
      { id: "ev-2", interviewAnswerId: "answer-2", stance: "supporting" }, // survives, MP#1
      { id: "ev-3", interviewAnswerId: "answer-3", stance: "supporting" }, // rejected, MP#1
      { id: "ev-4", interviewAnswerId: "answer-4", stance: "supporting" }, // rejected, MRVL#3
    ];
    const checkGrounding: RemediationGroundingFn = async (input) =>
      input.sourceAnswerText === "full exit 1" || input.sourceAnswerText === "full exit 2"
        ? { verdict: "unsupported", reason: "describes a full exit, not a gradual/partial sale" }
        : { verdict: "supported", reason: "matches the claim" };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("realizes profits gradually to free capital for new opportunities"),
        rawEvidence,
        answerTextById: new Map([
          ["answer-1", "gradual sale 1"],
          ["answer-2", "gradual sale 2"],
          ["answer-3", "full exit 1"],
          ["answer-4", "full exit 2"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["answer-1", "MP#1"],
          ["answer-2", "MP#1"],
          ["answer-3", "MP#1"],
          ["answer-4", "MRVL#3"],
        ])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.version.supportingEvidenceCount).toBe(1); // MP#1 only, deduped
    expect(plan.version.contradictingEvidenceCount).toBe(0);
    expect(plan.version.evidenceStrength).toBe("insufficient_evidence"); // was ALSO insufficient_evidence at 2 -- same tier
  });

  it("rejects a contradicting citation without reversing stance semantics into supportingCount", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-support", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-contradict", interviewAnswerId: "a2", stance: "contradicting" },
    ];
    const checkGrounding: RemediationGroundingFn = async (input) =>
      input.stance === "contradicting"
        ? { verdict: "unsupported", reason: "the answer is actually consistent with the hypothesis, not against it" }
        : { verdict: "supported", reason: "matches the claim" };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "supporting text"],
          ["a2", "contradicting text"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["a1", "X#1"],
          ["a2", "Y#1"],
        ])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    // The rejected contradicting citation must simply disappear from the
    // count, never flip into supportingCount.
    expect(plan.version.supportingEvidenceCount).toBe(1);
    expect(plan.version.contradictingEvidenceCount).toBe(0);
  });

  it("accepts a genuinely-grounded contradicting citation and keeps it counted as contradicting (not dropped, not flipped)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-support", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-contradict", interviewAnswerId: "a2", stance: "contradicting" },
    ];
    // Both accepted -> baseline (all raw evidence, since never checked
    // before) already matches the fresh result -> no material change.
    const checkGrounding: RemediationGroundingFn = async () => ({ verdict: "supported", reason: "matches" });

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "supporting text"],
          ["a2", "contradicting text"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["a1", "X#1"],
          ["a2", "Y#1"],
        ])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    // Unchanged evidence, never checked before -> "checked_no_change", not
    // a new version -- but the checks (including the contradicting one)
    // are still worth recording.
    expect(plan.action).toBe("checked_no_change");
    if (plan.action !== "checked_no_change") throw new Error("expected checked_no_change");
    expect(plan.checks).toHaveLength(2);
    expect(plan.checks.find((c) => c.evidenceId === "ev-contradict")?.verdict).toBe("supported");
  });

  it("unchanged evidence, never checked before, is a no-new-version outcome (checked_no_change) even though checks are recorded", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
    ];
    const checkGrounding: RemediationGroundingFn = async () => ({ verdict: "supported", reason: "matches" });

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([["a1", "text"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("checked_no_change");
  });

  it("second identical remediation against an already-checked, unchanged state is a true no-op (zero writes, not even repeat check rows)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-2", interviewAnswerId: "a2", stance: "supporting" },
    ];
    // Same deterministic verdicts as "last time": ev-1 supported, ev-2 unsupported.
    const checkGrounding: RemediationGroundingFn = async (input) =>
      input.sourceAnswerText === "text-2"
        ? { verdict: "unsupported", reason: "still doesn't ground it" }
        : { verdict: "supported", reason: "matches" };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "text-1"],
          ["a2", "text-2"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["a1", "X#1"],
          ["a2", "Y#1"],
        ])),
        // This version was already remediated once before: only ev-1 is
        // logged "supported" against it.
        alreadyGroundedEvidenceIds: new Set(["ev-1"]),
      },
      checkGrounding
    );

    expect(plan).toEqual({ action: "no_op" });
  });

  it("a real verdict change on rerun against an already-checked version is still detected as a new_version, not swallowed by idempotency", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-2", interviewAnswerId: "a2", stance: "supporting" },
    ];
    // This time ev-2 now comes back supported too (a real grounding
    // mechanism could change between runs) -- must not be silently
    // treated as "no new information" just because SOME prior check rows exist.
    const checkGrounding: RemediationGroundingFn = async () => ({ verdict: "supported", reason: "matches now" });

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "text-1"],
          ["a2", "text-2"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["a1", "X#1"],
          ["a2", "Y#1"],
        ])),
        alreadyGroundedEvidenceIds: new Set(["ev-1"]),
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.version.supportingEvidenceCount).toBe(2);
  });

  it("evidence with no linkable interviewAnswerId (e.g. LearningInsight-sourced) is never sent to grounding and always counts", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-learning", interviewAnswerId: null, stance: "supporting" },
    ];
    let callCount = 0;
    const checkGrounding: RemediationGroundingFn = async () => {
      callCount++;
      return { verdict: "unsupported", reason: "should never be called" };
    };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map(),
        independence: resolverFromCaseKeys(new Map()),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(callCount).toBe(0);
    expect(plan.action).toBe("checked_no_change");
    // Independent-review hardening: this citation MUST still get its own
    // check row (verdict "supported" by convention) even though it was
    // never sent to grounding. Without this, a version persisted from
    // this plan would have grounding-check rows for every OTHER citation
    // but none for this one -- selectEffectiveEvidence's all-or-nothing
    // rule would then silently treat it as NOT effective, contradicting
    // this same plan's own supportingEvidenceCount (which correctly
    // counts it). See effective-evidence.ts's "All-or-nothing invariant" comment.
    if (plan.action !== "checked_no_change") throw new Error("expected checked_no_change");
    expect(plan.checks).toEqual([
      { evidenceId: "ev-learning", verdict: "supported", reason: expect.stringContaining("Not subject to Evidence Grounding") },
    ]);
  });

  it("a mix of grounded and non-grounded (null interviewAnswerId) citations both end up as complete check rows -- no citation is silently left unchecked when a new version IS created", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-interview", interviewAnswerId: "a1", stance: "supporting" }, // will be rejected
      { id: "ev-learning", interviewAnswerId: null, stance: "supporting" }, // no linkable answer at all
    ];
    const checkGrounding: RemediationGroundingFn = async () => ({ verdict: "unsupported", reason: "does not ground it" });

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([["a1", "text"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    // A check row exists for BOTH raw evidence rows -- never just the
    // ones that happened to go through the AI. This is exactly the
    // completeness getEffectiveEvidenceForDnaHypothesisVersion's
    // all-or-nothing contract depends on.
    expect(plan.checks.map((c) => c.evidenceId).sort()).toEqual(["ev-interview", "ev-learning"]);
    expect(plan.checks.find((c) => c.evidenceId === "ev-interview")?.verdict).toBe("unsupported");
    expect(plan.checks.find((c) => c.evidenceId === "ev-learning")?.verdict).toBe("supported");
    // The surviving (non-grounded) citation alone -> 1 independent case.
    expect(plan.version.supportingEvidenceCount).toBe(1);
  });

  it("fails closed when the injected grounding function throws", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
    ];
    const checkGrounding: RemediationGroundingFn = async () => {
      throw new Error("network error");
    };

    const plan = await planGroundingRemediation(
      {
        currentVersion: currentVersion("some claim"),
        rawEvidence,
        answerTextById: new Map([["a1", "text"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    // Baseline was "everything counts" (never checked); the thrown call
    // fails closed to unsupported, which IS a material change from the
    // legacy baseline -> a new version excluding it.
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.version.supportingEvidenceCount).toBe(0);
    expect(plan.version.evidenceStrength).toBe("insufficient_evidence");
  });
});
