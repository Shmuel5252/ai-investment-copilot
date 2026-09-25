// Grounding Semantics V3 — append-only grounding remediation, end to end on
// the authorized test database (tests/support): the exact shape the real
// c478eba3 case will take when a supervised v3 remediation runs. A
// deterministic injected gate stands in for the model (zero AI calls); the
// real planners, repositories, independence loader and threshold table run.
//
// Proves, for DNA and for observed Strategy: the original version stays
// byte-identical; the original evidence rows stay; a new effective version is
// appended; the unsupported raw citation stops being effective; S/C are
// recalculated from survivors only; no new case is invented; provenance is
// persisted; the correct sourceKind reaches the gate; a second identical
// remediation is a no-op; failure is atomic; confidence changes only because
// the effective evidence changed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { insertDecision, insertDecisionSnapshot, insertThesis } from "@/db/repositories/decisions";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { insertDnaHypothesisWithEvidence, insertDnaHypothesisVersionWithGroundingChecks, getLatestDnaHypothesisVersion } from "@/db/repositories/dna";
import { insertObservedPrincipleWithEvidence, insertObservedPrincipleVersionWithGroundingChecks, getLatestStrategyPrincipleVersion } from "@/db/repositories/strategy";
import {
  getEvidenceForDnaHypothesis,
  getEffectiveEvidenceForDnaHypothesisVersion,
  getGroundingChecksForDnaHypothesisVersion,
  getEvidenceForStrategyPrinciple,
  getEffectiveEvidenceForStrategyPrincipleVersion,
  getGroundingChecksForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { assessCitations, type EvidenceCitation } from "@/lib/evidence/resolve-independence";
import { calculateEvidenceStrength } from "@/lib/dna/evidence-strength";
import { buildProvenance } from "@/lib/evidence/provenance";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

const SNDK_TEXT = "I believe in the story but not at this price; I will wait for a better risk/reward entry.";
const AVGO_TEXT = "I believe in the sector and want to add to my position.";
const CLAIM = "You tend to weigh the current price and risk/reward before entering, even when you believe in the thesis.";

let investorId: string;
let strategyVersionId: string;
let marketContextId: string;

async function mkDecision(ticker: string, type: "BUY" | "PASS", date: string, reasoning: string) {
  const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker, status: "decided" }).returning();
  const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker, decisionType: type, decisionDate: new Date(`${date}T00:00:00Z`) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, {
    decisionId: d.id, priceAtDecision: "100", size: type === "PASS" ? null : "500",
    userReasoningText: reasoning, risksConsideredText: null, exitConditionsText: null,
    aiRealtimeAssessmentText: "AI text — never evidence",
    portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: th.id,
    investmentCaseSnapshotJson: {},
  }, []);
  return d.id;
}
const ds = (decisionId: string, stance: "supporting" | "contradicting"): EvidenceCitation & { description: string; decisionStatement: { decisionId: string; kind: "reasoning" } } =>
  ({ interviewAnswerId: null, decisionStatement: { decisionId, kind: "reasoning" }, stance, description: `cites ${decisionId}` });
/** Order-independent row comparison (the raw read orders by created_at, and rows inserted in one statement share it). */
const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The v3 verdict for these fixtures: the SNDK-shaped text supports; the AVGO-shaped text (silent about price) grounds nothing. */
function v3Gate(log: EvidenceGroundingCheckInput[]) {
  return async (input: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> => {
    log.push(input);
    if (input.sourceAnswerText === SNDK_TEXT && input.stance === "supporting") return { verdict: "supported", reason: "affirmative: price weighed, entry deferred" };
    return { verdict: "unsupported", reason: "absence of mention is not evidence of absence" };
  };
}
const remediationProvenance = (generator: "dna.remediateGrounding" | "strategy.remediateGrounding", revalidatedVersionId: string) =>
  buildProvenance({
    generator, model: null, promptContracts: [AI_CONTRACTS.evidenceGrounding], sourceTypes: ["decision_statement"],
    revalidatedVersionId, remediationReason: `${STANCE_SEMANTICS_VERSION}: contradiction requires affirmative evidence (test, deterministic gate)`, semanticRule: STANCE_SEMANTICS_VERSION,
  });

beforeAll(async () => {
  investorId = await mkInvestor(db, "gsv3-remediation");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("DNA: the c478eba3 shape", () => {
  it("appends v2 with the silence-based contradiction no longer effective; v1 and every raw row stay byte-identical; provenance persisted; idempotent; atomic", async () => {
    const sndk = await mkDecision("SNDK1", "PASS", "2026-08-20", SNDK_TEXT);
    const avgo = await mkDecision("AVGO1", "BUY", "2026-09-08", AVGO_TEXT);
    const independence = await loadIndependenceResolver(db, investorId);
    const cites = [ds(sndk, "supporting"), ds(avgo, "contradicting")];
    const assessed = assessCitations(independence, cites);
    expect([assessed.supportingCount, assessed.contradictingCount, assessed.evidenceStrength]).toEqual([1, 1, "insufficient_evidence"]);
    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: CLAIM, evidence: cites, supportingCount: 1, contradictingCount: 1, evidenceStrength: "insufficient_evidence", independenceBasis: assessed.independenceBasis,
    });
    const rawBefore = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    expect(rawBefore).toHaveLength(2);
    const avgoRow = rawBefore.find((e) => e.decisionId === avgo)!;
    const sndkRow = rawBefore.find((e) => e.decisionId === sndk)!;

    // plan under the v3 gate, real planner, real loader
    const log: EvidenceGroundingCheckInput[] = [];
    const textById = new Map((await listDecisionStatementsForInvestor(db, investorId)).map((s) => [s.statementId, s.text]));
    const planInput = () => ({
      currentVersion: { id: v1.id, statementText: v1.statementText },
      rawEvidence: rawBefore.map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance })),
      answerTextById: textById,
      independence,
    });
    const plan = await planGroundingRemediation({ ...planInput(), alreadyGroundedEvidenceIds: null }, v3Gate(log));
    expect(log.map((l) => `${l.sourceKind}:${l.stance}`).sort()).toEqual(["decision_statement:contradicting", "decision_statement:supporting"]);
    expect(log.every((l) => l.hypothesisStatement === CLAIM)).toBe(true);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount, plan.version.evidenceStrength]).toEqual([1, 0, "insufficient_evidence"]);
    expect(plan.version.evidenceStrength).toBe(calculateEvidenceStrength(1, 0)); // confidence only from effective S/C
    expect(plan.version.independenceBasis.groups).toHaveLength(1); // no new case invented
    expect(plan.version.statementText).toBe(v1.statementText);
    expect(plan.checks.map((c) => [c.evidenceId, c.verdict]).sort()).toEqual([[avgoRow.id, "unsupported"], [sndkRow.id, "supported"]].sort());

    // persist with provenance
    const provenance = remediationProvenance("dna.remediateGrounding", v1.id);
    const { version: v2 } = await insertDnaHypothesisVersionWithGroundingChecks(db, hypothesis.id, plan.version, plan.checks, provenance);
    expect(v2.versionNumber).toBe(2);
    expect(v2.createdBy).toBe("system_grounding_revalidation");
    expect(v2.provenanceJson).toEqual(provenance);
    expect(v2.provenanceJson).toMatchObject({ generator: "dna.remediateGrounding", model: null, promptContracts: ["evidence-grounding-v3-statements"], revalidatedVersionId: v1.id, semanticRule: "grounding-semantics-v3", independencePolicy: "independence-policy-v2" });
    expect(v2.changeReason).toContain(avgoRow.id);

    // v1 byte-identical, raw rows byte-identical
    expect(await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) })).toEqual(v1);
    const rawAfter = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    expect(byId(rawAfter)).toEqual(byId(rawBefore));
    // effective: v2 excludes the AVGO row, v1 (unchecked) still counts both
    expect((await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v2.id)).map((e) => e.id)).toEqual([sndkRow.id]);
    expect((await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v1.id)).map((e) => e.id).sort()).toEqual([avgoRow.id, sndkRow.id].sort());
    const checks = await getGroundingChecksForDnaHypothesisVersion(db, v2.id);
    expect(checks.map((c) => [c.evidenceId, c.verdict]).sort()).toEqual([[avgoRow.id, "unsupported"], [sndkRow.id, "supported"]].sort());

    // idempotent: the same gate against the already-checked v2 state writes nothing
    const again = await planGroundingRemediation({ ...planInput(), currentVersion: { id: v2.id, statementText: v2.statementText }, alreadyGroundedEvidenceIds: new Set(checks.filter((c) => c.verdict === "supported").map((c) => c.evidenceId)) }, v3Gate([]));
    expect(again).toEqual({ action: "no_op" });
    expect((await getLatestDnaHypothesisVersion(db, hypothesis.id))!.id).toBe(v2.id);

    // atomic: a check row for another identity's evidence rolls the whole version back
    const { hypothesis: other } = await insertDnaHypothesisWithEvidence(db, investorId, { statement: "other", evidence: [ds(sndk, "supporting")], supportingCount: 1, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: assessCitations(independence, [ds(sndk, "supporting")]).independenceBasis });
    const foreign = (await getEvidenceForDnaHypothesis(db, other.id))[0]!;
    await expect(insertDnaHypothesisVersionWithGroundingChecks(db, hypothesis.id, plan.version, [...plan.checks, { evidenceId: foreign.id, verdict: "supported", reason: "x" }], provenance)).rejects.toThrow(/do not all belong/);
    expect((await db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, hypothesis.id))).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });

  it("confidence rises only because invalid contradictions stop counting: S=3,C=3 (weak) -> S=3,C=1 (moderate), S unchanged, no new case", async () => {
    const supporters = await Promise.all(["S1", "S2", "S3"].map((t, i) => mkDecision(t, "PASS", `2026-07-0${i + 1}`, SNDK_TEXT)));
    const silent = await Promise.all(["N1", "N2"].map((t, i) => mkDecision(t, "BUY", `2026-07-1${i + 1}`, AVGO_TEXT)));
    const affirmative = await mkDecision("N3", "BUY", "2026-07-20", "Price did not matter to me; I bought regardless of valuation.");
    const independence = await loadIndependenceResolver(db, investorId);
    const cites = [...supporters.map((d) => ds(d, "supporting")), ...silent.map((d) => ds(d, "contradicting")), ds(affirmative, "contradicting")];
    const assessed = assessCitations(independence, cites);
    expect([assessed.supportingCount, assessed.contradictingCount, assessed.evidenceStrength]).toEqual([3, 3, "weak"]);
    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, investorId, { statement: CLAIM, evidence: cites, supportingCount: 3, contradictingCount: 3, evidenceStrength: "weak", independenceBasis: assessed.independenceBasis });
    const raw = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const textById = new Map((await listDecisionStatementsForInvestor(db, investorId)).map((s) => [s.statementId, s.text]));
    const gate = async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
      i.sourceAnswerText === AVGO_TEXT ? { verdict: "unsupported", reason: "silence" } : { verdict: "supported", reason: "affirmative" };
    const plan = await planGroundingRemediation({ currentVersion: { id: v1.id, statementText: v1.statementText }, rawEvidence: raw.map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance })), answerTextById: textById, independence, alreadyGroundedEvidenceIds: null }, gate);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount, plan.version.evidenceStrength]).toEqual([3, 1, "moderate"]);
    expect(plan.version.independenceBasis.groups).toHaveLength(4); // 3 supporting cases + 1 affirmative contradiction; nothing invented
    const { version: v2 } = await insertDnaHypothesisVersionWithGroundingChecks(db, hypothesis.id, plan.version, plan.checks, remediationProvenance("dna.remediateGrounding", v1.id));
    expect(v2.evidenceStrength).toBe("moderate");
    expect((await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v2.id))).toHaveLength(4);
    expect(byId(await getEvidenceForDnaHypothesis(db, hypothesis.id))).toEqual(byId(raw));
  });
});

describe("Strategy: the observed-principle mirror", () => {
  it("appends v2 with provenance, principleType preserved, rationale names decision records; v1 and raw rows untouched; idempotent; atomic", async () => {
    const sndk = await mkDecision("SNDK2", "PASS", "2026-08-21", SNDK_TEXT);
    const avgo = await mkDecision("AVGO2", "BUY", "2026-09-09", AVGO_TEXT);
    const independence = await loadIndependenceResolver(db, investorId);
    const cites = [ds(sndk, "supporting"), ds(avgo, "contradicting")];
    const assessed = assessCitations(independence, cites);
    const { principle, version: v1 } = await insertObservedPrincipleWithEvidence(db, investorId, { statement: CLAIM, evidence: cites, supportingCount: 1, contradictingCount: 1, evidenceStrength: "insufficient_evidence", independenceBasis: assessed.independenceBasis });
    const rawBefore = await getEvidenceForStrategyPrinciple(db, principle.id);
    const avgoRow = rawBefore.find((e) => e.decisionId === avgo)!;
    const sndkRow = rawBefore.find((e) => e.decisionId === sndk)!;
    const log: EvidenceGroundingCheckInput[] = [];
    const textById = new Map((await listDecisionStatementsForInvestor(db, investorId)).map((s) => [s.statementId, s.text]));
    const rawEvidence = rawBefore.map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance }));
    const plan = await planPrincipleGroundingRemediation({ currentVersion: { id: v1.id, statementText: v1.statementText, principleType: "observed" }, rawEvidence, answerTextById: textById, independence, alreadyGroundedEvidenceIds: null }, v3Gate(log));
    expect(log.every((l) => l.sourceKind === "decision_statement")).toBe(true);
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount, plan.version.evidenceStrength, plan.version.principleType]).toEqual([1, 0, "insufficient_evidence", "observed"]);
    expect(plan.version.independenceBasis.groups).toHaveLength(1);

    const provenance = remediationProvenance("strategy.remediateGrounding", v1.id);
    const { version: v2 } = await insertObservedPrincipleVersionWithGroundingChecks(db, principle.id, plan.version, plan.checks, provenance);
    expect(v2.versionNumber).toBe(2);
    expect(v2.createdBy).toBe("system_grounding_revalidation");
    expect(v2.principleType).toBe("observed");
    expect(v2.rationaleText).toContain("decision records");
    expect(v2.provenanceJson).toEqual(provenance);
    expect(await db.query.strategyPrincipleVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) })).toEqual(v1);
    expect(byId(await getEvidenceForStrategyPrinciple(db, principle.id))).toEqual(byId(rawBefore));
    expect((await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v2.id)).map((e) => e.id)).toEqual([sndkRow.id]);
    expect((await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v1.id)).map((e) => e.id).sort()).toEqual([avgoRow.id, sndkRow.id].sort());
    const checks = await getGroundingChecksForStrategyPrincipleVersion(db, v2.id);
    const again = await planPrincipleGroundingRemediation({ currentVersion: { id: v2.id, statementText: v2.statementText, principleType: "observed" }, rawEvidence, answerTextById: textById, independence, alreadyGroundedEvidenceIds: new Set(checks.filter((c) => c.verdict === "supported").map((c) => c.evidenceId)) }, v3Gate([]));
    expect(again).toEqual({ action: "no_op" });
    expect((await getLatestStrategyPrincipleVersion(db, principle.id))!.id).toBe(v2.id);

    const { principle: other } = await insertObservedPrincipleWithEvidence(db, investorId, { statement: "other", evidence: [ds(sndk, "supporting")], supportingCount: 1, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: assessCitations(independence, [ds(sndk, "supporting")]).independenceBasis });
    const foreign = (await getEvidenceForStrategyPrinciple(db, other.id))[0]!;
    await expect(insertObservedPrincipleVersionWithGroundingChecks(db, principle.id, plan.version, [...plan.checks, { evidenceId: foreign.id, verdict: "supported", reason: "x" }], provenance)).rejects.toThrow(/do not all belong/);
    expect((await db.select().from(schema.strategyPrincipleVersions).where(eq(schema.strategyPrincipleVersions.strategyPrincipleId, principle.id))).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });

  it("without provenance the remediation insert still works exactly as before (NULL provenance)", async () => {
    const sndk = await mkDecision("SNDK3", "PASS", "2026-08-22", SNDK_TEXT);
    const independence = await loadIndependenceResolver(db, investorId);
    const cites = [ds(sndk, "supporting")];
    const { principle, version: v1 } = await insertObservedPrincipleWithEvidence(db, investorId, { statement: CLAIM, evidence: cites, supportingCount: 1, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: assessCitations(independence, cites).independenceBasis });
    const raw = await getEvidenceForStrategyPrinciple(db, principle.id);
    const { version: v2 } = await insertObservedPrincipleVersionWithGroundingChecks(db, principle.id, { statementText: v1.statementText, principleType: "observed", evidenceStrength: "insufficient_evidence", supportingEvidenceCount: 0, contradictingEvidenceCount: 0, independenceBasis: assessCitations(independence, []).independenceBasis, changeReason: "test" }, [{ evidenceId: raw[0]!.id, verdict: "unsupported", reason: "test" }]);
    expect(v2.provenanceJson).toBeNull();
    expect(v2.versionNumber).toBe(2);
  });
});
