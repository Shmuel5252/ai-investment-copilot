// Decision Independence V1 — the independence recalculation against real
// Postgres: the read-only plan, the transactional append, historical
// immutability (versions, evidence, grounding checks, Strategy bundles,
// DecisionSnapshots), idempotency, the directional guard and concurrency.
//
// Migration rule: needs migration 0011. On a database without it these
// SKIP with an explicit reason instead of failing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { recalculateDnaHypothesisIndependence, getLatestDnaHypothesisVersion } from "@/db/repositories/dna";
import { getLatestStrategyPrincipleVersion } from "@/db/repositories/strategy";
import { getEffectiveEvidenceForDnaHypothesisVersion } from "@/db/repositories/evidence";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { insertThesis, insertDecision, insertDecisionSnapshot } from "@/db/repositories/decisions";
import {
  applyIndependenceRecalculationsForInvestor,
  planIndependenceRecalculationsForInvestor,
} from "@/db/repositories/independence-recalculation";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { serializeIndependenceBasis, type IndependenceBasis } from "@/lib/evidence/resolve-independence";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });

let migrationApplied = false;
const SKIP_REASON = "migration 0011 (independence_basis_json / transaction_link_facts) not applied to this database yet";

interface World {
  investorId: string;
  answers: Record<string, string>;
  txns: Record<string, string>;
  h1: string; // DNA reallocation claim (legacy S=2, two effective + one grounding-excluded citation)
  h2: string; // DNA unrelated pair (legacy S=2, genuinely independent)
  p1: string; // Strategy observed reallocation claim (legacy S=2)
  p2: string; // Strategy declared principle (no tier)
  h1v1: string;
  p1v1: string;
  strategyVersionId: string;
  decisionId: string;
}
let w: World;

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function mkInvestor(label: string) {
  return (await db.insert(schema.investors).values({ email: `indep-recalc-${label}-${uniq()}@example.com`, passwordHash: "x", displayName: label }).returning())[0]!.id;
}
async function mkTxn(investorId: string, ticker: string, type: "buy" | "sell", date: string, qty: string) {
  const [row] = await db
    .insert(schema.transactions)
    .values({
      investorId,
      ticker,
      transactionType: type,
      quantity: qty,
      price: "10",
      amount: type === "buy" ? `-${Number(qty) * 10}` : `${Number(qty) * 10}`,
      transactionDate: new Date(date),
      source: "manual_entry",
    })
    .returning();
  return row!.id;
}
async function mkDnaIdentity(investorId: string, statement: string, S: number, C: number, tier: "insufficient_evidence" | "moderate", citations: { answerId: string; stance: "supporting" | "contradicting"; supported: boolean }[]) {
  const [h] = await db.insert(schema.dnaHypotheses).values({ investorId }).returning();
  // A LEGACY version: written before the resolver existed, so the basis is NULL.
  const [v1] = await db.insert(schema.dnaHypothesisVersions).values({ dnaHypothesisId: h!.id, versionNumber: 1, statementText: statement, evidenceStrength: tier, supportingEvidenceCount: S, contradictingEvidenceCount: C, createdBy: "ai_generated" }).returning();
  const evRows = await db.insert(schema.evidence).values(citations.map((c) => ({ dnaHypothesisId: h!.id, stance: c.stance, interviewAnswerId: c.answerId, description: "d" }))).returning();
  if (citations.some((c) => !c.supported)) {
    await db.insert(schema.dnaEvidenceGroundingChecks).values(evRows.map((e, i) => ({ dnaHypothesisVersionId: v1!.id, evidenceId: e.id, verdict: citations[i]!.supported ? ("supported" as const) : ("unsupported" as const), reason: "seeded check" })));
  }
  return { id: h!.id, v1: v1! };
}

beforeAll(async () => {
  const probe = await client`select to_regclass('public.transaction_link_facts') as t, (select count(*) from information_schema.columns where table_name = 'dna_hypothesis_versions' and column_name = 'independence_basis_json')::int as c`;
  migrationApplied = probe[0]?.t !== null && probe[0]?.c === 1;
  if (!migrationApplied) return;

  const investorId = await mkInvestor("main");
  const txns = {
    mpBuy: await mkTxn(investorId, "MP", "buy", "2026-08-05", "20"),
    mpSell1: await mkTxn(investorId, "MP", "sell", "2026-08-24", "12"),
    mpSell2: await mkTxn(investorId, "MP", "sell", "2026-08-28", "8"),
    mrvlBuy: await mkTxn(investorId, "MRVL", "buy", "2026-08-28", "4"),
    canSell: await mkTxn(investorId, "CAN", "sell", "2026-04-09", "5"),
    spcxBuy: await mkTxn(investorId, "SPCX", "buy", "2026-06-26", "3"),
  };
  const session = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
  const ans = async (txn: string, text: string) => (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: txn, questionText: "Q", answerText: text })).id;
  const answers = {
    mpBuy: await ans(txns.mpBuy, "נכנסתי ל-MP בגלל הסיפור"),
    mpSell2: await ans(txns.mpSell2, "מכרתי את היתרה כדי לפנות כסף לקנייה של MRVL"),
    mrvlBuy: await ans(txns.mrvlBuy, "כדי לפנות כסף מכרתי את היתרה ב־MP"),
    can: await ans(txns.canSell, "הפסד קטן, העדפתי כסף בחברות אחרות"),
    spcx: await ans(txns.spcxBuy, "הנפקה גדולה"),
  };

  const h1 = await mkDnaIdentity(investorId, "אתה נוטה למכור פוזיציה מרוויחה כשמתעוררת הזדמנות חדשה.", 2, 0, "insufficient_evidence", [
    { answerId: answers.mpSell2, stance: "supporting", supported: true },
    { answerId: answers.mrvlBuy, stance: "supporting", supported: true },
    { answerId: answers.can, stance: "supporting", supported: false }, // excluded by grounding at v1
  ]);
  const h2 = await mkDnaIdentity(investorId, "אתה נוטה לפעול על סיפור גדול.", 2, 0, "insufficient_evidence", [
    { answerId: answers.can, stance: "supporting", supported: true },
    { answerId: answers.spcx, stance: "supporting", supported: true },
  ]);

  const [p1] = await db.insert(schema.strategyPrinciples).values({ investorId, key: `realloc-${uniq()}` }).returning();
  const [p1v1] = await db.insert(schema.strategyPrincipleVersions).values({ strategyPrincipleId: p1!.id, versionNumber: 1, principleType: "observed", statementText: "אתה נוטה לסגור פוזיציה מרוויחה.", rationaleText: "Observed as a pattern across your interview answers, not stated directly.", createdBy: "ai_observed", evidenceStrength: "insufficient_evidence", supportingEvidenceCount: 2, contradictingEvidenceCount: 0 }).returning();
  await db.insert(schema.evidence).values([answers.mpSell2, answers.mrvlBuy].map((a) => ({ strategyPrincipleId: p1!.id, stance: "supporting" as const, interviewAnswerId: a, description: "d" })));

  const [p2] = await db.insert(schema.strategyPrinciples).values({ investorId, key: `declared-${uniq()}` }).returning();
  await db.insert(schema.strategyPrincipleVersions).values({ strategyPrincipleId: p2!.id, versionNumber: 1, principleType: "declared", statementText: "I avoid leverage.", rationaleText: "declared", createdBy: "user_declared" });

  // A Strategy BUNDLE approving P1.v1, and a DecisionSnapshot that froze DNA H1.v1 under it.
  const [bundle] = await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "initial" }).returning();
  await db.insert(schema.strategyVersionPrinciples).values({ strategyVersionId: bundle!.id, strategyPrincipleVersionId: p1v1!.id });
  const [investmentCase] = await db.insert(schema.investmentCases).values({ investorId, ticker: "MRVL" }).returning();
  const [marketContext] = await db.insert(schema.marketContexts).values({ source: "test" }).returning();
  const thesis = await insertThesis(db, { thesisText: `indep-recalc thesis ${uniq()}` });
  const decision = await insertDecision(db, { investorId, investmentCaseId: investmentCase!.id, ticker: "MRVL", decisionType: "BUY", decisionDate: new Date("2026-08-28") });
  await insertDecisionSnapshot(db, { decisionId: decision.id, priceAtDecision: "220", userReasoningText: "reallocating", portfolioStateJson: { positions: [], cash: 0 }, marketContextId: marketContext!.id, strategyVersionId: bundle!.id, thesisId: thesis.id, investmentCaseSnapshotJson: {} }, [h1.v1.id]);

  w = { investorId, answers, txns, h1: h1.id, h2: h2.id, p1: p1!.id, p2: p2!.id, h1v1: h1.v1.id, p1v1: p1v1!.id, strategyVersionId: bundle!.id, decisionId: decision.id };
});

afterAll(async () => {
  await client.end();
});

// Byte-level snapshots of everything history-bearing for this investor.
async function historicalSnapshot() {
  const rows = async (query: PromiseLike<Record<string, unknown>[]>) => (await query).map((r) => JSON.stringify(r.j)).sort();
  const id = w.investorId;
  return {
    dnaV1: await rows(client`select row_to_json(v) j from dna_hypothesis_versions v join dna_hypotheses h on h.id = v.dna_hypothesis_id where h.investor_id = ${id} and v.version_number = 1`),
    strategyV1: await rows(client`select row_to_json(v) j from strategy_principle_versions v join strategy_principles p on p.id = v.strategy_principle_id where p.investor_id = ${id} and v.version_number = 1`),
    evidence: await rows(client`select row_to_json(e) j from evidence e where e.dna_hypothesis_id in (select id from dna_hypotheses where investor_id = ${id}) or e.strategy_principle_id in (select id from strategy_principles where investor_id = ${id})`),
    dnaChecksV1: await rows(client`select row_to_json(c) j from dna_evidence_grounding_checks c where c.dna_hypothesis_version_id in (select v.id from dna_hypothesis_versions v join dna_hypotheses h on h.id = v.dna_hypothesis_id where h.investor_id = ${id} and v.version_number = 1)`),
    bundles: await rows(client`select row_to_json(b) j from strategy_versions b where b.investor_id = ${id}`),
    bundlePrinciples: await rows(client`select row_to_json(x) j from strategy_version_principles x where x.strategy_version_id in (select id from strategy_versions where investor_id = ${id})`),
    snapshots: await rows(client`select row_to_json(s) j from decision_snapshots s join decisions d on d.id = s.decision_id where d.investor_id = ${id}`),
    snapshotDnaRefs: await rows(client`select row_to_json(r) j from decision_snapshot_dna_references r where r.decision_snapshot_id in (select s.id from decision_snapshots s join decisions d on d.id = s.decision_id where d.investor_id = ${id})`),
    transactions: await rows(client`select row_to_json(t) j from transactions t where t.investor_id = ${id}`),
    answers: await rows(client`select row_to_json(a) j from interview_answers a join interview_sessions s on s.id = a.interview_session_id where s.investor_id = ${id}`),
  };
}
const versionCounts = async () => ({
  dna: (await client`select count(*)::int c from dna_hypothesis_versions v join dna_hypotheses h on h.id = v.dna_hypothesis_id where h.investor_id = ${w.investorId}`)[0]!.c as number,
  strategy: (await client`select count(*)::int c from strategy_principle_versions v join strategy_principles p on p.id = v.strategy_principle_id where p.investor_id = ${w.investorId}`)[0]!.c as number,
});

describe("the read-only plan on a legacy world (the real MP -> MRVL shape)", () => {
  it("plans EXACTLY the two reallocation identities and nothing else; tiers unchanged; the dry run writes nothing", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const before = { history: await historicalSnapshot(), counts: await versionCounts() };

    const report = await planIndependenceRecalculationsForInvestor(db, w.investorId);
    expect(report).toHaveLength(4);
    const planned = report.filter((r) => r.plan.action === "append_independence_version");
    expect(planned.map((r) => `${r.domain}:${r.identityId}`).sort()).toEqual([`dna:${w.h1}`, `strategy:${w.p1}`].sort());
    for (const item of planned) {
      if (item.plan.action !== "append_independence_version") continue;
      expect(item.storedSupporting).toBe(2);
      expect(item.plan.supportingEvidenceCount).toBe(1);
      expect(item.plan.contradictingEvidenceCount).toBe(0);
      expect(item.plan.storedTier).toBe("insufficient_evidence");
      expect(item.plan.recomputedTier).toBe("insufficient_evidence");
      expect(item.plan.independenceBasis.supportingUpper).toBe(2);
      expect(item.proposedProvenance).toBe("system_independence_recalculation");
    }
    // H1's effective evidence is the two grounded citations, not the excluded third.
    expect(report.find((r) => r.identityId === w.h1)!.effectiveEvidenceIds).toHaveLength(2);

    const others = report.filter((r) => r.plan.action !== "append_independence_version");
    expect(others.map((r) => (r.plan.action === "no_op" ? r.plan.reason : r.plan.action)).sort()).toEqual(["counts_unchanged", "not_tiered"]);

    expect(await historicalSnapshot()).toEqual(before.history);
    expect(await versionCounts()).toEqual(before.counts);
  });
});

describe("apply", () => {
  it("22/23. appends exactly the two planned versions; every historical row, bundle and DecisionSnapshot stays byte-identical", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const before = { history: await historicalSnapshot(), counts: await versionCounts() };

    const results = await applyIndependenceRecalculationsForInvestor(db, w.investorId);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome.action === "appended")).toBe(true);

    // ---- what changed: one new version each, nothing else -------------
    const counts = await versionCounts();
    expect(counts).toEqual({ dna: before.counts.dna + 1, strategy: before.counts.strategy + 1 });

    const h1v2 = (await getLatestDnaHypothesisVersion(db, w.h1))!;
    expect(h1v2.versionNumber).toBe(2);
    expect(h1v2.createdBy).toBe("system_independence_recalculation");
    expect(h1v2.supportingEvidenceCount).toBe(1);
    expect(h1v2.contradictingEvidenceCount).toBe(0);
    expect(h1v2.evidenceStrength).toBe("insufficient_evidence");
    expect(h1v2.statementText).toBe("אתה נוטה למכור פוזיציה מרוויחה כשמתעוררת הזדמנות חדשה.");
    const basis = h1v2.independenceBasisJson as IndependenceBasis;
    expect(basis.policyVersion).toBe("independence-policy-v2");
    expect(basis.supportingLower).toBe(1);
    expect(basis.supportingUpper).toBe(2);
    expect(basis.exact).toBe(false);
    expect(basis.weakEdges).toHaveLength(1);
    expect(h1v2.changeReason).toMatch(/^Decision Independence \(independence-policy-v2\)/);

    const p1v2 = (await getLatestStrategyPrincipleVersion(db, w.p1))!;
    expect(p1v2.versionNumber).toBe(2);
    expect(p1v2.createdBy).toBe("system_independence_recalculation");
    expect(p1v2.principleType).toBe("observed");
    expect(p1v2.supportingEvidenceCount).toBe(1);
    // The stored basis is byte-identical (canonical) to a fresh resolution over the same effective evidence.
    const resolver = await loadIndependenceResolver(db, w.investorId);
    const fresh = resolver.resolve([{ interviewAnswerId: w.answers.mpSell2!, stance: "supporting" }, { interviewAnswerId: w.answers.mrvlBuy!, stance: "supporting" }]);
    expect(serializeIndependenceBasis(p1v2.independenceBasisJson as IndependenceBasis)).toBe(serializeIndependenceBasis(fresh));

    // Grounding checks are carried forward, so the effective evidence set cannot change.
    const v2Checks = await client`select verdict, reason from dna_evidence_grounding_checks where dna_hypothesis_version_id = ${h1v2.id} order by verdict`;
    expect(v2Checks).toHaveLength(3);
    expect(v2Checks.every((c) => String(c.reason).startsWith("Carried forward unchanged from version"))).toBe(true);
    const effectiveV1 = (await getEffectiveEvidenceForDnaHypothesisVersion(db, w.h1, w.h1v1)).map((e) => e.id).sort();
    const effectiveV2 = (await getEffectiveEvidenceForDnaHypothesisVersion(db, w.h1, h1v2.id)).map((e) => e.id).sort();
    expect(effectiveV2).toEqual(effectiveV1);
    expect(effectiveV2).toHaveLength(2);

    // ---- what did NOT change: v1 rows, evidence, checks, bundles, snapshots, transactions, answers ----
    expect(await historicalSnapshot()).toEqual(before.history);

    // The frozen DecisionSnapshot still points at the ORIGINAL DNA version, and the bundle at the original principle version.
    const refs = await client`select dna_hypothesis_version_id from decision_snapshot_dna_references r join decision_snapshots s on s.id = r.decision_snapshot_id where s.decision_id = ${w.decisionId}`;
    expect(refs.map((r) => r.dna_hypothesis_version_id)).toEqual([w.h1v1]);
    const bundlePrinciples = await client`select strategy_principle_version_id from strategy_version_principles where strategy_version_id = ${w.strategyVersionId}`;
    expect(bundlePrinciples.map((r) => r.strategy_principle_version_id)).toEqual([w.p1v1]);
  });

  it("is idempotent: a second plan is all no-ops and a second apply writes nothing", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const before = await versionCounts();
    const report = await planIndependenceRecalculationsForInvestor(db, w.investorId);
    expect(report.filter((r) => r.plan.action !== "no_op")).toEqual([]);
    expect(await applyIndependenceRecalculationsForInvestor(db, w.investorId)).toEqual([]);
    expect(await versionCounts()).toEqual(before);
  });

  it("never touches the unaffected identities (unrelated DNA pair, declared principle)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const h2Versions = await client`select count(*)::int c from dna_hypothesis_versions where dna_hypothesis_id = ${w.h2}`;
    const p2Versions = await client`select count(*)::int c from strategy_principle_versions where strategy_principle_id = ${w.p2}`;
    expect(h2Versions[0]!.c).toBe(1);
    expect(p2Versions[0]!.c).toBe(1);
  });
});

describe("20/21. the directional guard at the database level", () => {
  let investorB: string;
  let hB: string;

  beforeAll(async () => {
    if (!migrationApplied) return;
    investorB = await mkInvestor("backfill");
    const sell = await mkTxn(investorB, "AAA", "sell", "2026-05-10", "5");
    const buy = await mkTxn(investorB, "BBB", "buy", "2026-05-12", "5");
    const session = await insertInterviewSession(db, { investorId: investorB, origin: "user_initiated" });
    // No ticker is named, so isolation is the only corroboration.
    const a = (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: sell, questionText: "Q", answerText: "sold it" })).id;
    const b = (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: buy, questionText: "Q", answerText: "bought it" })).id;
    hB = (await mkDnaIdentity(investorB, "claim", 2, 0, "insufficient_evidence", [{ answerId: a, stance: "supporting", supported: true }, { answerId: b, stance: "supporting", supported: true }])).id;
  });

  it("a quiet-account pair is appended (a fall), then a BACKFILLED trade destroys isolation: the rise is reported for review and NEVER appended", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const applied = await applyIndependenceRecalculationsForInvestor(db, investorB);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.outcome.action).toBe("appended");
    expect((await getLatestDnaHypothesisVersion(db, hB))!.supportingEvidenceCount).toBe(1);

    // A trade of another ticker is imported late, inside the isolation margin.
    await mkTxn(investorB, "ZZZ", "buy", "2026-05-11", "1");

    const report = await planIndependenceRecalculationsForInvestor(db, investorB);
    const item = report.find((r) => r.identityId === hB)!;
    expect(item.plan.action).toBe("requires_review");
    if (item.plan.action !== "requires_review") return;
    expect(item.plan.reason).toBe("confidence_rise");
    expect(item.plan.storedSupporting).toBe(1);
    expect(item.plan.recomputedSupporting).toBe(2);

    const versionsBefore = (await client`select count(*)::int c from dna_hypothesis_versions where dna_hypothesis_id = ${hB}`)[0]!.c;
    expect(await applyIndependenceRecalculationsForInvestor(db, investorB)).toEqual([]);
    const resolver = await loadIndependenceResolver(db, investorB);
    const direct = await recalculateDnaHypothesisIndependence(db, hB, resolver);
    expect(direct.action).toBe("requires_review");
    expect((await client`select count(*)::int c from dna_hypothesis_versions where dna_hypothesis_id = ${hB}`)[0]!.c).toBe(versionsBefore);
  });
});

describe("concurrency", () => {
  it("two concurrent recalculations of one identity append exactly one version (identity row lock + unique backstop)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const investorC = await mkInvestor("concurrent");
    const sell = await mkTxn(investorC, "AAA", "sell", "2026-05-10", "5");
    const buy = await mkTxn(investorC, "BBB", "buy", "2026-05-12", "5");
    const session = await insertInterviewSession(db, { investorId: investorC, origin: "user_initiated" });
    const a = (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: sell, questionText: "Q", answerText: "x" })).id;
    const b = (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: buy, questionText: "Q", answerText: "y" })).id;
    const h = await mkDnaIdentity(investorC, "claim", 2, 0, "insufficient_evidence", [{ answerId: a, stance: "supporting", supported: true }, { answerId: b, stance: "supporting", supported: true }]);
    const resolver = await loadIndependenceResolver(db, investorC);

    const results = await Promise.all([recalculateDnaHypothesisIndependence(db, h.id, resolver), recalculateDnaHypothesisIndependence(db, h.id, resolver)]);
    expect(results.filter((r) => r.action === "appended")).toHaveLength(1);
    expect(results.filter((r) => r.action === "no_op")).toHaveLength(1);
    const versions = await client`select version_number from dna_hypothesis_versions where dna_hypothesis_id = ${h.id} order by version_number`;
    expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
  });
});
