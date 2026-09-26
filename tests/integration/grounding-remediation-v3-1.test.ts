// Grounding Semantics V3.1 — on the authorized test DB: (1) a technical
// grounding failure during remediation writes NOTHING (no version, no check
// row) and leaves the identity exactly as it was; (2) a normal V3.1
// remediation persists the v3-1 contract and rule version in provenance.
// Deterministic injected gates, zero AI calls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { insertDecision, insertDecisionSnapshot, insertThesis } from "@/db/repositories/decisions";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { insertDnaHypothesisWithEvidence, insertDnaHypothesisVersionWithGroundingChecks, getLatestDnaHypothesisVersion } from "@/db/repositories/dna";
import { getEvidenceForDnaHypothesis, getGroundingChecksForDnaHypothesisVersion } from "@/db/repositories/evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { assessCitations, type EvidenceCitation } from "@/lib/evidence/resolve-independence";
import { buildProvenance } from "@/lib/evidence/provenance";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import { GROUNDING_TOOL_NAME, parseGroundingResponse, type EvidenceGroundingCheckInput, type EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });
const HOLD_TEXT = "I did not wait for a target or a signal; as long as it kept rising I stayed with it because I believe in the company.";
const SELL_TEXT = "The exchange set a target to cross a threshold within a period; the stock kept declining and missed it, so I sold and used the money elsewhere.";
const CLAIM = "You tend to sell a stock when its momentum weakens or when it misses an external target set for it, even at a small loss.";

let investorId: string;
let strategyVersionId: string;
let marketContextId: string;
async function mkDecision(ticker: string, date: string, reasoning: string) {
  const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker, status: "decided" }).returning();
  const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker, decisionType: "PASS", decisionDate: new Date(`${date}T00:00:00Z`) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", size: null, userReasoningText: reasoning, risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: "AI text", portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  return d.id;
}
const ds = (decisionId: string, stance: "supporting" | "contradicting"): EvidenceCitation & { description: string; decisionStatement: { decisionId: string; kind: "reasoning" } } =>
  ({ interviewAnswerId: null, decisionStatement: { decisionId, kind: "reasoning" }, stance, description: `cites ${decisionId}` });
const CALL_12 = { verdict: "contradicting", reason: "a stance word instead of the enum" };

beforeAll(async () => {
  investorId = await mkInvestor(db, "gsv31-remediation");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("technical failure during remediation", () => {
  it("writes nothing: no version, no check row, identity byte-identical; a later clean run still works", async () => {
    const sell = await mkDecision("CAN1", "2026-04-09", SELL_TEXT);
    const hold = await mkDecision("MRVL1", "2026-08-17", HOLD_TEXT);
    const independence = await loadIndependenceResolver(db, investorId);
    const cites = [ds(sell, "supporting"), ds(hold, "contradicting")];
    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, investorId, { statement: CLAIM, evidence: cites, supportingCount: 1, contradictingCount: 1, evidenceStrength: "insufficient_evidence", independenceBasis: assessCitations(independence, cites).independenceBasis });
    const raw = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const textById = new Map((await listDecisionStatementsForInvestor(db, investorId)).map((s) => [s.statementId, s.text]));
    const rawEvidence = raw.map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance }));
    const versionsBefore = await db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, hypothesis.id));
    const checksBefore = await getGroundingChecksForDnaHypothesisVersion(db, v1.id);

    // the model answers the contradicting citation with the call-#12 shape
    const gate = async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
      i.stance === "contradicting" ? parseGroundingResponse({ type: "tool_use", name: GROUNDING_TOOL_NAME, input: CALL_12 }) : { verdict: "supported", reason: "ok" };
    const plan = await planGroundingRemediation({ currentVersion: { id: v1.id, statementText: v1.statementText }, rawEvidence, answerTextById: textById, independence, alreadyGroundedEvidenceIds: null }, gate);
    expect(plan.action).toBe("technical_failure");
    if (plan.action !== "technical_failure") throw new Error("expected technical_failure");
    expect(plan.failures).toEqual([{ evidenceId: raw.find((e) => e.decisionId === hold)!.id, reason: "Grounding check returned a malformed verdict — failing closed." }]);
    // nothing to write: the plan carries no checks and no version, and the caller writes only from checks/version
    expect("checks" in plan).toBe(false);
    expect(await db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, hypothesis.id))).toEqual(versionsBefore);
    expect(await getGroundingChecksForDnaHypothesisVersion(db, v1.id)).toEqual(checksBefore);
    expect((await getLatestDnaHypothesisVersion(db, hypothesis.id))!.id).toBe(v1.id);

    // a later clean run (well-formed semantic verdicts) plans and persists normally, with V3.1 provenance
    const cleanGate = async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> => ({ verdict: i.sourceAnswerText === SELL_TEXT ? "supported" : "unsupported", reason: i.sourceAnswerText === SELL_TEXT ? "trigger and behavior established" : "material precondition not established" });
    const plan2 = await planGroundingRemediation({ currentVersion: { id: v1.id, statementText: v1.statementText }, rawEvidence, answerTextById: textById, independence, alreadyGroundedEvidenceIds: null }, cleanGate);
    expect(plan2.action).toBe("new_version");
    if (plan2.action !== "new_version") throw new Error("expected new_version");
    expect([plan2.version.supportingEvidenceCount, plan2.version.contradictingEvidenceCount]).toEqual([1, 0]);
    const provenance = buildProvenance({ generator: "dna.remediateGrounding", model: null, promptContracts: [AI_CONTRACTS.evidenceGrounding], sourceTypes: ["decision_statement"], revalidatedVersionId: v1.id, remediationReason: `${STANCE_SEMANTICS_VERSION}: material preconditions`, semanticRule: STANCE_SEMANTICS_VERSION });
    const { version: v2 } = await insertDnaHypothesisVersionWithGroundingChecks(db, hypothesis.id, plan2.version, plan2.checks, provenance);
    expect(v2.provenanceJson).toMatchObject({ generator: "dna.remediateGrounding", promptContracts: ["evidence-grounding-v3-1-statements"], semanticRule: "grounding-semantics-v3-1", revalidatedVersionId: v1.id, model: null });
    expect(await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) })).toEqual(v1);
  });
});
