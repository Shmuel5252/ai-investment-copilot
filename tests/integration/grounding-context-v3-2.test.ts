// Grounding Semantics V3.2 — on the authorized test DB, through the REAL
// dna.generate / strategy.generateObserved routers, repositories and
// remediation insert paths:
//   (1) the persisted interview question reaches the grounding gate as
//       contextText for an interview answer, and never for a decision
//       statement; it is never written as evidence, never a case, never a
//       count, and it changes no evidence identity;
//   (2) a V3.2 remediation of an identity already checked under an earlier
//       contract appends a version whose provenance names V3.2, turns a
//       partial match into unsupported, and leaves every older row
//       byte-identical; a technical failure writes nothing.
// Mocked: the AI entry points only (inputs captured) — zero real AI calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ai = vi.hoisted(() => ({
  proposeDna: vi.fn(),
  proposeStrategy: vi.fn(),
  ground: vi.fn(),
  classify: vi.fn(),
  groundInputs: [] as unknown[],
}));
vi.mock("@/lib/ai/dna", () => ({ proposeDnaHypotheses: ai.proposeDna }));
vi.mock("@/lib/ai/strategy", () => ({ proposeObservedPrinciples: ai.proposeStrategy, extractDeclaredPrinciples: vi.fn() }));
vi.mock("@/lib/ai/dna-grounding", () => ({ checkEvidenceGrounding: (i: unknown) => { ai.groundInputs.push(structuredClone(i)); return ai.ground(i); } }));
vi.mock("@/lib/ai/dna-identity", () => ({ classifyHypothesisMatch: ai.classify }));

import { dnaRouter } from "@/server/routers/dna";
import { strategyRouter } from "@/server/routers/strategy";
import { insertDecision, insertDecisionSnapshot, insertThesis } from "@/db/repositories/decisions";
import { insertInterviewSession, insertInterviewAnswer, getAllAnswersForInvestor } from "@/db/repositories/interview";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { insertDnaHypothesisWithEvidence, insertDnaHypothesisVersionWithGroundingChecks, insertGroundingChecksForVersion, getLatestDnaHypothesisVersion } from "@/db/repositories/dna";
import { getEffectiveEvidenceForDnaHypothesisVersion, getEvidenceForDnaHypothesis, getEvidenceForStrategyPrinciple, getGroundingChecksForDnaHypothesisVersion } from "@/db/repositories/evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { assessCitations } from "@/lib/evidence/resolve-independence";
import { buildProvenance } from "@/lib/evidence/provenance";
import { buildInvestorStatements, buildStatementContextById } from "@/lib/ai/investor-statements";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import { mkInvestor, mkTxn } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });
const session = (investorId: string) => ({ session: { investorId } }) as never;

const Q_SELL = "With a large gain after a short holding period, what made you decide to sell then rather than hold on for more upside?";
const Q_BUY = "What made this stock stand out enough to become your largest buy?";
const A_SELL = "I did not want to lose the profit; after such a big rise a correction felt likely, and I doubted a stock could keep rising like that.";
const A_BUY = "It was a very large IPO and I felt the company would dominate its field. I am still holding and I have not decided when to sell.";
const A_HOLD = "I did not wait for a target or a signal; as long as it kept rising I stayed with it because I believe in the company.";
const Q_HOLD = "What kept you in the position while it was rising?";
const REASONING = "I believe in the sector and I want to add to the position.";
const CLAIM = "You tend to hold onto positions as long as the stock keeps climbing and you believe in the company, without a predefined exit signal or target.";

let marketContextId: string;
type GroundInput = { hypothesisStatement: string; stance: string; sourceAnswerText: string; sourceKind?: string; contextText?: string };

async function seed(label: string) {
  const investorId = await mkInvestor(db, label);
  const strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  const t1 = await mkTxn(db, investorId, "AAA", "buy", "2026-02-01", "10");
  const t2 = await mkTxn(db, investorId, "BBB", "buy", "2026-04-01", "10");
  const t3 = await mkTxn(db, investorId, "CCC", "buy", "2026-06-01", "10");
  const s = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
  const sell = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: t1, questionText: Q_SELL, answerText: A_SELL });
  const buy = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: t2, questionText: Q_BUY, answerText: A_BUY });
  const hold = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: t3, questionText: Q_HOLD, answerText: A_HOLD });
  const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "DDD", status: "decided" }).returning();
  const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker: "DDD", decisionType: "BUY", decisionDate: new Date("2026-08-01T00:00:00Z") });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", size: "500", userReasoningText: REASONING, risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: "AI text", portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  return { investorId, sell, buy, hold, decisionId: d.id, dsid: `decision:${d.id}:reasoning` };
}
const cite = (statementId: string, stance: "supporting" | "contradicting" = "supporting") => ({ statementId, stance, description: `AI DESCRIPTION of ${statementId}` });
// Scoped to ONE synthetic investor, so other test files writing at the same time cannot move the number.
const evidenceRowsOf = async (investorId: string) =>
  Number(((await db.execute(sql`select count(*)::int as n from evidence e where e.dna_hypothesis_id in (select id from dna_hypotheses where investor_id = ${investorId}) or e.strategy_principle_id in (select id from strategy_principles where investor_id = ${investorId})`))[0] as { n: number }).n);

beforeAll(async () => {
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("question context through the real generate routers", () => {
  it("dna.generate: the persisted question is the answer's contextText; a decision statement has none; nothing about the question is persisted as evidence", async () => {
    const w = await seed("gsv32-dna");
    ai.groundInputs.length = 0;
    ai.proposeDna.mockResolvedValueOnce([{ statement: CLAIM, evidence: [cite(w.hold.id), cite(w.sell.id, "contradicting"), cite(w.dsid)] }]);
    // the gate's verdicts: only the complete match survives (the sale answer is a partial match, the decision text is silent)
    ai.ground.mockImplementation(async (i: GroundInput) => ({ verdict: i.sourceAnswerText === A_HOLD ? "supported" : "unsupported", reason: "injected" }));
    ai.classify.mockImplementation(async () => ({ matchedId: null, reason: "new" }));
    const answersBefore = await db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewSessionId, w.sell.interviewSessionId));
    const evidenceBefore = await evidenceRowsOf(w.investorId);

    const result = await dnaRouter.createCaller(session(w.investorId)).generate();
    expect(result.createdCount).toBe(1);

    const inputs = ai.groundInputs as GroundInput[];
    expect(inputs.map((i) => [i.sourceKind, i.sourceAnswerText, i.stance, i.contextText])).toEqual([
      ["interview_answer", A_HOLD, "supporting", Q_HOLD],
      ["interview_answer", A_SELL, "contradicting", Q_SELL],
      ["decision_statement", REASONING, "supporting", undefined],
    ]);
    expect("contextText" in inputs[2]!).toBe(false);
    // evidence text and context never share a field
    for (const i of inputs) expect(i.sourceAnswerText).not.toContain("what made you");

    const h = result.hypotheses[0]!;
    const rows = await getEvidenceForDnaHypothesis(db, h.hypothesis.id);
    expect(rows).toHaveLength(1); // only the grounded citation became evidence
    expect(rows[0]).toMatchObject({ interviewAnswerId: w.hold.id, decisionId: null, stance: "supporting" });
    expect(await evidenceRowsOf(w.investorId)).toBe(evidenceBefore + 1); // the question created no row
    for (const q of [Q_HOLD, Q_SELL, Q_BUY]) expect(JSON.stringify({ rows, version: h.version })).not.toContain(q);
    expect([h.version.supportingEvidenceCount, h.version.contradictingEvidenceCount, h.version.evidenceStrength]).toEqual([1, 0, "insufficient_evidence"]);
    expect((h.version.independenceBasisJson as { groups: unknown[] }).groups).toHaveLength(1);
    expect((h.version.provenanceJson as { promptContracts: string[] }).promptContracts).toEqual(["dna-propose-v3-2-statements", "evidence-grounding-v3-2-statements", "hypothesis-identity-v1"]);
    // the question lives only where it was written, unchanged
    expect(await db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewSessionId, w.sell.interviewSessionId))).toEqual(answersBefore);
  });

  it("strategy.generateObserved: same propagation and the same boundary", async () => {
    const w = await seed("gsv32-strategy");
    ai.groundInputs.length = 0;
    ai.proposeStrategy.mockResolvedValueOnce([{ statement: "observed claim", evidence: [cite(w.buy.id), cite(w.dsid)] }]);
    ai.ground.mockImplementation(async () => ({ verdict: "supported", reason: "injected" }));
    ai.classify.mockImplementation(async () => ({ matchedId: null, reason: "new" }));
    const result = await strategyRouter.createCaller(session(w.investorId)).generateObserved();
    expect(result.createdCount).toBe(1);
    const inputs = ai.groundInputs as GroundInput[];
    expect(inputs.map((i) => [i.sourceKind, i.contextText])).toEqual([["interview_answer", Q_BUY], ["decision_statement", undefined]]);
    const p = result.principles[0]!;
    const rows = await getEvidenceForStrategyPrinciple(db, p.principle.id);
    expect(rows.map((r) => [r.interviewAnswerId, r.decisionId]).sort()).toEqual([[w.buy.id, null], [null, w.decisionId]].sort());
    expect(JSON.stringify({ rows, version: p.version })).not.toContain(Q_BUY);
    expect(p.version.supportingEvidenceCount).toBe(2); // two statements, two cases; the question is not a third
    expect((p.version.provenanceJson as { promptContracts: string[] }).promptContracts).toEqual(["strategy-observe-v3-2-statements", "evidence-grounding-v3-2-statements", "hypothesis-identity-v1"]);
  });
});

describe("V3.2 remediation of an identity checked under an earlier contract", () => {
  it("re-judges every raw citation with its question as context; the partial match becomes unsupported in an appended version; older rows stay byte-identical; a technical failure writes nothing", async () => {
    const w = await seed("gsv32-remediation");
    const independence = await loadIndependenceResolver(db, w.investorId);
    const cites = [
      { interviewAnswerId: w.hold.id, decisionStatement: null, stance: "supporting" as const, description: "AI DESCRIPTION hold" },
      { interviewAnswerId: w.sell.id, decisionStatement: null, stance: "contradicting" as const, description: "AI DESCRIPTION sell" },
    ];
    const assessed = assessCitations(independence, cites);
    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, w.investorId, { statement: CLAIM, evidence: cites, supportingCount: assessed.supportingCount, contradictingCount: assessed.contradictingCount, evidenceStrength: assessed.evidenceStrength, independenceBasis: assessed.independenceBasis });
    const raw = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const holdRow = raw.find((r) => r.interviewAnswerId === w.hold.id)!;
    const sellRow = raw.find((r) => r.interviewAnswerId === w.sell.id)!;
    // the earlier contract confirmed BOTH citations against v1
    await insertGroundingChecksForVersion(db, v1.id, [{ evidenceId: holdRow.id, verdict: "supported", reason: "earlier contract" }, { evidenceId: sellRow.id, verdict: "supported", reason: "earlier contract" }]);
    const checksV1 = await getGroundingChecksForDnaHypothesisVersion(db, v1.id);
    expect(checksV1).toHaveLength(2);

    // production-shaped inputs: texts and questions from the persisted rows
    const answers = await getAllAnswersForInvestor(db, w.investorId);
    const statements = buildInvestorStatements(answers, await listDecisionStatementsForInvestor(db, w.investorId));
    const textById = new Map(statements.map((s) => [s.id, s.text]));
    const contextById = buildStatementContextById(answers);
    const rawEvidence = [...raw].sort((a, b) => a.id.localeCompare(b.id)).map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance }));
    const already = new Set(checksV1.filter((c) => c.verdict === "supported").map((c) => c.evidenceId));
    const planInput = { currentVersion: { id: v1.id, statementText: v1.statementText }, rawEvidence, answerTextById: textById, independence, alreadyGroundedEvidenceIds: already, contextTextById: contextById };
    const versionRows = () => db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, hypothesis.id));

    // (a) technical failure: nothing is written
    const versionsBefore = await versionRows();
    const failed = await planGroundingRemediation(planInput, async () => ({ verdict: "unsupported", reason: "Grounding check call failed — failing closed.", technicalFailure: true }));
    expect(failed.action).toBe("technical_failure");
    expect("checks" in failed).toBe(false);
    expect(await versionRows()).toEqual(versionsBefore);
    expect(await getGroundingChecksForDnaHypothesisVersion(db, v1.id)).toEqual(checksV1);

    // (b) V3.2 verdicts: the hold answer establishes every component; the sale answer never establishes the belief
    const seen: GroundInput[] = [];
    const gate = async (i: GroundInput) => {
      seen.push(i);
      return i.sourceAnswerText === A_HOLD ? { verdict: "supported" as const, reason: "every component established" } : { verdict: "unsupported" as const, reason: "partial match: belief in the company is not established by the investor's words" };
    };
    const plan = await planGroundingRemediation(planInput, gate);
    expect(seen).toHaveLength(2); // existing check rows never cause a citation to be skipped
    expect(seen.find((s) => s.sourceAnswerText === A_SELL)).toMatchObject({ stance: "contradicting", sourceKind: "interview_answer", contextText: Q_SELL });
    expect(seen.find((s) => s.sourceAnswerText === A_HOLD)).toMatchObject({ stance: "supporting", contextText: Q_HOLD });
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount, plan.version.evidenceStrength]).toEqual([1, 0, "insufficient_evidence"]);

    const evidenceCount = await evidenceRowsOf(w.investorId);
    const provenance = buildProvenance({ generator: "dna.remediateGrounding", model: "claude-sonnet-5", promptContracts: [AI_CONTRACTS.evidenceGrounding], sourceTypes: ["interview_answer"], revalidatedVersionId: v1.id, remediationReason: `${STANCE_SEMANTICS_VERSION}: compound claims and question context`, semanticRule: STANCE_SEMANTICS_VERSION });
    const { version: v2 } = await insertDnaHypothesisVersionWithGroundingChecks(db, hypothesis.id, plan.version, plan.checks, provenance);

    expect(v2.versionNumber).toBe(2);
    expect(v2.createdBy).toBe("system_grounding_revalidation");
    expect(v2.statementText).toBe(v1.statementText);
    expect(v2.provenanceJson).toMatchObject({ generator: "dna.remediateGrounding", model: "claude-sonnet-5", promptContracts: ["evidence-grounding-v3-2-statements"], semanticRule: "grounding-semantics-v3-2", revalidatedVersionId: v1.id });
    // append only: v1, its checks and every raw row are byte-identical; no evidence row was added
    expect(await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq: e }) => e(v.id, v1.id) })).toEqual(v1);
    expect(await getGroundingChecksForDnaHypothesisVersion(db, v1.id)).toEqual(checksV1);
    expect(await getEvidenceForDnaHypothesis(db, hypothesis.id)).toEqual(raw);
    expect(await evidenceRowsOf(w.investorId)).toBe(evidenceCount);
    // the new version's effective evidence is the complete match only; stances were never flipped
    const effective = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v2.id);
    expect(effective.map((e) => [e.id, e.stance])).toEqual([[holdRow.id, "supporting"]]);
    const checksV2 = await getGroundingChecksForDnaHypothesisVersion(db, v2.id);
    expect(checksV2.map((c) => [c.evidenceId, c.verdict]).sort()).toEqual([[holdRow.id, "supported"], [sellRow.id, "unsupported"]].sort());
    expect(JSON.stringify({ v2, checksV2 })).not.toContain(Q_SELL); // the question is in no version and no check row

    // (c) idempotent: the same verdicts on the persisted state plan nothing more
    const latest = (await getLatestDnaHypothesisVersion(db, hypothesis.id))!;
    const again = await planGroundingRemediation({ ...planInput, currentVersion: { id: latest.id, statementText: latest.statementText }, alreadyGroundedEvidenceIds: new Set(checksV2.filter((c) => c.verdict === "supported").map((c) => c.evidenceId)) }, gate);
    expect(again.action).toBe("no_op");
    expect(Object.keys(again).sort()).toEqual(["action", "judgments"]); // OD-R9: no version, no checks — only what the gate judged, for the audit ledger
  });
});
