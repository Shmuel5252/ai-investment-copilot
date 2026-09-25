// Evidence Reach V1 — the REAL dna.generate / strategy.generateObserved /
// learning.generate / learning.agree routers, repositories and Postgres on
// the authorized test database only (tests/support): migration 0017's
// shape, decision-time statements as evidence (OD-1), OD-2 case
// resolution from persisted execution facts, the OD-3 Learning carry,
// learning.generate dedupe, provenance, the AI self-reinforcement attack,
// cross-investor isolation, concurrency/idempotency, and the read-only
// reach + next-action views. Mocked: the AI entry points only (inputs
// captured) — zero real AI calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ai = vi.hoisted(() => ({
  proposeDna: vi.fn(),
  proposeStrategy: vi.fn(),
  ground: vi.fn(),
  classify: vi.fn(),
  learning: vi.fn(),
  dnaInputs: [] as unknown[],
  strategyInputs: [] as unknown[],
  groundInputs: [] as unknown[],
}));
vi.mock("@/lib/ai/dna", () => ({ proposeDnaHypotheses: (s: unknown) => { ai.dnaInputs.push(structuredClone(s)); return ai.proposeDna(s); } }));
vi.mock("@/lib/ai/strategy", () => ({ proposeObservedPrinciples: (s: unknown) => { ai.strategyInputs.push(structuredClone(s)); return ai.proposeStrategy(s); }, extractDeclaredPrinciples: vi.fn() }));
vi.mock("@/lib/ai/dna-grounding", () => ({ checkEvidenceGrounding: (i: unknown) => { ai.groundInputs.push(structuredClone(i)); return ai.ground(i); } }));
vi.mock("@/lib/ai/dna-identity", () => ({ classifyHypothesisMatch: ai.classify }));
vi.mock("@/lib/ai/learning", () => ({ proposeLearningInsight: ai.learning }));

import { dnaRouter } from "@/server/routers/dna";
import { strategyRouter } from "@/server/routers/strategy";
import { learningRouter } from "@/server/routers/learning";
import { evidenceRouter } from "@/server/routers/evidence";
import { insertDecision, insertDecisionSnapshot, insertThesis } from "@/db/repositories/decisions";
import { insertDecisionExecutionFact } from "@/db/repositories/execution-facts";
import { learningEvidenceFingerprint } from "@/lib/learning/evidence-fingerprint";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { getEvidenceForDnaHypothesis, getEvidenceForStrategyPrinciple } from "@/db/repositories/evidence";
import { recalculateDnaHypothesisIndependence, insertDnaHypothesisWithEvidence, carryLearningInsightToDna } from "@/db/repositories/dna";
import { buildProvenance } from "@/lib/evidence/provenance";
import { loadIndependenceContext, loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { INDEPENDENCE_POLICY_VERSION, type IndependenceBasis } from "@/lib/evidence/resolve-independence";
import { ATTENTION_REASONS } from "@/lib/monitoring/decision-attention";
import { mkInvestor, mkTxn } from "../helpers/db-fixtures";
import { fixtureBasis } from "../helpers/independence";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });
const session = (investorId: string) => ({ session: { investorId } }) as never;
const dna = (i: string) => dnaRouter.createCaller(session(i));
const strategy = (i: string) => strategyRouter.createCaller(session(i));
const learning = (i: string) => learningRouter.createCaller(session(i));
const evidenceApi = (i: string) => evidenceRouter.createCaller(session(i));
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const codeOf = (e: unknown) => (e as TRPCError).code;
/** The Postgres constraint named in a (possibly Drizzle-wrapped) error. */
const violates = (name: string) => (e: unknown) => {
  const err = e as { message?: string; cause?: { message?: string; constraint_name?: string } };
  return [err.message, err.cause?.message, err.cause?.constraint_name].some((m) => typeof m === "string" && m.includes(name));
};
const ok = async () => ({ verdict: "supported" as const, reason: "ok" });
const noMatch = async () => ({ matchedId: null, reason: "new" });

let marketContextId: string;

interface World {
  investorId: string;
  strategyVersionId: string;
  answers: { id: string; txn: string }[];
  decisions: { id: string; ticker: string; reasoning: string; caseId: string }[];
}

async function mkDecision(owner: string, svId: string, ticker: string, type: "BUY" | "PASS" | "SELL", date: string, texts: { reasoning: string; risks?: string | null; exit?: string | null }) {
  const [c] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker, status: "decided" }).returning();
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c!.id, ticker, decisionType: type, decisionDate: at(date) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, {
    decisionId: d.id, priceAtDecision: "100", size: type === "PASS" ? null : "500",
    userReasoningText: texts.reasoning, risksConsideredText: texts.risks ?? null, exitConditionsText: texts.exit ?? null,
    aiRealtimeAssessmentText: "AI ASSESSMENT TEXT — never evidence",
    portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId: svId, thesisId: th.id,
    investmentCaseSnapshotJson: { synthesisText: "AI SYNTHESIS — never evidence", personalFitText: "AI PERSONAL FIT — never evidence" },
  }, []);
  return { id: d.id, ticker, reasoning: texts.reasoning, caseId: c!.id };
}

async function seedWorld(label: string): Promise<World> {
  const investorId = await mkInvestor(db, label);
  const strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  const t1 = await mkTxn(db, investorId, "NVDA", "buy", "2026-03-01", "10");
  const t2 = await mkTxn(db, investorId, "AMD", "buy", "2026-05-01", "10");
  const s = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
  const a1 = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: t1, questionText: "Q", answerText: "NVDA ANSWER I bought on conviction" });
  const a2 = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: t2, questionText: "Q", answerText: "AMD ANSWER I bought after a dip" });
  const d1 = await mkDecision(investorId, strategyVersionId, "LLY", "BUY", "2026-08-19", { reasoning: "LLY REASONING drug pipeline", risks: "LLY RISKS pricing", exit: "LLY EXIT if pipeline fails" });
  const d2 = await mkDecision(investorId, strategyVersionId, "SNDK", "PASS", "2026-08-20", { reasoning: "SNDK REASONING wait for pullback", risks: "  ", exit: null });
  return { investorId, strategyVersionId, answers: [{ id: a1.id, txn: t1 }, { id: a2.id, txn: t2 }], decisions: [d1, d2] };
}

const cite = (statementId: string, stance: "supporting" | "contradicting" = "supporting") => ({ statementId, stance, description: `cites ${statementId}` });

beforeAll(async () => {
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("migration 0017 on the scratch DB", () => {
  it("adds the decision statement columns, the iff CHECK, the widened source CHECK, the FK and provenance_json; monitoring untouched", async () => {
    const cols = await db.execute(`select column_name, is_nullable, udt_name from information_schema.columns where table_name = 'evidence' and column_name in ('decision_id','decision_statement_kind') order by column_name`);
    expect(cols).toEqual([
      { column_name: "decision_id", is_nullable: "YES", udt_name: "uuid" },
      { column_name: "decision_statement_kind", is_nullable: "YES", udt_name: "decision_statement_kind" },
    ]);
    const enumValues = await db.execute(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'decision_statement_kind' order by enumsortorder`);
    expect(enumValues.map((r) => r.enumlabel)).toEqual(["reasoning", "risks", "exit_conditions"]);
    const checks = await db.execute(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'evidence'::regclass and contype in ('c','f') order by conname`);
    const byName = new Map(checks.map((c) => [c.conname as string, c.def as string]));
    expect(byName.get("evidence_decision_statement_kind_iff")).toContain("decision_statement_kind IS NULL");
    expect(byName.get("evidence_at_most_one_source")).toContain("decision_id");
    expect(byName.get("evidence_decision_id_decisions_id_fk")).toContain("REFERENCES decisions(id)");
    const prov = await db.execute(`select table_name from information_schema.columns where column_name = 'provenance_json' order by table_name`);
    expect(prov.map((r) => r.table_name)).toEqual(["dna_hypothesis_versions", "learning_insight_versions", "strategy_principle_versions"]);
    expect(ATTENTION_REASONS).toHaveLength(4);
  });

  it("legacy rows stay valid: an answer-only evidence row and a NULL-provenance version insert unchanged; the CHECKs refuse half a decision citation", async () => {
    const w = await seedWorld("er-legacy");
    const { hypothesis, version } = await insertDnaHypothesisWithEvidence(db, w.investorId, {
      statement: "legacy", evidence: [{ interviewAnswerId: w.answers[0]!.id, stance: "supporting", description: "d" }],
      supportingCount: 1, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis(1, 0),
    });
    expect(version.provenanceJson).toBeNull();
    const rows = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ interviewAnswerId: w.answers[0]!.id, decisionId: null, decisionStatementKind: null });
    await expect(db.insert(schema.evidence).values({ dnaHypothesisId: hypothesis.id, stance: "supporting", decisionId: w.decisions[0]!.id, description: "no kind" })).rejects.toSatisfy(violates("evidence_decision_statement_kind_iff"));
    await expect(db.insert(schema.evidence).values({ dnaHypothesisId: hypothesis.id, stance: "supporting", decisionStatementKind: "risks", description: "no decision" })).rejects.toSatisfy(violates("evidence_decision_statement_kind_iff"));
    await expect(db.insert(schema.evidence).values({ dnaHypothesisId: hypothesis.id, stance: "supporting", decisionId: w.decisions[0]!.id, decisionStatementKind: "risks", interviewAnswerId: w.answers[0]!.id, description: "two sources" })).rejects.toSatisfy(violates("evidence_at_most_one_source"));
    // raw SQL: every other invalid source combination and a malformed kind
    const h = hypothesis.id, dId = w.decisions[0]!.id;
    const raw = (cols: string, vals: string) => db.execute(`insert into evidence (dna_hypothesis_id, stance, description, ${cols}) values ('${h}', 'supporting', 'raw', ${vals})`);
    await expect(raw("decision_id, decision_statement_kind, manual_note_text", `'${dId}', 'risks', 'a note'`)).rejects.toSatisfy(violates("evidence_at_most_one_source"));
    await expect(raw("decision_id, decision_statement_kind, source_learning_insight_id", `'${dId}', 'risks', '${randomUUID()}'`)).rejects.toSatisfy((e) => violates("evidence_at_most_one_source")(e) || violates("evidence_source_learning_insight_id")(e));
    await expect(raw("decision_id, decision_statement_kind", `'${dId}', 'later_context'`)).rejects.toSatisfy((e) => /invalid input value for enum decision_statement_kind/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)));
    await expect(raw("decision_id, decision_statement_kind", `'${randomUUID()}', 'reasoning'`)).rejects.toSatisfy(violates("evidence_decision_id_decisions_id_fk"));
    // the FK has no cascade: deleting a decision with evidence is refused (history stays)
    await db.execute(`insert into evidence (dna_hypothesis_id, stance, description, decision_id, decision_statement_kind) values ('${h}', 'supporting', 'raw ok', '${dId}', 'reasoning')`);
    await expect(db.execute(`delete from decisions where id = '${dId}'`)).rejects.toSatisfy((e) => /violates foreign key constraint/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)));
    const ddl = await db.execute(`select confdeltype from pg_constraint where conname = 'evidence_decision_id_decisions_id_fk'`);
    expect(ddl).toEqual([{ confdeltype: "a" }]); // NO ACTION
  });
});

describe("decision-time statements as evidence (OD-1) through the real generate routers", () => {
  it("offers answers + decision statements, source-labelled, and never the AI/post-decision texts; persists decision_id + kind; provenance answers where the version came from", async () => {
    const w = await seedWorld("er-od1");
    const statements = await listDecisionStatementsForInvestor(db, w.investorId);
    expect(statements.map((s) => [s.ticker, s.kind])).toEqual([["LLY", "reasoning"], ["LLY", "risks"], ["LLY", "exit_conditions"], ["SNDK", "reasoning"]]); // blank risks + null exit skipped
    const lly = w.decisions[0]!;
    const sndk = w.decisions[1]!;

    ai.proposeDna.mockResolvedValueOnce([{ statement: "claim A", evidence: [
      cite(w.answers[0]!.id), cite(`decision:${lly.id}:reasoning`), cite(`decision:${lly.id}:risks`, "contradicting"), cite(`decision:${sndk.id}:reasoning`),
    ] }]);
    ai.ground.mockImplementation(ok);
    ai.classify.mockImplementation(noMatch);
    const result = await dna(w.investorId).generate();
    expect(result.createdCount).toBe(1);

    // what the AI was shown
    const shown = ai.dnaInputs.at(-1) as { id: string; source: string; text: string; heading: string }[];
    expect(shown.map((s) => s.source)).toEqual(["interview_answer", "interview_answer", "decision_statement", "decision_statement", "decision_statement", "decision_statement"]);
    expect(shown.find((s) => s.id === `decision:${lly.id}:reasoning`)!.text).toBe("LLY REASONING drug pipeline");
    const serialized = JSON.stringify(shown);
    for (const forbidden of ["AI ASSESSMENT", "AI SYNTHESIS", "AI PERSONAL FIT"]) expect(serialized).not.toContain(forbidden);

    // grounding was run against the investor's own text with the source kind
    const groundedDecision = (ai.groundInputs as { sourceAnswerText: string; sourceKind?: string }[]).find((g) => g.sourceAnswerText === "LLY RISKS pricing");
    expect(groundedDecision?.sourceKind).toBe("decision_statement");

    // persisted rows
    const h = result.hypotheses[0]!;
    const rows = await getEvidenceForDnaHypothesis(db, h.hypothesis.id);
    expect(rows.map((r) => [r.interviewAnswerId === null ? null : "answer", r.decisionId, r.decisionStatementKind, r.stance]).sort()).toEqual(
      [["answer", null, null, "supporting"], [null, lly.id, "reasoning", "supporting"], [null, lly.id, "risks", "contradicting"], [null, sndk.id, "reasoning", "supporting"]].sort()
    );
    // counts: answer (NVDA episode) + LLY decision (one case, contradicting because its risks statement contradicts) + SNDK own case
    expect(h.version.supportingEvidenceCount).toBe(2);
    expect(h.version.contradictingEvidenceCount).toBe(1);
    expect(h.version.evidenceStrength).toBe("insufficient_evidence");
    const basis = h.version.independenceBasisJson as IndependenceBasis;
    expect(basis.policyVersion).toBe(INDEPENDENCE_POLICY_VERSION);
    expect(basis.policy).toEqual({ maxGapDays: 14, isolationMarginDays: 3, decisionCases: "evidence-source-v1", candidateDayTolerance: 1 }); // OD-R5: persisted for later interpretation
    expect(basis.groups.some((g) => g.reasons.some((r) => r.kind === "decision_case" && r.ref === lly.id))).toBe(true);
    expect(h.version.provenanceJson).toMatchObject({ schemaVersion: 1, generator: "dna.generate", model: expect.any(String), evidenceSourceContract: "evidence-source-v1", independencePolicy: "independence-policy-v2", sourceTypes: ["interview_answer", "decision_statement"] });
    expect((h.version.provenanceJson as { promptContracts: string[] }).promptContracts).toContain("dna-propose-v3-statements");
  });

  it("Strategy observed (OD-4): same sources, same counting, same persistence", async () => {
    const w = await seedWorld("er-od4");
    const lly = w.decisions[0]!;
    ai.proposeStrategy.mockResolvedValueOnce([{ statement: "sizing claim", evidence: [cite(`decision:${lly.id}:exit_conditions`), cite(w.answers[1]!.id)] }]);
    ai.ground.mockImplementation(ok);
    ai.classify.mockImplementation(noMatch);
    const result = await strategy(w.investorId).generateObserved();
    expect(result.createdCount).toBe(1);
    const p = result.principles[0]!;
    expect(p.version.supportingEvidenceCount).toBe(2);
    expect(p.version.provenanceJson).toMatchObject({ generator: "strategy.generateObserved" });
    const rows = await getEvidenceForStrategyPrinciple(db, p.principle.id);
    expect(rows.find((r) => r.decisionId === lly.id)?.decisionStatementKind).toBe("exit_conditions");
    // declared extraction is untouched — the observed rationale says what it read
    expect(p.version.rationaleText).toContain("decision records");
  });

  it("self-reinforcement attack: ids for AI text, reviews, later context, predictions, snapshot fields, evidence descriptions, insights — all dropped; a decision of another investor is dropped", async () => {
    const w = await seedWorld("er-attack");
    const other = await seedWorld("er-attack-other");
    const lly = w.decisions[0]!;
    const forged = [
      `decision:${lly.id}:ai_realtime_assessment`, `decision:${lly.id}:later_context`, `decision:${lly.id}:review`, `decision:${lly.id}:outcome`,
      `decision:${lly.id}:synthesis`, `decision:${lly.id}:personal_fit`, `prediction:${lly.id}`, `review:${lly.id}`, `later-context:${lly.id}`,
      `case:${lly.caseId}`, `evidence:${lly.id}`, `insight:${lly.id}`, "AI ASSESSMENT TEXT — never evidence",
      `decision:${other.decisions[0]!.id}:reasoning`, // another investor's real decision
      other.answers[0]!.id, // another investor's real answer
      randomUUID(), // a guessed uuid
      `decision:${randomUUID()}:reasoning`, // a guessed decision id
      "executed as planned at the open", // execution-note style text
      `origin:${lly.caseId}`, // reconsideration origin
      "userReasoningText", // a snapshot JSON key
    ];
    ai.proposeDna.mockResolvedValueOnce([
      { statement: "forged only", evidence: forged.map((id) => cite(id)) },
      { statement: "one real + forged", evidence: [cite(`decision:${lly.id}:reasoning`), ...forged.map((id) => cite(id))] },
    ]);
    ai.ground.mockImplementation(ok);
    ai.classify.mockImplementation(noMatch);
    const result = await dna(w.investorId).generate();
    expect(result.createdCount).toBe(1);
    expect(result.droppedCount).toBe(1);
    const rows = await getEvidenceForDnaHypothesis(db, result.hypotheses[0]!.hypothesis.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decisionId: lly.id, decisionStatementKind: "reasoning" });
    expect(result.hypotheses[0]!.version.supportingEvidenceCount).toBe(1);
    // grounding never saw a forged id's text
    expect((ai.groundInputs as { sourceAnswerText: string }[]).filter((g) => g.sourceAnswerText.includes("never evidence"))).toHaveLength(0);

    // the same attack against observed Strategy (OD-4): identical outcome through the same validator/resolver
    ai.proposeStrategy.mockResolvedValueOnce([
      { statement: "forged only", evidence: forged.map((id) => cite(id)) },
      { statement: "one real + forged", evidence: [cite(`decision:${lly.id}:risks`), ...forged.map((id) => cite(id))] },
    ]);
    const s = await strategy(w.investorId).generateObserved();
    expect(s.createdCount).toBe(1);
    expect(s.droppedCount).toBe(1);
    const sRows = await getEvidenceForStrategyPrinciple(db, s.principles[0]!.principle.id);
    expect(sRows).toHaveLength(1);
    expect(sRows[0]).toMatchObject({ decisionId: lly.id, decisionStatementKind: "risks" });
    // and nothing of the other investor's was touched or read into this investor's rows
    expect(await db.select().from(schema.evidence).where(eq(schema.evidence.decisionId, other.decisions[0]!.id))).toHaveLength(0);
  });

  it("OD-2 on persisted rows: unclassified candidates -> unresolved (counted on neither side); an executed fact merges with the trade's episode; unrelated -> own", async () => {
    const w = await seedWorld("er-od2");
    const avgoBefore = await mkTxn(db, w.investorId, "AVGO", "buy", "2026-09-02", "5");
    const avgoAfter = await mkTxn(db, w.investorId, "AVGO", "buy", "2026-09-10", "5");
    const d = await mkDecision(w.investorId, w.strategyVersionId, "AVGO", "BUY", "2026-09-08", { reasoning: "AVGO REASONING" });
    const s = await insertInterviewSession(db, { investorId: w.investorId, origin: "user_initiated" });
    const aAfter = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: avgoAfter, questionText: "Q", answerText: "AVGO ANSWER about the later buy" });

    const resolutionOf = async () => (await loadIndependenceContext(db, w.investorId)).decisions!.find((x) => x.id === d.id)!.caseResolution;
    expect(await resolutionOf()).toEqual({ kind: "unresolved", candidateTransactionIds: [avgoAfter] }); // the 09-02 buy is before the decision: not a candidate

    const countsFor = async () => {
      const r = await loadIndependenceResolver(db, w.investorId);
      return r.resolve([{ interviewAnswerId: null, decisionStatement: { decisionId: d.id, kind: "reasoning" }, stance: "supporting" }, { interviewAnswerId: aAfter.id, stance: "supporting" }]);
    };
    let basis = await countsFor();
    expect(basis.supportingLower).toBe(1); // the answer only; the decision is review-only
    expect(basis.unresolvedDecisionIds).toEqual([d.id]);

    const { fact } = await insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: avgoAfter, verdict: "unrelated", timeZone: "UTC" });
    expect(await resolutionOf()).toEqual({ kind: "own" });
    basis = await countsFor();
    expect(basis.supportingLower).toBe(2); // own decision case + the trade's episode
    expect(basis.unresolvedDecisionIds).toEqual([]);

    await insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: avgoAfter, verdict: "executed", timeZone: "UTC", supersedesFactId: fact.id });
    const merged = await resolutionOf();
    expect(merged).toMatchObject({ kind: "merged", transactionIds: [avgoAfter] });
    expect(merged.kind === "merged" && merged.executedFactIds).toHaveLength(1); // OD-R2: the basis can name the fact it merged through
    basis = await countsFor();
    expect(basis.supportingLower).toBe(1); // decision + the answer about the executing trade = ONE case
    expect(basis.groups[0]!.citations).toEqual([`answer:${aAfter.id}`, `decision:${d.id}:reasoning`]);
    // the superseded "unrelated" fact plays no part; a fact of another investor cannot exist for this decision (repository refuses)
    await expect(insertDecisionExecutionFact(db, { investorId: (await seedWorld("er-od2-x")).investorId, decisionId: d.id, transactionId: avgoBefore, verdict: "executed", timeZone: "UTC" })).rejects.toThrow(/Decision not found/);
  });

  it("OD-R2: one decision executed by trades of TWO accounting episodes = one union case (basis names decision, episodes, facts); episodes stay independent without the decision; superseding to unrelated recomputes; identical concurrent assertions add no fact", async () => {
    const w = await seedWorld("er-odr2");
    // NVDA: buy (episode 1) -> sell all (closes) -> buy again (episode 2); the decision BUY is dated before both buys
    const buy1 = await mkTxn(db, w.investorId, "NVDA2", "buy", "2026-09-02", "5");
    await mkTxn(db, w.investorId, "NVDA2", "sell", "2026-09-03", "5");
    const buy2 = await mkTxn(db, w.investorId, "NVDA2", "buy", "2026-09-05", "5");
    const d = await mkDecision(w.investorId, w.strategyVersionId, "NVDA2", "BUY", "2026-09-01", { reasoning: "NVDA2 REASONING" });
    const s = await insertInterviewSession(db, { investorId: w.investorId, origin: "user_initiated" });
    const a1 = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: buy1, questionText: "Q", answerText: "first NVDA2 entry" });
    const a2 = await insertInterviewAnswer(db, { interviewSessionId: s.id, transactionId: buy2, questionText: "Q", answerText: "second NVDA2 entry" });
    const episodes = (await loadIndependenceContext(db, w.investorId)).episodeKeyByTransactionId;
    expect(episodes.get(buy1)).not.toBe(episodes.get(buy2));

    const resolve = async (cites: { decision: boolean }) => {
      const r = await loadIndependenceResolver(db, w.investorId);
      const citations = [{ interviewAnswerId: a1.id, stance: "supporting" as const }, { interviewAnswerId: a2.id, stance: "supporting" as const }];
      return r.resolve(cites.decision ? [{ interviewAnswerId: null, decisionStatement: { decisionId: d.id, kind: "reasoning" as const }, stance: "supporting" as const }, ...citations] : citations);
    };
    // unclassified candidates -> unresolved: the decision counts nowhere, the two episodes stay two cases
    expect((await resolve({ decision: true }))).toMatchObject({ supportingLower: 2, unresolvedDecisionIds: [d.id] });

    // the investor marks BOTH buys as executing the decision -> union: one case; two identical concurrent assertions add only one fact
    const [x, y] = await Promise.all([
      insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: buy1, verdict: "executed", timeZone: "UTC" }),
      insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: buy1, verdict: "executed", timeZone: "UTC" }),
    ]);
    expect(x.fact.id).toBe(y.fact.id);
    expect([x.replayed, y.replayed].filter(Boolean)).toHaveLength(1);
    const f2 = await insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: buy2, verdict: "executed", timeZone: "UTC" });
    const union = await resolve({ decision: true });
    expect(union.supportingLower).toBe(1);
    expect(union.groups).toHaveLength(1);
    expect(union.groups[0]!.reasons.filter((r) => r.kind === "executed_fact").map((r) => r.ref).sort()).toEqual([x.fact.id, f2.fact.id].sort());
    expect(union.groups[0]!.reasons.filter((r) => r.kind === "same_episode")).toHaveLength(2);
    expect(union.groups[0]!.reasons.some((r) => r.kind === "decision_case" && r.ref === d.id)).toBe(true);
    // without the decision citation the two episodes remain independently resolvable
    expect((await resolve({ decision: false })).supportingLower).toBe(2);
    // superseding the second executed fact to unrelated recomputes the union: decision + episode 1 only; episode 2 is its own case again
    await insertDecisionExecutionFact(db, { investorId: w.investorId, decisionId: d.id, transactionId: buy2, verdict: "unrelated", timeZone: "UTC", supersedesFactId: f2.fact.id });
    const after = await resolve({ decision: true });
    expect(after.supportingLower).toBe(2);
    expect(after.groups.find((g) => g.citations.includes(`decision:${d.id}:reasoning`))!.reasons.filter((r) => r.kind === "executed_fact").map((r) => r.ref)).toEqual([x.fact.id]);
    // the decision never became two cases at any point
    for (const b of [union, after]) expect(b.groups.filter((g) => g.citations.some((c) => c.startsWith("decision:")))).toHaveLength(1);
  });

  it("independence recalculation reads decision citations (no backfill: an unchanged count is a no-op; a drop appends)", async () => {
    const w = await seedWorld("er-recalc");
    const lly = w.decisions[0]!;
    // Stored as if the two LLY statements were two cases (S=2); the resolver says one case.
    const { hypothesis } = await insertDnaHypothesisWithEvidence(db, w.investorId, {
      statement: "recalc", evidence: [
        { interviewAnswerId: null, decisionStatement: { decisionId: lly.id, kind: "reasoning" }, stance: "supporting", description: "d" },
        { interviewAnswerId: null, decisionStatement: { decisionId: lly.id, kind: "risks" }, stance: "supporting", description: "d" },
      ],
      supportingCount: 2, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis(2, 0),
    });
    const outcome = await recalculateDnaHypothesisIndependence(db, hypothesis.id, await loadIndependenceResolver(db, w.investorId));
    expect(outcome.action).toBe("appended");
    if (outcome.action === "appended") {
      expect(outcome.plan.supportingEvidenceCount).toBe(1);
      expect(outcome.plan.independenceBasis.groups[0]!.reasons).toEqual([{ kind: "decision_case", ref: lly.id }]);
    }
    const again = await recalculateDnaHypothesisIndependence(db, hypothesis.id, await loadIndependenceResolver(db, w.investorId));
    expect(again.action).toBe("no_op");
  });
});

describe("Learning: dedupe (Unit 5) and the OD-3 carry", () => {
  async function reviewed(w: World, index: number, quality: "strong" | "weak" = "strong") {
    const d = w.decisions[index]!;
    // sector comes from the frozen case snapshot
    await db.update(schema.decisionSnapshots).set({ investmentCaseSnapshotJson: { marketIntelligenceJson: { sector: "Healthcare" } } }).where(eq(schema.decisionSnapshots.decisionId, d.id));
    const [review] = await db.insert(schema.decisionReviews).values({
      decisionId: d.id, narrativeSummaryText: "REVIEW NARRATIVE — never DNA evidence", decisionQualityOverall: quality, thesisAccuracy: "confirmed",
      outcomeJson: { priceChangePercent: 1, pnlUsd: null, pnlPercent: null, stillHeld: true },
    }).returning();
    return review!.id;
  }

  it("OD-R1 A–G: one synthesis stream per family; a version only when the effective evidence-state fingerprint changes; wording alone never writes; F2 regression: stances travel per version", async () => {
    const w = await seedWorld("er-learn");
    const r1 = await reviewed(w, 0);
    const r2 = await reviewed(w, 1);
    const d1 = w.decisions[0]!.id, d2 = w.decisions[1]!.id;
    const fp = (entries: [string, string, "supporting" | "contradicting"][]) => learningEvidenceFingerprint(entries.map(([decisionId, decisionReviewId, stance]) => ({ decisionId, decisionReviewId, stance })));
    const insight = (cites: [string, "supporting" | "contradicting"][], text = "Healthcare pattern") => ({ statementText: text, evidence: cites.map(([id, stance]) => ({ decisionReviewId: id, stance, description: "d" })) });
    const versionsOf = async (id: string) => (await db.select().from(schema.learningInsightVersions).where(eq(schema.learningInsightVersions.learningInsightId, id))).sort((a, b) => a.versionNumber - b.versionNumber);
    const fpOf = (v: { provenanceJson: unknown }) => (v.provenanceJson as { evidenceFingerprint: string }).evidenceFingerprint;

    // v1
    ai.learning.mockResolvedValue(insight([[r1, "supporting"], [r2, "supporting"]]));
    const first = await learning(w.investorId).generate();
    expect(first).toMatchObject({ familiesConsidered: 1, createdCount: 1, versionedCount: 0, unchangedCount: 0 });
    const identity = first.insights[0]!.insight;
    expect(first.insights[0]!.version.provenanceJson).toMatchObject({ generator: "learning.generate", sourceTypes: ["decision_review"], evidenceFingerprint: fp([[d1, r1, "supporting"], [d2, r2, "supporting"]]), citedReviews: [{ decisionReviewId: r1, decisionId: d1, stance: "supporting" }, { decisionReviewId: r2, decisionId: d2, stance: "supporting" }] });

    // A. same evidence + same wording -> no version
    const a = await learning(w.investorId).generate();
    expect(a).toMatchObject({ createdCount: 0, versionedCount: 0, unchangedCount: 1 });
    expect(a.unchanged[0]).toMatchObject({ wordingDiffers: false });
    // B. same evidence + re-wording -> no version, reported; the stored statement is NOT replaced
    ai.learning.mockResolvedValueOnce(insight([[r1, "supporting"], [r2, "supporting"]], "Healthcare pattern, re-worded"));
    const b = await learning(w.investorId).generate();
    expect(b.unchanged[0]).toMatchObject({ wordingDiffers: true, proposedStatementText: "Healthcare pattern, re-worded" });
    expect((await versionsOf(identity.id)).map((v) => [v.versionNumber, v.statementText])).toEqual([[1, "Healthcare pattern"]]);
    expect(await db.select().from(schema.learningInsights).where(eq(schema.learningInsights.investorId, w.investorId))).toHaveLength(1);

    // C. new case -> v2
    const d3 = await mkDecision(w.investorId, w.strategyVersionId, "PFE", "BUY", "2026-09-01", { reasoning: "PFE REASONING" });
    w.decisions.push(d3);
    const r3 = await reviewed(w, 2);
    ai.learning.mockResolvedValue(insight([[r1, "supporting"], [r2, "supporting"], [r3, "supporting"]]));
    const c = await learning(w.investorId).generate();
    expect(c).toMatchObject({ createdCount: 0, versionedCount: 1 });
    expect(c.newVersions[0]!.version.versionNumber).toBe(2);
    expect((await db.select().from(schema.evidence).where(eq(schema.evidence.learningInsightId, identity.id))).map((e) => e.decisionReviewId).sort()).toEqual([r1, r2, r3].sort());

    // E. cited-review set change (review replacement: d1 re-reviewed, the family now offers only the latest review) -> v3, same stances
    await reviewed(w, 0);
    const d1Latest = (await db.select().from(schema.decisionReviews).where(eq(schema.decisionReviews.decisionId, d1)))[1]!.id;
    ai.learning.mockResolvedValue(insight([[d1Latest, "supporting"], [r2, "supporting"], [r3, "supporting"]]));
    const e1 = await learning(w.investorId).generate();
    expect(e1.versionedCount).toBe(1);
    expect(fpOf((await versionsOf(identity.id))[2]!)).toBe(fp([[d1, d1Latest, "supporting"], [d2, r2, "supporting"], [d3.id, r3, "supporting"]]));

    // D. stance flip alone (same decisions, same reviews) -> v4; the flipped (review, stance) is a NEW row, the old row stays
    ai.learning.mockResolvedValue(insight([[d1Latest, "supporting"], [r2, "contradicting"], [r3, "supporting"]], "Healthcare pattern v4"));
    const dRun = await learning(w.investorId).generate();
    expect(dRun.versionedCount).toBe(1);
    const rows = await db.select().from(schema.evidence).where(eq(schema.evidence.learningInsightId, identity.id));
    expect(rows.filter((e) => e.decisionReviewId === r2).map((e) => e.stance).sort()).toEqual(["contradicting", "supporting"]);
    expect(rows).toHaveLength(5); // r1, r2(sup), r3, d1Latest, r2(contra) — never a duplicate (review, stance) pair, never a deletion
    const v4 = (await versionsOf(identity.id))[3]!;
    expect(v4.versionNumber).toBe(4);
    expect((v4.provenanceJson as { citedReviews: { decisionReviewId: string; stance: string }[] }).citedReviews.find((x) => x.decisionReviewId === r2)!.stance).toBe("contradicting");

    // F2 regression: the carry reads the AGREED version's stances, never the identity's accumulated rows (which hold both stances for r2)
    ai.ground.mockImplementation(ok);
    const agreed = await learning(w.investorId).agree({ learningInsightId: identity.id, note: "v4" });
    expect((agreed.version.provenanceJson as { carriedFromLearningInsightVersionId: string }).carriedFromLearningInsightVersionId).toBe(v4.id);
    const carriedRows = await getEvidenceForDnaHypothesis(db, agreed.hypothesis.id);
    expect(carriedRows.filter((r) => r.decisionId === d2).map((r) => r.stance)).toEqual(["contradicting"]);
    expect(agreed.version.contradictingEvidenceCount).toBe(1);
    expect(agreed.version.supportingEvidenceCount).toBe(2); // LLY, PFE

    // E2. a case the current synthesis no longer cites -> v5, no rows added, no rows removed
    ai.learning.mockResolvedValue(insight([[d1Latest, "supporting"], [r3, "supporting"]]));
    const e2 = await learning(w.investorId).generate();
    expect(e2.versionedCount).toBe(1);
    expect((await db.select().from(schema.evidence).where(eq(schema.evidence.learningInsightId, identity.id)))).toHaveLength(5);
    expect(fpOf((await versionsOf(identity.id))[4]!)).toBe(fp([[d1, d1Latest, "supporting"], [d3.id, r3, "supporting"]]));
    // and the same state again -> no v6, whatever the wording
    ai.learning.mockResolvedValueOnce(insight([[r3, "supporting"], [d1Latest, "supporting"]], "different order, different words"));
    expect((await learning(w.investorId).generate()).unchangedCount).toBe(1);
    expect((await versionsOf(identity.id)).map((v) => v.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    // a later agree replays the carry bound to v4 — it does not re-carry on v5's state
    expect((await learning(w.investorId).agree({ learningInsightId: identity.id, note: "again" })).replayed).toBe(true);

    // F. concurrent identical first runs -> one identity, one version
    const w2 = await seedWorld("er-learn-race");
    const q1 = await reviewed(w2, 0);
    const q2 = await reviewed(w2, 1);
    ai.learning.mockResolvedValue(insight([[q1, "supporting"], [q2, "supporting"]]));
    const [x, y] = await Promise.all([learning(w2.investorId).generate(), learning(w2.investorId).generate()]);
    expect([x.createdCount + y.createdCount, x.unchangedCount + y.unchangedCount]).toEqual([1, 1]);
    const w2Ids = await db.select().from(schema.learningInsights).where(eq(schema.learningInsights.investorId, w2.investorId));
    expect(w2Ids).toHaveLength(1);

    // G. concurrent MATERIAL changes -> serialized, deterministic version history (unique numbers, each version's fingerprint is one of the two states, the latest is the state that committed last)
    const qd3 = await mkDecision(w2.investorId, w2.strategyVersionId, "PFE", "BUY", "2026-09-01", { reasoning: "PFE" });
    w2.decisions.push(qd3);
    const q3 = await reviewed(w2, 2);
    const stateX = insight([[q1, "supporting"], [q2, "supporting"], [q3, "supporting"]], "X");
    const stateY = insight([[q1, "supporting"], [q2, "contradicting"], [q3, "supporting"]], "Y");
    ai.learning.mockResolvedValueOnce(stateX).mockResolvedValueOnce(stateY);
    const [gx, gy] = await Promise.all([learning(w2.investorId).generate(), learning(w2.investorId).generate()]);
    expect(gx.versionedCount + gy.versionedCount).toBe(2);
    const w2Versions = await versionsOf(w2Ids[0]!.id);
    expect(w2Versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    const fpX = fp([[w2.decisions[0]!.id, q1, "supporting"], [w2.decisions[1]!.id, q2, "supporting"], [qd3.id, q3, "supporting"]]);
    const fpY = fp([[w2.decisions[0]!.id, q1, "supporting"], [w2.decisions[1]!.id, q2, "contradicting"], [qd3.id, q3, "supporting"]]);
    expect(new Set(w2Versions.slice(1).map(fpOf))).toEqual(new Set([fpX, fpY]));
    expect(w2Versions.slice(1).map((v) => v.statementText).sort()).toEqual(["X", "Y"]);
    expect(fpOf(w2Versions[2]!)).toBe(w2Versions[2]!.statementText === "X" ? fpX : fpY);
    expect((await db.select().from(schema.evidence).where(eq(schema.evidence.learningInsightId, w2Ids[0]!.id)))).toHaveLength(4); // q1, q2(sup), q3, q2(contra)
  });

  it("agree (OD-3): the new hypothesis carries the cited decisions' reasoning statements with faithful stances, counted through the resolver; agreement adds zero cases; replay on a second agree; cross-investor refused", async () => {
    const w = await seedWorld("er-agree");
    const r1 = await reviewed(w, 0);
    const r1b = await reviewed(w, 0); // second review of the same decision
    const r2 = await reviewed(w, 1, "weak");
    ai.learning.mockResolvedValue({ statementText: "Agreed pattern", evidence: [
      { decisionReviewId: r1, stance: "supporting", description: "d" },
      { decisionReviewId: r1b, stance: "supporting", description: "d" },
      { decisionReviewId: r2, stance: "contradicting", description: "d" },
    ] });
    const gen = await learning(w.investorId).generate();
    const insightId = gen.insights[0]!.insight.id;

    // the grounding gate: LLY's RISKS statement grounds the claim; its reasoning and exit do not; SNDK's reasoning grounds the contradiction
    ai.groundInputs.length = 0;
    ai.ground.mockImplementation(async (input: { sourceAnswerText: string; stance: string; sourceKind?: string }) =>
      input.sourceAnswerText === "LLY RISKS pricing" || input.sourceAnswerText === "SNDK REASONING wait for pullback"
        ? { verdict: "supported", reason: "grounded" }
        : { verdict: "unsupported", reason: "does not ground the claim" }
    );
    const agreed = await learning(w.investorId).agree({ learningInsightId: insightId, note: "yes" });
    expect(agreed.replayed).toBe(false);
    expect(agreed.carried).toEqual({ cases: 2, groundedCitations: 2, excludedCitations: 2, decisionsWithoutStatements: 0 });
    // every grounding call was against the investor's own decision text, with the agreed version's stance and the hypothesis wording
    const calls = ai.groundInputs as { hypothesisStatement: string; sourceAnswerText: string; stance: string; sourceKind?: string }[];
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.hypothesisStatement))).toEqual(new Set(["Agreed pattern"]));
    expect(calls.every((c) => c.sourceKind === "decision_statement")).toBe(true);
    expect(calls.find((c) => c.sourceAnswerText === "SNDK REASONING wait for pullback")!.stance).toBe("contradicting");
    expect(calls.some((c) => /REVIEW NARRATIVE|AI ASSESSMENT/.test(c.sourceAnswerText))).toBe(false);
    expect(agreed.version.supportingEvidenceCount).toBe(1); // LLY decision (two reviews = one case; grounded via its risks statement)
    expect(agreed.version.contradictingEvidenceCount).toBe(1); // SNDK decision, faithful stance
    expect(agreed.version.evidenceStrength).toBe("insufficient_evidence");
    expect(agreed.version.createdBy).toBe("user_correction");
    expect(agreed.version.provenanceJson).toMatchObject({ generator: "learning.agree_carry", model: expect.any(String), promptContracts: ["evidence-grounding-v3-statements"], carriedFromLearningInsightId: insightId, carriedFromLearningInsightVersionId: gen.insights[0]!.version.id, sourceTypes: ["decision_statement"] });
    const rows = await getEvidenceForDnaHypothesis(db, agreed.hypothesis.id);
    expect(rows.map((r) => [r.decisionId, r.decisionStatementKind, r.stance, r.sourceLearningInsightId, r.decisionReviewId]).sort()).toEqual(
      [[w.decisions[0]!.id, "risks", "supporting", null, null], [w.decisions[1]!.id, "reasoning", "contradicting", null, null]].sort()
    );
    expect(rows.every((r) => r.sourceLearningInsightId === null)).toBe(true); // the agreement is not evidence

    // replay: no second hypothesis, no second correction, NO further grounding calls; concurrent agrees converge
    ai.groundInputs.length = 0;
    const [x, y] = await Promise.all([
      learning(w.investorId).agree({ learningInsightId: insightId, note: "again" }),
      learning(w.investorId).agree({ learningInsightId: insightId, note: "again" }),
    ]);
    expect(x.hypothesis.id).toBe(agreed.hypothesis.id);
    expect(y.hypothesis.id).toBe(agreed.hypothesis.id);
    expect(x.replayed && y.replayed).toBe(true);
    expect(ai.groundInputs).toHaveLength(0);
    const carried = await db.select().from(schema.dnaHypothesisVersions).where(sql`${schema.dnaHypothesisVersions.provenanceJson} ->> 'carriedFromLearningInsightId' = ${insightId}`);
    expect(carried).toHaveLength(1);
    const corrections = await db.select().from(schema.corrections).where(and(eq(schema.corrections.learningInsightId, insightId)));
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ status: "led_to_new_version", resultingVersionId: agreed.version.id });

    // the carried hypothesis is what dna.list shows, and its reach says it cites decision statements only
    const reach = await evidenceApi(w.investorId).reach();
    const claim = reach.claims.find((c) => c.id === agreed.hypothesis.id)!;
    expect(claim.sources).toEqual({ interviewAnswers: 0, decisionStatements: 2 });
    expect(claim.visibleToAi).toBe(false);
    expect(claim.distance).toEqual({ nextTier: "moderate", additionalSupportingCases: 2 });
    expect(claim.generatedAt).toBeNull(); // a carry is not a generate run

    // cross-investor: another investor cannot agree with this insight
    const other = await seedWorld("er-agree-other");
    await expect(learning(other.investorId).agree({ learningInsightId: insightId, note: "mine?" })).rejects.toSatisfy((e) => codeOf(e) === "NOT_FOUND");
  });

  it("F1 regression (OD-R3): when none of the cited decisions' own statements ground the claim (valuation reasoning vs an exit-discipline insight), nothing is carried — no hypothesis, no version, no evidence, no Correction; partial grounding keeps only grounded cases", async () => {
    const w = await seedWorld("er-agree-ungrounded");
    const r1 = await reviewed(w, 0);
    const r2 = await reviewed(w, 1);
    ai.learning.mockResolvedValue({ statementText: "You tend to ignore exit discipline.", evidence: [{ decisionReviewId: r1, stance: "supporting", description: "d" }, { decisionReviewId: r2, stance: "supporting", description: "d" }] });
    const gen = await learning(w.investorId).generate();
    ai.ground.mockImplementation(async () => ({ verdict: "unsupported", reason: "the statement is silent on exit discipline" }));
    await expect(learning(w.investorId).agree({ learningInsightId: gen.insights[0]!.insight.id, note: "x" })).rejects.toSatisfy((e) => codeOf(e) === "BAD_REQUEST" && !/[0-9a-f]{8}-[0-9a-f]{4}/.test((e as Error).message));
    expect(await db.select().from(schema.dnaHypotheses).where(eq(schema.dnaHypotheses.investorId, w.investorId))).toHaveLength(0);
    expect(await db.select().from(schema.corrections).where(eq(schema.corrections.learningInsightId, gen.insights[0]!.insight.id))).toHaveLength(0);
    // a partially grounded carry keeps only the grounded case: LLY (3 statements) grounded, SNDK not -> S=1, one case
    ai.ground.mockImplementation(async (input: { sourceAnswerText: string }) => (input.sourceAnswerText.startsWith("LLY") ? { verdict: "supported", reason: "ok" } : { verdict: "unsupported", reason: "no" }));
    const agreed = await learning(w.investorId).agree({ learningInsightId: gen.insights[0]!.insight.id, note: "x" });
    expect(agreed.carried).toEqual({ cases: 2, groundedCitations: 3, excludedCitations: 1, decisionsWithoutStatements: 0 });
    expect(agreed.version.supportingEvidenceCount).toBe(1);
    expect((await getEvidenceForDnaHypothesis(db, agreed.hypothesis.id)).map((r) => r.decisionStatementKind).sort()).toEqual(["exit_conditions", "reasoning", "risks"]);
  });

  it("failure atomicity: a carry whose evidence insert fails leaves no hypothesis, no version, no evidence", async () => {
    const w = await seedWorld("er-carry-atomic");
    const before = await db.select().from(schema.dnaHypotheses).where(eq(schema.dnaHypotheses.investorId, w.investorId));
    const provenance = buildProvenance({ generator: "learning.agree_carry", model: "m", promptContracts: [], sourceTypes: ["decision_statement"], carriedFromLearningInsightId: randomUUID() });
    await expect(
      carryLearningInsightToDna(db, {
        investorId: w.investorId, learningInsightId: provenance.carriedFromLearningInsightId!, statementText: "s",
        evidence: [{ decisionId: randomUUID(), kind: "reasoning", stance: "supporting", description: "d" }], // FK violation inside the transaction
        supportingCount: 1, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis(1, 0), provenance,
      })
    ).rejects.toSatisfy(violates("evidence_decision_id_decisions_id_fk"));
    expect(await db.select().from(schema.dnaHypotheses).where(eq(schema.dnaHypotheses.investorId, w.investorId))).toHaveLength(before.length);
    expect(await db.select().from(schema.dnaHypothesisVersions).where(sql`${schema.dnaHypothesisVersions.provenanceJson} ->> 'carriedFromLearningInsightId' = ${provenance.carriedFromLearningInsightId!}`)).toHaveLength(0);
    // and a carry with zero grounded citations is refused before any write
    await expect(carryLearningInsightToDna(db, { investorId: w.investorId, learningInsightId: provenance.carriedFromLearningInsightId!, statementText: "s", evidence: [], supportingCount: 0, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis(), provenance })).rejects.toThrow(/no grounded evidence/);
  });

  it("agree with an insight whose cited decisions have no investor-authored statement at all is refused (nothing to carry)", async () => {
    const w = await seedWorld("er-agree-empty");
    const r1 = await reviewed(w, 0);
    const r2 = await reviewed(w, 1);
    // blank out the reasoning statements: snapshots are immutable in the product, so simulate a raw legacy row directly on the scratch DB
    await db.update(schema.decisionSnapshots).set({ userReasoningText: "   ", risksConsideredText: null, exitConditionsText: null }).where(eq(schema.decisionSnapshots.decisionId, w.decisions[0]!.id));
    await db.update(schema.decisionSnapshots).set({ userReasoningText: "", risksConsideredText: null, exitConditionsText: null }).where(eq(schema.decisionSnapshots.decisionId, w.decisions[1]!.id));
    ai.learning.mockResolvedValue({ statementText: "p", evidence: [{ decisionReviewId: r1, stance: "supporting", description: "d" }, { decisionReviewId: r2, stance: "supporting", description: "d" }] });
    const gen = await learning(w.investorId).generate();
    ai.ground.mockImplementation(ok);
    await expect(learning(w.investorId).agree({ learningInsightId: gen.insights[0]!.insight.id, note: "x" })).rejects.toSatisfy((e) => codeOf(e) === "BAD_REQUEST");
    expect(await db.select().from(schema.dnaHypotheses).where(eq(schema.dnaHypotheses.investorId, w.investorId))).toHaveLength(0);
  });
});

describe("read-only views: reach and next actions", () => {
  it("reach counts statements and claims; next actions list the deterministic catalogue for this world and disappear when done", async () => {
    const w = await seedWorld("er-views");
    const before = await evidenceApi(w.investorId).reach();
    expect(before.summary.statements).toEqual({ total: 6, interviewAnswers: 2, decisionStatements: 4 });
    expect(before.summary.dna).toMatchObject({ claims: 0, visibleToAi: 0, insufficient: 0, uncitedStatements: 6, unresolvedDecisions: 0, lastGeneratedAt: null, regenerationMayChangeReach: true });

    const actions = await evidenceApi(w.investorId).nextActions();
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("SET_REVIEW_HORIZON"); // both decisions have no horizon
    expect(kinds).toContain("REGENERATE_WITH_UNUSED_EVIDENCE"); // 6 uncited statements, both domains
    expect(actions.filter((a) => a.kind === "REGENERATE_WITH_UNUSED_EVIDENCE").map((a) => a.domain)).toEqual(["dna", "strategy"]);
    expect(kinds).not.toContain("RESOLVE_EXECUTION_CANDIDATES"); // LLY BUY has no executable candidate

    // generate a hypothesis citing everything -> the DNA regenerate action disappears
    ai.proposeDna.mockResolvedValueOnce([{ statement: "all", evidence: before.claims.length === 0 ? [
      cite(w.answers[0]!.id), cite(w.answers[1]!.id), cite(`decision:${w.decisions[0]!.id}:reasoning`), cite(`decision:${w.decisions[0]!.id}:risks`), cite(`decision:${w.decisions[0]!.id}:exit_conditions`), cite(`decision:${w.decisions[1]!.id}:reasoning`),
    ] : [] }]);
    ai.ground.mockImplementation(ok);
    ai.classify.mockImplementation(noMatch);
    await dna(w.investorId).generate();
    const after = await evidenceApi(w.investorId).reach();
    expect(after.summary.dna).toMatchObject({ claims: 1, uncitedStatements: 0, insufficient: 0, visibleToAi: 1 });
    expect(after.claims[0]!.sources).toEqual({ interviewAnswers: 2, decisionStatements: 4 });
    expect(after.claims[0]!.supportingCount).toBe(4); // NVDA, AMD, LLY, SNDK
    expect(after.claims[0]!.visibleToAi).toBe(true); // 4 supporting, 0 contradicting -> moderate
    const regen = (await evidenceApi(w.investorId).nextActions()).filter((a) => a.kind === "REGENERATE_WITH_UNUSED_EVIDENCE");
    expect(regen.map((a) => a.domain)).toEqual(["strategy"]);
    expect(after.summary.dna.lastGeneratedAt).not.toBeNull();
    expect(after.summary.dna.regenerationMayChangeReach).toBe(false);

    // DONE condition, not "cited everything": a generate run that cites only SOME statements still clears the action — the run has seen them all
    const w2 = await seedWorld("er-views-partial");
    ai.proposeDna.mockResolvedValueOnce([{ statement: "partial", evidence: [cite(w2.answers[0]!.id)] }]);
    await dna(w2.investorId).generate();
    const partial = await evidenceApi(w2.investorId).reach();
    expect(partial.summary.dna).toMatchObject({ uncitedStatements: 5, regenerationMayChangeReach: false });
    expect((await evidenceApi(w2.investorId).nextActions()).filter((a) => a.kind === "REGENERATE_WITH_UNUSED_EVIDENCE").map((a) => a.domain)).toEqual(["strategy"]);
    // a statement recorded AFTER that run re-arms it
    await mkDecision(w2.investorId, w2.strategyVersionId, "PFE", "PASS", "2026-09-20", { reasoning: "PFE REASONING later" });
    const rearmed = await evidenceApi(w2.investorId).reach();
    expect(rearmed.summary.dna).toMatchObject({ uncitedStatements: 6, regenerationMayChangeReach: true });
  });
});
