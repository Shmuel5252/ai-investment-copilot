// Strategy Grounding Remediation orchestration — tested with an
// INJECTED, deterministic grounding function, never a real Anthropic
// call. planPrincipleGroundingRemediation() itself — the real production
// loop, filtering, and recomputation — is what's under test; it calls
// straight through to the real countIndependentCases()/
// calculateEvidenceStrength(), never a test-only reimplementation.
import { describe, expect, it } from "vitest";
import {
  planPrincipleGroundingRemediation,
  type PersistedEvidenceForRemediation,
  type StrategyRemediationGroundingFn,
} from "@/lib/strategy/remediate-grounding";
import { resolverFromCaseKeys } from "../helpers/independence";

function currentVersion(statementText: string) {
  return { id: "version-1", statementText, principleType: "observed" as const };
}

describe("planPrincipleGroundingRemediation", () => {
  it("changed evidence + changed tier creates a new_version, statement byte-identical, principleType preserved", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-mp", interviewAnswerId: "answer-mp", stance: "supporting" },
      { id: "ev-mrvl", interviewAnswerId: "answer-mrvl", stance: "supporting" },
      { id: "ev-can", interviewAnswerId: "answer-can", stance: "supporting" },
    ];
    const checkGrounding: StrategyRemediationGroundingFn = async (input) =>
      input.sourceAnswerText === "CAN text"
        ? { verdict: "unsupported", reason: "does not establish the claim" }
        : { verdict: "supported", reason: "matches" };

    const version = currentVersion("Sells a profitable position for a more attractive opportunity.");
    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: version,
        rawEvidence,
        answerTextById: new Map([
          ["answer-mp", "MP text"],
          ["answer-mrvl", "MRVL text"],
          ["answer-can", "CAN text"],
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
    expect(plan.version.statementText).toBe(version.statementText); // byte-identical
    expect(plan.version.principleType).toBe("observed"); // preserved
    expect(plan.version.supportingEvidenceCount).toBe(2);
    expect(plan.checks.find((c) => c.evidenceId === "ev-can")?.verdict).toBe("unsupported");
  });

  it("changed evidence, SAME tier, still creates a new_version (the approved same-tier rule)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-2", interviewAnswerId: "a2", stance: "contradicting" },
    ];
    // Only the contradicting citation gets rejected -- S=1,C=1(insufficient)
    // before, S=1,C=0(still insufficient) after: same tier, different set.
    const checkGrounding: StrategyRemediationGroundingFn = async (input) =>
      input.stance === "contradicting"
        ? { verdict: "unsupported", reason: "not a genuine contradiction" }
        : { verdict: "supported", reason: "matches" };

    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: currentVersion("Some claim."),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "t1"],
          ["a2", "t2"],
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
    expect(plan.version.supportingEvidenceCount).toBe(1);
    expect(plan.version.contradictingEvidenceCount).toBe(0);
    expect(plan.version.evidenceStrength).toBe("insufficient_evidence"); // unchanged tier
  });

  it("unchanged evidence, never checked before => checked_no_change (no version, checks still recorded)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
    ];
    const checkGrounding: StrategyRemediationGroundingFn = async () => ({ verdict: "supported", reason: "matches" });

    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: currentVersion("Some claim."),
        rawEvidence,
        answerTextById: new Map([["a1", "t1"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("checked_no_change");
    if (plan.action !== "checked_no_change") throw new Error("expected checked_no_change");
    expect(plan.checks).toHaveLength(1);
  });

  it("re-running remediation against an already-checked, unchanged state is a true no-op (idempotency, zero writes)", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-2", interviewAnswerId: "a2", stance: "supporting" },
    ];
    const checkGrounding: StrategyRemediationGroundingFn = async (input) =>
      input.sourceAnswerText === "t2" ? { verdict: "unsupported", reason: "still doesn't ground it" } : { verdict: "supported", reason: "matches" };

    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: currentVersion("Some claim."),
        rawEvidence,
        answerTextById: new Map([
          ["a1", "t1"],
          ["a2", "t2"],
        ]),
        independence: resolverFromCaseKeys(new Map([
          ["a1", "X#1"],
          ["a2", "Y#1"],
        ])),
        // Already remediated once: only ev-1 logged supported.
        alreadyGroundedEvidenceIds: new Set(["ev-1"]),
      },
      checkGrounding
    );

    expect(plan).toEqual({ action: "no_op" });
  });

  it("a citation with no linkable InterviewAnswer always gets a complete check row (supported by convention), never silently absent", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-interview", interviewAnswerId: "a1", stance: "supporting" },
      { id: "ev-no-answer", interviewAnswerId: null, stance: "supporting" },
    ];
    const checkGrounding: StrategyRemediationGroundingFn = async () => ({ verdict: "unsupported", reason: "rejected" });

    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: currentVersion("Some claim."),
        rawEvidence,
        answerTextById: new Map([["a1", "t1"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.checks.map((c) => c.evidenceId).sort()).toEqual(["ev-interview", "ev-no-answer"]);
    expect(plan.checks.find((c) => c.evidenceId === "ev-no-answer")?.verdict).toBe("supported");
    expect(plan.version.supportingEvidenceCount).toBe(1); // ev-no-answer alone survives
  });

  it("fails closed when the injected grounding function throws", async () => {
    const rawEvidence: PersistedEvidenceForRemediation[] = [
      { id: "ev-1", interviewAnswerId: "a1", stance: "supporting" },
    ];
    const checkGrounding: StrategyRemediationGroundingFn = async () => {
      throw new Error("network error");
    };

    const plan = await planPrincipleGroundingRemediation(
      {
        currentVersion: currentVersion("Some claim."),
        rawEvidence,
        answerTextById: new Map([["a1", "t1"]]),
        independence: resolverFromCaseKeys(new Map([["a1", "X#1"]])),
        alreadyGroundedEvidenceIds: null,
      },
      checkGrounding
    );

    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.version.supportingEvidenceCount).toBe(0);
    expect(plan.version.evidenceStrength).toBe("insufficient_evidence");
  });
});
