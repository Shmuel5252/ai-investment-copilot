// Grounding Semantics V3 — sourceKind propagation in BOTH remediation
// planners. A decision statement must reach the grounding gate as a decision
// statement and an interview answer as an interview answer; relabelling a
// decision statement as an answer would apply the wrong framing (a full
// answer to a question vs a partial decision-time record). These tests fail
// if either planner drops or mislabels sourceKind. Injected deterministic
// gate, no model.
import { describe, expect, it } from "vitest";
import type { EvidenceGroundingCheckInput } from "@/lib/ai/dna-grounding";
import { planGroundingRemediation, type PersistedEvidenceForRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { contextFromTrades } from "../helpers/independence";

const resolver = createIndependenceResolver({
  ...contextFromTrades([], [{ id: "ans-1", txn: null, text: "answer text" }]),
  decisions: [{ id: "dec-1", caseResolution: { kind: "own" } }],
});
const rawEvidence: PersistedEvidenceForRemediation[] = [
  { id: "ev-answer", interviewAnswerId: "ans-1", stance: "supporting" },
  { id: "ev-decision", interviewAnswerId: null, decisionStatement: { decisionId: "dec-1", kind: "risks" }, stance: "contradicting" },
];
const textById = new Map([
  ["ans-1", "answer text"],
  ["decision:dec-1:risks", "decision risks text"],
]);
const capturing = (verdictFor: (input: EvidenceGroundingCheckInput) => "supported" | "unsupported") => {
  const log: EvidenceGroundingCheckInput[] = [];
  const gate = async (input: EvidenceGroundingCheckInput) => {
    log.push(input);
    return { verdict: verdictFor(input), reason: "injected" };
  };
  return { log, gate };
};
const expectKinds = (log: EvidenceGroundingCheckInput[]) => {
  expect(log).toHaveLength(2);
  expect(log.map((l) => [l.sourceKind, l.sourceAnswerText, l.stance])).toEqual([
    ["interview_answer", "answer text", "supporting"],
    ["decision_statement", "decision risks text", "contradicting"],
  ]);
  expect(log.every((l) => l.sourceKind !== undefined)).toBe(true);
};

describe("DNA remediation planner", () => {
  it("passes the correct sourceKind for an answer and for a decision statement", async () => {
    const { log, gate } = capturing(() => "supported");
    const plan = await planGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim" }, rawEvidence, answerTextById: textById, independence: resolver, alreadyGroundedEvidenceIds: null }, gate);
    expect(plan.action).toBe("checked_no_change");
    expectKinds(log);
  });

  it("an unsupported decision-statement contradiction leaves S from the answer and C=0 in the new version", async () => {
    const { log, gate } = capturing((i) => (i.sourceKind === "decision_statement" ? "unsupported" : "supported"));
    const plan = await planGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim" }, rawEvidence, answerTextById: textById, independence: resolver, alreadyGroundedEvidenceIds: null }, gate);
    expectKinds(log);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([1, 0]);
    expect(plan.checks.find((c) => c.evidenceId === "ev-decision")?.verdict).toBe("unsupported");
  });
});

describe("Strategy remediation planner", () => {
  it("passes the correct sourceKind for an answer and for a decision statement", async () => {
    const { log, gate } = capturing(() => "supported");
    const plan = await planPrincipleGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim", principleType: "observed" }, rawEvidence, answerTextById: textById, independence: resolver, alreadyGroundedEvidenceIds: null }, gate);
    expect(plan.action).toBe("checked_no_change");
    expectKinds(log);
  });

  it("an unsupported decision-statement contradiction leaves S from the answer and C=0 in the new version", async () => {
    const { log, gate } = capturing((i) => (i.sourceKind === "decision_statement" ? "unsupported" : "supported"));
    const plan = await planPrincipleGroundingRemediation({ currentVersion: { id: "v1", statementText: "claim", principleType: "observed" }, rawEvidence, answerTextById: textById, independence: resolver, alreadyGroundedEvidenceIds: null }, gate);
    expectKinds(log);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([1, 0]);
    expect(plan.version.principleType).toBe("observed");
  });
});
