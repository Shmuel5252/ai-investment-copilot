// OD-R9 — the grounding judgment AUDIT LEDGER on the authorized test DB:
// migration 0018's shape and constraints, and the append-only apply path
// (applyDnaGroundingRemediation / applyStrategyGroundingRemediation) for
// no_op, checked_no_change and new_version; replay and conflict; technical
// failure; rollback; stale state; a run across several identities; and the
// proof that an audit row never changes what the semantic readers return.
// Deterministic injected gates — zero AI calls.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { GroundingJudgmentConflictError, GroundingRunMismatchError, GroundingTechnicalFailureError, StaleIdentityVersionError } from "@/db/errors";
import { insertDecision, insertDecisionSnapshot, insertThesis } from "@/db/repositories/decisions";
import { insertInterviewAnswer, insertInterviewSession, getAllAnswersForInvestor } from "@/db/repositories/interview";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { getLatestDnaHypothesisVersion, insertDnaHypothesisWithEvidence, insertGroundingChecksForVersion } from "@/db/repositories/dna";
import { getLatestStrategyPrincipleVersion, insertObservedPrincipleWithEvidence } from "@/db/repositories/strategy";
import {
  getCountingEvidenceForDnaVersion,
  getEffectiveEvidenceForDnaHypothesisVersion,
  getEffectiveEvidenceForStrategyPrincipleVersion,
  getEvidenceForDnaHypothesis,
  getEvidenceForStrategyPrinciple,
  getGroundingChecksForDnaHypothesisVersion,
  getGroundingChecksForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { applyDnaGroundingRemediation, applyStrategyGroundingRemediation, listGroundingJudgmentsForRun } from "@/db/repositories/grounding-judgments";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { buildGroundingRun } from "@/lib/evidence/grounding-run";
import { buildProvenance } from "@/lib/evidence/provenance";
import { buildInvestorStatements, buildStatementContextById } from "@/lib/ai/investor-statements";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { assessCitations } from "@/lib/evidence/resolve-independence";
import { excludeInsufficientEvidence } from "@/lib/dna/evidence-strength";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { mkInvestor, mkTxn } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

const Q_HOLD = "What kept you in the position while it was rising?";
const Q_SELL = "What made you decide to sell then?";
const A_HOLD = "I did not wait for a target or a signal; as long as it kept rising I stayed with it because I believe in the company.";
const A_SELL = "I did not want to lose the profit; after such a big rise a correction felt likely.";
const REASONING = "I believe in the sector and I want to add to the position.";
const CLAIM = "You tend to hold onto positions as long as the stock keeps climbing and you believe in the company.";
const MODEL = "claude-sonnet-5";

let marketContextId: string;
// Scoped to ONE synthetic investor, so other test files writing at the same time cannot move these numbers.
const n = async (query: ReturnType<typeof sql>) => Number(((await db.execute(query))[0] as { n: number }).n);
const counts = async (investorId: string) => ({
  judgments: await n(sql`select count(*)::int as n from grounding_judgments j join evidence e on e.id = j.evidence_id where e.dna_hypothesis_id in (select id from dna_hypotheses where investor_id = ${investorId}) or e.strategy_principle_id in (select id from strategy_principles where investor_id = ${investorId})`),
  evidence: await n(sql`select count(*)::int as n from evidence e where e.dna_hypothesis_id in (select id from dna_hypotheses where investor_id = ${investorId}) or e.strategy_principle_id in (select id from strategy_principles where investor_id = ${investorId})`),
  dnaVersions: await n(sql`select count(*)::int as n from dna_hypothesis_versions v join dna_hypotheses h on h.id = v.dna_hypothesis_id where h.investor_id = ${investorId}`),
  dnaChecks: await n(sql`select count(*)::int as n from dna_evidence_grounding_checks c join dna_hypothesis_versions v on v.id = c.dna_hypothesis_version_id join dna_hypotheses h on h.id = v.dna_hypothesis_id where h.investor_id = ${investorId}`),
  strategyVersions: await n(sql`select count(*)::int as n from strategy_principle_versions v join strategy_principles p on p.id = v.strategy_principle_id where p.investor_id = ${investorId}`),
  strategyChecks: await n(sql`select count(*)::int as n from strategy_evidence_grounding_checks c join strategy_principle_versions v on v.id = c.strategy_principle_version_id join strategy_principles p on p.id = v.strategy_principle_id where p.investor_id = ${investorId}`),
});
const constraintOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { cause?: { constraint_name?: string; code?: string }; message?: string };
    return err.cause?.constraint_name ?? err.cause?.code ?? err.message ?? "unknown";
  }
};
/** supported unless the text is listed */
const gate = (unsupported: readonly string[] = []) => async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
  unsupported.includes(i.sourceAnswerText) ? { verdict: "unsupported", reason: "partial match: a required component is not established" } : { verdict: "supported", reason: "every component established" };

async function seed(label: string) {
  const investorId = await mkInvestor(db, label);
  const strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  const t1 = await mkTxn(db, investorId, "AAA", "buy", "2026-02-01", "10");
  const t2 = await mkTxn(db, investorId, "BBB", "buy", "2026-04-01", "10");
  const s = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
  const hold = await insertInterviewAnswer(db, { questionProvenance: "tell_me_why_legacy", interviewSessionId: s.id, transactionId: t1, questionText: Q_HOLD, answerText: A_HOLD });
  const sell = await insertInterviewAnswer(db, { questionProvenance: "tell_me_why_legacy", interviewSessionId: s.id, transactionId: t2, questionText: Q_SELL, answerText: A_SELL });
  const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "DDD", status: "decided" }).returning();
  const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker: "DDD", decisionType: "BUY", decisionDate: new Date("2026-08-01T00:00:00Z") });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", size: "500", userReasoningText: REASONING, risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: "AI text", portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  const independence = await loadIndependenceResolver(db, investorId);
  const answers = await getAllAnswersForInvestor(db, investorId);
  const statements = buildInvestorStatements(answers, await listDecisionStatementsForInvestor(db, investorId));
  const cites = [
    { interviewAnswerId: hold.id, decisionStatement: null, stance: "supporting" as const, description: "AI DESCRIPTION hold" },
    { interviewAnswerId: sell.id, decisionStatement: null, stance: "contradicting" as const, description: "AI DESCRIPTION sell" },
    { interviewAnswerId: null, decisionStatement: { decisionId: d.id, kind: "reasoning" as const }, stance: "supporting" as const, description: "AI DESCRIPTION reasoning" },
  ];
  const assessed = assessCitations(independence, cites);
  const identityInput = { statement: CLAIM, evidence: cites, supportingCount: assessed.supportingCount, contradictingCount: assessed.contradictingCount, evidenceStrength: assessed.evidenceStrength, independenceBasis: assessed.independenceBasis };
  return { investorId, independence, identityInput, textById: new Map(statements.map((x) => [x.id, x.text])), contextById: buildStatementContextById(answers), holdAnswerId: hold.id, sellAnswerId: sell.id, decisionId: d.id };
}
type World = Awaited<ReturnType<typeof seed>>;
type Raw = Awaited<ReturnType<typeof getEvidenceForDnaHypothesis>>;
const toRaw = (rows: Raw) => [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((e) => ({ id: e.id, interviewAnswerId: e.interviewAnswerId, decisionStatement: e.decisionId ? { decisionId: e.decisionId, kind: e.decisionStatementKind! } : null, stance: e.stance }));
const supportedOf = (checks: { evidenceId: string; verdict: string }[]) => (checks.length === 0 ? null : new Set(checks.filter((c) => c.verdict === "supported").map((c) => c.evidenceId)));
const run = (model = MODEL) => buildGroundingRun({ runId: randomUUID(), model });
const provenanceFor = (kind: "dna" | "strategy", revalidatedVersionId: string) =>
  buildProvenance({ generator: kind === "dna" ? "dna.remediateGrounding" : "strategy.remediateGrounding", model: MODEL, promptContracts: [AI_CONTRACTS.evidenceGrounding], sourceTypes: ["interview_answer", "decision_statement"], revalidatedVersionId, remediationReason: `${STANCE_SEMANTICS_VERSION}: supervised revalidation`, semanticRule: STANCE_SEMANTICS_VERSION });

async function dnaIdentity(w: World, priorChecks: "none" | "all-supported") {
  const { hypothesis, version } = await insertDnaHypothesisWithEvidence(db, w.investorId, w.identityInput);
  const raw = await getEvidenceForDnaHypothesis(db, hypothesis.id);
  if (priorChecks === "all-supported") await insertGroundingChecksForVersion(db, version.id, raw.map((r) => ({ evidenceId: r.id, verdict: "supported" as const, reason: "earlier contract" })));
  const checks = await getGroundingChecksForDnaHypothesisVersion(db, version.id);
  const plan = (g: ReturnType<typeof gate>) =>
    planGroundingRemediation({ currentVersion: { id: version.id, statementText: version.statementText }, rawEvidence: toRaw(raw), answerTextById: w.textById, independence: w.independence, alreadyGroundedEvidenceIds: supportedOf(checks), contextTextById: w.contextById }, g);
  return { hypothesis, version, raw, checks, plan };
}
async function strategyIdentity(w: World, priorChecks: "none") {
  const { principle, version } = await insertObservedPrincipleWithEvidence(db, w.investorId, w.identityInput);
  const raw = await getEvidenceForStrategyPrinciple(db, principle.id);
  const plan = (g: ReturnType<typeof gate>) =>
    planPrincipleGroundingRemediation({ currentVersion: { id: version.id, statementText: version.statementText, principleType: "observed" }, rawEvidence: toRaw(raw), answerTextById: w.textById, independence: w.independence, alreadyGroundedEvidenceIds: priorChecks === "none" ? null : new Set<string>(), contextTextById: w.contextById }, g);
  return { principle, version, raw, plan };
}

beforeAll(async () => {
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("migration 0018 on the scratch DB", () => {
  it("is the 19th migration and adds exactly one table and one enum", async () => {
    const ledger = (await db.execute(sql`select count(*)::int as n, max(created_at) as latest from drizzle.__drizzle_migrations`))[0] as { n: number; latest: string };
    const journal = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    // Unit 7C-B added 0019 after it; 0018 stays the 19th, and the ledger holds every journal entry.
    expect(journal.entries[18]).toMatchObject({ idx: 18, tag: "0018_grounding_judgments" });
    expect(ledger.n).toBe(journal.entries.length);
    expect(String(ledger.latest)).toBe(String(journal.entries.at(-1)!.when));
    const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).map((r) => r.table_name);
    expect(tables).toHaveLength(35);
    expect(tables).toContain("grounding_judgments");
    const values = await db.execute(sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'grounding_planner_action' order by enumsortorder`);
    expect(values.map((r) => r.enumlabel)).toEqual(["no_op", "checked_no_change", "new_version"]); // no technical_failure
    const verdicts = await db.execute(sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'grounding_verdict' order by enumsortorder`);
    expect(verdicts.map((r) => r.enumlabel)).toEqual(["supported", "unsupported"]);
  });

  it("has the columns, no text copy of any statement or question, and every constraint by name", async () => {
    const cols = await db.execute(sql`select column_name, udt_name, is_nullable from information_schema.columns where table_name = 'grounding_judgments' order by ordinal_position`);
    expect(cols.map((c) => `${c.column_name}:${c.udt_name}:${c.is_nullable}`)).toEqual([
      "id:uuid:NO", "run_id:uuid:NO", "dna_hypothesis_version_id:uuid:YES", "strategy_principle_version_id:uuid:YES", "evidence_id:uuid:NO",
      "verdict:grounding_verdict:NO", "reason:text:NO", "context_supplied:bool:NO", "contract:text:NO", "semantic_rule:text:NO", "model:text:NO", "code_version:text:YES",
      "planner_action:grounding_planner_action:NO", "resulting_dna_hypothesis_version_id:uuid:YES", "resulting_strategy_principle_version_id:uuid:YES", "judged_at:timestamptz:NO",
    ]);
    const cons = await db.execute(sql`select conname, contype, confdeltype, confupdtype from pg_constraint where conrelid = 'grounding_judgments'::regclass order by conname`);
    expect(cons.map((c) => `${c.conname}:${c.contype}`)).toEqual([
      "grounding_judgment_nonblank_run_metadata:c",
      "grounding_judgment_one_judged_version:c",
      "grounding_judgment_resulting_iff_new_version:c",
      "grounding_judgment_resulting_same_artifact:c",
      "grounding_judgment_run_evidence_unique:u",
      "grounding_judgments_dna_version_fk:f",
      "grounding_judgments_evidence_fk:f",
      "grounding_judgments_pkey:p",
      "grounding_judgments_resulting_dna_version_fk:f",
      "grounding_judgments_resulting_strategy_version_fk:f",
      "grounding_judgments_strategy_version_fk:f",
    ]);
    for (const c of cons.filter((x) => x.contype === "f")) expect([c.confdeltype, c.confupdtype]).toEqual(["a", "a"]); // no cascade: history is never removed through it
    const triggers = await db.execute(sql`select count(*)::int as n from pg_trigger where tgrelid = 'grounding_judgments'::regclass and not tgisinternal`);
    expect(Number(triggers[0]!.n)).toBe(0);
  });
});

describe("schema constraints", () => {
  it("rejects every malformed row by the named constraint and accepts a well-formed one", async () => {
    const w = await seed("odr9-constraints");
    const d = await dnaIdentity(w, "none");
    const s = await strategyIdentity(w, "none");
    const other = await insertDnaHypothesisWithEvidence(db, w.investorId, w.identityInput);
    const base = { runId: randomUUID(), dnaHypothesisVersionId: d.version.id, evidenceId: d.raw[0]!.id, verdict: "supported" as const, reason: "r", contextSupplied: false, contract: "c", semanticRule: "s", model: "m", plannerAction: "no_op" as const };
    const insert = (values: Record<string, unknown>) => () => db.insert(schema.groundingJudgments).values({ ...base, ...values } as typeof base);

    expect(await constraintOf(insert({ dnaHypothesisVersionId: null }))).toBe("grounding_judgment_one_judged_version");
    expect(await constraintOf(insert({ strategyPrincipleVersionId: s.version.id }))).toBe("grounding_judgment_one_judged_version");
    expect(await constraintOf(insert({ plannerAction: "new_version" }))).toBe("grounding_judgment_resulting_iff_new_version");
    expect(await constraintOf(insert({ resultingDnaHypothesisVersionId: other.version.id }))).toBe("grounding_judgment_resulting_iff_new_version");
    expect(await constraintOf(insert({ plannerAction: "checked_no_change", resultingDnaHypothesisVersionId: other.version.id }))).toBe("grounding_judgment_resulting_iff_new_version");
    expect(await constraintOf(insert({ plannerAction: "new_version", resultingDnaHypothesisVersionId: d.version.id }))).toBe("grounding_judgment_resulting_same_artifact");
    expect(await constraintOf(insert({ plannerAction: "new_version", resultingStrategyPrincipleVersionId: s.version.id }))).toBe("grounding_judgment_resulting_same_artifact");
    for (const blank of [{ reason: "  " }, { contract: "" }, { semanticRule: " " }, { model: "" }]) expect(await constraintOf(insert(blank))).toBe("grounding_judgment_nonblank_run_metadata");
    expect(await constraintOf(insert({ evidenceId: randomUUID() }))).toBe("grounding_judgments_evidence_fk");
    expect(await constraintOf(insert({ dnaHypothesisVersionId: randomUUID() }))).toBe("grounding_judgments_dna_version_fk");
    expect(await constraintOf(insert({ verdict: "technical_failure" }))).toBe("22P02"); // not a value of grounding_verdict
    expect(await constraintOf(insert({ plannerAction: "technical_failure" }))).toBe("22P02");

    expect(await constraintOf(insert({}))).toBeNull();
    expect(await constraintOf(insert({}))).toBe("grounding_judgment_run_evidence_unique"); // same run, same citation
    expect(await constraintOf(insert({ runId: randomUUID() }))).toBeNull(); // a later run is never blocked
  });
});

describe("no_op: the judgments are the one durable effect", () => {
  it("persists immutable judgments and nothing else; S/C, tier, visibility and effective evidence are unchanged", async () => {
    const w = await seed("odr9-noop");
    const d = await dnaIdentity(w, "all-supported");
    const plan = await d.plan(gate());
    expect(plan.action).toBe("no_op");
    const before = await counts(w.investorId);
    const effectiveBefore = await getEffectiveEvidenceForDnaHypothesisVersion(db, d.hypothesis.id, d.version.id);
    const countingBefore = await getCountingEvidenceForDnaVersion(db, d.hypothesis.id, d.version.id);
    const r = run();

    const result = await applyDnaGroundingRemediation(db, { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan, run: r, provenance: null });
    expect(result).toEqual({ action: "no_op", replayed: false, judgmentsWritten: 3, checkRowsWritten: 0, newVersionId: null });

    const after = await counts(w.investorId);
    expect(after).toEqual({ ...before, judgments: before.judgments + 3 }); // no version, no check row, no evidence row
    const latest = (await getLatestDnaHypothesisVersion(db, d.hypothesis.id))!;
    expect(latest).toEqual(d.version); // the same version, byte-identical: S/C and tier untouched
    expect(excludeInsufficientEvidence([latest])).toEqual(excludeInsufficientEvidence([d.version])); // visibility
    expect(await getGroundingChecksForDnaHypothesisVersion(db, d.version.id)).toEqual(d.checks);
    expect(await getEffectiveEvidenceForDnaHypothesisVersion(db, d.hypothesis.id, d.version.id)).toEqual(effectiveBefore);
    expect(await getCountingEvidenceForDnaVersion(db, d.hypothesis.id, d.version.id)).toEqual(countingBefore);
    expect(await getEvidenceForDnaHypothesis(db, d.hypothesis.id)).toEqual(d.raw);

    const rows = await listGroundingJudgmentsForRun(db, r.runId);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ runId: r.runId, dnaHypothesisVersionId: d.version.id, strategyPrincipleVersionId: null, verdict: "supported", reason: "every component established", contract: "evidence-grounding-v3-2-statements", semanticRule: "grounding-semantics-v3-2", model: MODEL, plannerAction: "no_op", resultingDnaHypothesisVersionId: null, resultingStrategyPrincipleVersionId: null });
    }
    const byEvidence = new Map(rows.map((x) => [x.evidenceId, x]));
    const evidenceOf = (answerId: string | null) => d.raw.find((e) => e.interviewAnswerId === answerId)!.id;
    expect(byEvidence.get(evidenceOf(w.holdAnswerId))!.contextSupplied).toBe(true);
    expect(byEvidence.get(evidenceOf(w.sellAnswerId))!.contextSupplied).toBe(true);
    expect(byEvidence.get(d.raw.find((e) => e.decisionId === w.decisionId)!.id)!.contextSupplied).toBe(false);
    // no copy of the investor's words or of the question
    const serialized = JSON.stringify(rows);
    for (const text of [A_HOLD, A_SELL, REASONING, Q_HOLD, Q_SELL, CLAIM]) expect(serialized).not.toContain(text);
  });

  it("an identical retry of the same run replays; a different verdict under the same run is refused; a later run is a new record", async () => {
    const w = await seed("odr9-noop-replay");
    const d = await dnaIdentity(w, "all-supported");
    const plan = await d.plan(gate());
    const r = run();
    const apply = (p: typeof plan, withRun = r) => applyDnaGroundingRemediation(db, { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan: p, run: withRun, provenance: null });
    await apply(plan);
    const before = await counts(w.investorId);
    const rowsBefore = await listGroundingJudgmentsForRun(db, r.runId);

    expect(await apply(plan)).toEqual({ action: "no_op", replayed: true, judgmentsWritten: 0, checkRowsWritten: 0, newVersionId: null });
    expect(await counts(w.investorId)).toEqual(before);

    if (plan.action !== "no_op") throw new Error("expected no_op");
    const tampered = { ...plan, judgments: plan.judgments.map((j, i) => (i === 0 ? { ...j, reason: "a different reason" } : j)) };
    await expect(apply(tampered)).rejects.toBeInstanceOf(GroundingJudgmentConflictError);
    const partial = { ...plan, judgments: plan.judgments.slice(0, 2) };
    await expect(apply(partial)).rejects.toBeInstanceOf(GroundingJudgmentConflictError);
    await expect(apply(plan, { ...r, model: "another-model" })).rejects.toBeInstanceOf(GroundingJudgmentConflictError);
    expect(await counts(w.investorId)).toEqual(before);
    expect(await listGroundingJudgmentsForRun(db, r.runId)).toEqual(rowsBefore); // never updated

    const later = run();
    expect((await apply(plan, later)).judgmentsWritten).toBe(3);
    expect(await listGroundingJudgmentsForRun(db, later.runId)).toHaveLength(3);
    expect(await listGroundingJudgmentsForRun(db, r.runId)).toEqual(rowsBefore);
  });
});

describe("new_version: the audit rows and the semantic writes belong to one run and one transaction", () => {
  it("writes the version, its checks and the judgments together; historical rows untouched; a rerun of the run cannot duplicate", async () => {
    const w = await seed("odr9-newversion");
    const d = await dnaIdentity(w, "all-supported");
    const plan = await d.plan(gate([A_SELL]));
    expect(plan.action).toBe("new_version");
    const before = await counts(w.investorId);
    const r = run();
    const input = { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan, run: r, provenance: provenanceFor("dna", d.version.id) };

    const result = await applyDnaGroundingRemediation(db, input);
    expect(result).toMatchObject({ action: "new_version", replayed: false, judgmentsWritten: 3, checkRowsWritten: 3 });
    const v2 = (await getLatestDnaHypothesisVersion(db, d.hypothesis.id))!;
    expect(result.newVersionId).toBe(v2.id);
    expect(v2).toMatchObject({ versionNumber: 2, createdBy: "system_grounding_revalidation", statementText: d.version.statementText, contradictingEvidenceCount: 0 });
    expect(v2.provenanceJson).toMatchObject({ generator: "dna.remediateGrounding", promptContracts: ["evidence-grounding-v3-2-statements"], semanticRule: "grounding-semantics-v3-2", revalidatedVersionId: d.version.id, model: MODEL });
    expect(await counts(w.investorId)).toEqual({ ...before, judgments: before.judgments + 3, dnaVersions: before.dnaVersions + 1, dnaChecks: before.dnaChecks + 3 });

    // attributable to the same run: judged version -> resulting version, and each judgment equals the check written for it
    const rows = await listGroundingJudgmentsForRun(db, r.runId);
    const checksV2 = await getGroundingChecksForDnaHypothesisVersion(db, v2.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ dnaHypothesisVersionId: d.version.id, resultingDnaHypothesisVersionId: v2.id, plannerAction: "new_version" });
      expect(checksV2.find((c) => c.evidenceId === row.evidenceId)).toMatchObject({ verdict: row.verdict, reason: row.reason });
    }
    expect(rows.filter((x) => x.verdict === "unsupported").map((x) => x.evidenceId)).toEqual([d.raw.find((e) => e.interviewAnswerId === w.sellAnswerId)!.id]);

    // history untouched
    expect(await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq: e }) => e(v.id, d.version.id) })).toEqual(d.version);
    expect(await getGroundingChecksForDnaHypothesisVersion(db, d.version.id)).toEqual(d.checks);
    expect(await getEvidenceForDnaHypothesis(db, d.hypothesis.id)).toEqual(d.raw);

    // rerun with the same authorized run identity: nothing is written twice, no third version
    const after = await counts(w.investorId);
    expect(await applyDnaGroundingRemediation(db, input)).toEqual({ action: "new_version", replayed: true, judgmentsWritten: 0, checkRowsWritten: 0, newVersionId: v2.id });
    expect(await counts(w.investorId)).toEqual(after);
    expect((await getLatestDnaHypothesisVersion(db, d.hypothesis.id))!.id).toBe(v2.id);
  });

  it("Strategy, checked_no_change: check rows on the judged version and the judgments, in one transaction", async () => {
    const w = await seed("odr9-strategy");
    const s = await strategyIdentity(w, "none");
    const plan = await s.plan(gate());
    expect(plan.action).toBe("checked_no_change");
    const before = await counts(w.investorId);
    const r = run();
    const result = await applyStrategyGroundingRemediation(db, { strategyPrincipleId: s.principle.id, judgedVersionId: s.version.id, plan, run: r, provenance: null });
    expect(result).toEqual({ action: "checked_no_change", replayed: false, judgmentsWritten: 3, checkRowsWritten: 3, newVersionId: null });
    expect(await counts(w.investorId)).toEqual({ ...before, judgments: before.judgments + 3, strategyChecks: before.strategyChecks + 3 });
    expect((await getLatestStrategyPrincipleVersion(db, s.principle.id))!).toEqual(s.version);
    const rows = await listGroundingJudgmentsForRun(db, r.runId);
    for (const row of rows) expect(row).toMatchObject({ strategyPrincipleVersionId: s.version.id, dnaHypothesisVersionId: null, plannerAction: "checked_no_change", resultingStrategyPrincipleVersionId: null });
    expect((await getGroundingChecksForStrategyPrincipleVersion(db, s.version.id)).map((c) => c.evidenceId).sort()).toEqual(rows.map((x) => x.evidenceId).sort());
  });

  it("Strategy, new_version: the mirror of the DNA path", async () => {
    const w = await seed("odr9-strategy-new");
    const s = await strategyIdentity(w, "none");
    const plan = await s.plan(gate([A_SELL]));
    expect(plan.action).toBe("new_version");
    const r = run();
    const result = await applyStrategyGroundingRemediation(db, { strategyPrincipleId: s.principle.id, judgedVersionId: s.version.id, plan, run: r, provenance: provenanceFor("strategy", s.version.id) });
    const v2 = (await getLatestStrategyPrincipleVersion(db, s.principle.id))!;
    expect(result).toEqual({ action: "new_version", replayed: false, judgmentsWritten: 3, checkRowsWritten: 3, newVersionId: v2.id });
    expect(v2).toMatchObject({ versionNumber: 2, principleType: "observed", createdBy: "system_grounding_revalidation" });
    for (const row of await listGroundingJudgmentsForRun(db, r.runId)) expect(row).toMatchObject({ strategyPrincipleVersionId: s.version.id, resultingStrategyPrincipleVersionId: v2.id, resultingDnaHypothesisVersionId: null });
    expect(await getEffectiveEvidenceForStrategyPrincipleVersion(db, s.principle.id, v2.id)).toHaveLength(2);
  });
});

describe("fail closed: nothing partial is ever written", () => {
  it("technical failure: no judgment, no version, no check — and never recorded as unsupported", async () => {
    const w = await seed("odr9-technical");
    const d = await dnaIdentity(w, "all-supported");
    const s = await strategyIdentity(w, "none");
    const failing = async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
      i.sourceAnswerText === REASONING ? { verdict: "unsupported", reason: "Grounding check call failed — failing closed.", technicalFailure: true } : { verdict: "supported", reason: "ok" };
    const dnaPlan = await d.plan(failing);
    const strategyPlan = await s.plan(failing);
    expect([dnaPlan.action, strategyPlan.action]).toEqual(["technical_failure", "technical_failure"]);
    const before = await counts(w.investorId);
    const r = run();
    await expect(applyDnaGroundingRemediation(db, { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan: dnaPlan, run: r, provenance: null })).rejects.toBeInstanceOf(GroundingTechnicalFailureError);
    await expect(applyStrategyGroundingRemediation(db, { strategyPrincipleId: s.principle.id, judgedVersionId: s.version.id, plan: strategyPlan, run: r, provenance: null })).rejects.toBeInstanceOf(GroundingTechnicalFailureError);
    expect(await counts(w.investorId)).toEqual(before);
    expect(await listGroundingJudgmentsForRun(db, r.runId)).toEqual([]);
  });

  it("transaction rollback: if the judgments cannot be written, the version and its checks are not written either", async () => {
    const w = await seed("odr9-rollback");
    const d = await dnaIdentity(w, "all-supported");
    const s = await strategyIdentity(w, "none");
    // a blank reason passes the check table and violates the ledger's CHECK — the failure happens AFTER the semantic insert
    const plan = await d.plan(async (i) => (i.sourceAnswerText === A_SELL ? { verdict: "unsupported", reason: "   " } : { verdict: "supported", reason: "ok" }));
    expect(plan.action).toBe("new_version");
    const before = await counts(w.investorId);
    const r = run();
    expect(await constraintOf(() => applyDnaGroundingRemediation(db, { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan, run: r, provenance: provenanceFor("dna", d.version.id) }))).toBe("grounding_judgment_nonblank_run_metadata");
    expect(await counts(w.investorId)).toEqual(before);
    expect((await getLatestDnaHypothesisVersion(db, d.hypothesis.id))!.id).toBe(d.version.id);
    expect(await listGroundingJudgmentsForRun(db, r.runId)).toEqual([]);

    // and the mirror: a checked_no_change whose judgments fail leaves no check row behind
    const sPlan = await s.plan(async () => ({ verdict: "supported", reason: " " }));
    expect(sPlan.action).toBe("checked_no_change");
    expect(await constraintOf(() => applyStrategyGroundingRemediation(db, { strategyPrincipleId: s.principle.id, judgedVersionId: s.version.id, plan: sPlan, run: r, provenance: null }))).toBe("grounding_judgment_nonblank_run_metadata");
    expect(await counts(w.investorId)).toEqual(before);
    expect(await getGroundingChecksForStrategyPrincipleVersion(db, s.version.id)).toEqual([]);
  });

  it("stale state, foreign evidence, a mismatching check and a mismatching run are refused with nothing written", async () => {
    const w = await seed("odr9-guards");
    const d = await dnaIdentity(w, "all-supported");
    const other = await dnaIdentity(w, "all-supported");
    const noOp = await d.plan(gate());
    const newVersion = await d.plan(gate([A_SELL]));
    if (noOp.action !== "no_op" || newVersion.action !== "new_version") throw new Error("unexpected plan");
    const before = await counts(w.investorId);
    const r = run();
    const apply = (over: Partial<Parameters<typeof applyDnaGroundingRemediation>[1]>) => applyDnaGroundingRemediation(db, { dnaHypothesisId: d.hypothesis.id, judgedVersionId: d.version.id, plan: noOp, run: r, provenance: null, ...over });

    await expect(apply({ judgedVersionId: other.version.id })).rejects.toBeInstanceOf(StaleIdentityVersionError); // not this identity's latest version
    await expect(apply({ plan: { ...noOp, judgments: [{ ...noOp.judgments[0]!, evidenceId: other.raw[0]!.id }] } })).rejects.toBeInstanceOf(GroundingJudgmentConflictError); // another identity's citation
    await expect(apply({ plan: { ...noOp, judgments: [noOp.judgments[0]!, noOp.judgments[0]!] } })).rejects.toBeInstanceOf(GroundingJudgmentConflictError); // judged twice
    await expect(apply({ plan: { ...newVersion, judgments: newVersion.judgments.map((j) => ({ ...j, verdict: "supported" as const })) } })).rejects.toBeInstanceOf(GroundingJudgmentConflictError); // judgment != check
    expect(await counts(w.investorId)).toEqual(before);

    // the run id already belongs to another contract / model: refused for a DIFFERENT identity too
    await apply({});
    const afterFirst = await counts(w.investorId);
    const otherPlan = await other.plan(gate());
    for (const mismatch of [{ model: "another-model" }, { contract: "evidence-grounding-v3-1-statements" }, { semanticRule: "grounding-semantics-v3-1" }, { codeVersion: "another-commit" }]) {
      await expect(applyDnaGroundingRemediation(db, { dnaHypothesisId: other.hypothesis.id, judgedVersionId: other.version.id, plan: otherPlan, run: { ...r, ...mismatch }, provenance: null })).rejects.toBeInstanceOf(GroundingRunMismatchError);
    }
    expect(await counts(w.investorId)).toEqual(afterFirst);

    // a plan judged against v1 is stale once v2 exists
    const r2 = run();
    await applyDnaGroundingRemediation(db, { dnaHypothesisId: other.hypothesis.id, judgedVersionId: other.version.id, plan: await other.plan(gate([A_SELL])), run: r2, provenance: provenanceFor("dna", other.version.id) });
    const afterV2 = await counts(w.investorId);
    await expect(applyDnaGroundingRemediation(db, { dnaHypothesisId: other.hypothesis.id, judgedVersionId: other.version.id, plan: otherPlan, run: run(), provenance: null })).rejects.toBeInstanceOf(StaleIdentityVersionError);
    expect(await counts(w.investorId)).toEqual(afterV2);
  });
});

describe("a run across several identities", () => {
  it("applies each identity in its own transaction: a failure in one leaves the others complete and the run reports exactly which completed", async () => {
    const w = await seed("odr9-run");
    const a = await dnaIdentity(w, "all-supported");
    const b = await dnaIdentity(w, "all-supported");
    const c = await strategyIdentity(w, "none");
    // plan ALL first — planning writes nothing
    const before = await counts(w.investorId);
    const plans = { a: await a.plan(gate()), b: await b.plan(gate([A_SELL])), c: await c.plan(gate()) };
    expect(await counts(w.investorId)).toEqual(before);
    expect([plans.a.action, plans.b.action, plans.c.action]).toEqual(["no_op", "new_version", "checked_no_change"]);

    const r = run();
    await applyDnaGroundingRemediation(db, { dnaHypothesisId: a.hypothesis.id, judgedVersionId: a.version.id, plan: plans.a, run: r, provenance: null });
    // identity b changed after planning (another writer appended a version): its apply is refused
    await db.insert(schema.dnaHypothesisVersions).values({ dnaHypothesisId: b.hypothesis.id, versionNumber: 2, statementText: b.version.statementText, evidenceStrength: "insufficient_evidence", supportingEvidenceCount: 0, contradictingEvidenceCount: 0, createdBy: "ai_generated" });
    await expect(applyDnaGroundingRemediation(db, { dnaHypothesisId: b.hypothesis.id, judgedVersionId: b.version.id, plan: plans.b, run: r, provenance: provenanceFor("dna", b.version.id) })).rejects.toBeInstanceOf(StaleIdentityVersionError);
    await applyStrategyGroundingRemediation(db, { strategyPrincipleId: c.principle.id, judgedVersionId: c.version.id, plan: plans.c, run: r, provenance: null });

    const rows = await listGroundingJudgmentsForRun(db, r.runId);
    expect(rows).toHaveLength(6);
    expect([...new Set(rows.map((x) => x.dnaHypothesisVersionId ?? x.strategyPrincipleVersionId))].sort()).toEqual([a.version.id, c.version.id].sort()); // b is absent: it did not complete
    expect(new Set(rows.map((x) => `${x.contract}|${x.semanticRule}|${x.model}|${x.codeVersion}`)).size).toBe(1);
    expect(await db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, b.hypothesis.id))).toHaveLength(2); // only the other writer's version
    expect(await getGroundingChecksForStrategyPrincipleVersion(db, c.version.id)).toHaveLength(3);
  });
});

describe("the ledger is never a semantic input", () => {
  it("an audit row that disagrees with the check rows changes nothing any semantic reader returns", async () => {
    const w = await seed("odr9-isolation");
    const d = await dnaIdentity(w, "all-supported");
    const s = await strategyIdentity(w, "none");
    const read = async () => ({
      effectiveDna: await getEffectiveEvidenceForDnaHypothesisVersion(db, d.hypothesis.id, d.version.id),
      countingDna: await getCountingEvidenceForDnaVersion(db, d.hypothesis.id, d.version.id),
      checksDna: await getGroundingChecksForDnaHypothesisVersion(db, d.version.id),
      rawDna: await getEvidenceForDnaHypothesis(db, d.hypothesis.id),
      latestDna: await getLatestDnaHypothesisVersion(db, d.hypothesis.id),
      effectiveStrategy: await getEffectiveEvidenceForStrategyPrincipleVersion(db, s.principle.id, s.version.id),
      latestStrategy: await getLatestStrategyPrincipleVersion(db, s.principle.id),
      replanDna: await d.plan(gate()),
    });
    const before = await read();
    // hostile audit rows: every citation "unsupported" — the opposite of the persisted checks
    await db.insert(schema.groundingJudgments).values([
      ...d.raw.map((e) => ({ runId: randomUUID(), dnaHypothesisVersionId: d.version.id, evidenceId: e.id, verdict: "unsupported" as const, reason: "hostile", contextSupplied: false, contract: "c", semanticRule: "s", model: "m", plannerAction: "no_op" as const })),
      ...s.raw.map((e) => ({ runId: randomUUID(), strategyPrincipleVersionId: s.version.id, evidenceId: e.id, verdict: "unsupported" as const, reason: "hostile", contextSupplied: false, contract: "c", semanticRule: "s", model: "m", plannerAction: "no_op" as const })),
    ]);
    expect(await read()).toEqual(before);
  });
});
