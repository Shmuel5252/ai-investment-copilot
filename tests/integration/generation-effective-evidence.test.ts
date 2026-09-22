// Raw vs EFFECTIVE evidence — production-path regression suite.
//
// The invariant: a citation explicitly REJECTED by grounding must never
// later raise independent-case counts, evidence strength, or mint a
// version just because identity resolution can see the identity's raw
// Evidence row. Raw Evidence stays immutable provenance; what counts is
// the effective evidence of the current version.
//
// These tests drive the REAL dna.generate / strategy.generateObserved
// routers (real validation, grounding orchestration, independence
// resolver, identity resolution, repositories, Postgres). ONLY the three
// AI entry points are mocked — zero real AI calls. One suite, parametrized
// over DNA and Strategy, so the two domains cannot quietly diverge.
//
// Migration rule: needs migration 0011. On a database without it these
// SKIP with an explicit reason instead of failing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const ai = vi.hoisted(() => ({
  proposeDna: vi.fn(),
  proposeStrategy: vi.fn(),
  ground: vi.fn(),
  classify: vi.fn(),
}));
vi.mock("@/lib/ai/dna", () => ({ proposeDnaHypotheses: ai.proposeDna }));
vi.mock("@/lib/ai/strategy", () => ({ proposeObservedPrinciples: ai.proposeStrategy, extractDeclaredPrinciples: vi.fn() }));
vi.mock("@/lib/ai/dna-grounding", () => ({ checkEvidenceGrounding: ai.ground }));
vi.mock("@/lib/ai/dna-identity", () => ({ classifyHypothesisMatch: ai.classify }));

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { dnaRouter } from "@/server/routers/dna";
import { strategyRouter } from "@/server/routers/strategy";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { getEffectiveEvidenceForDnaHypothesisVersion, getEffectiveEvidenceForStrategyPrincipleVersion } from "@/db/repositories/evidence";
import { insertDnaHypothesisVersionWithEvidence, recalculateDnaHypothesisConfidence, recalculateDnaHypothesisIndependence } from "@/db/repositories/dna";
import { insertObservedPrincipleVersionWithEvidence, recalculatePrincipleConfidence, recalculatePrincipleIndependence } from "@/db/repositories/strategy";
import { StaleIdentityVersionError } from "@/db/errors";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { calculateEvidenceStrength } from "@/lib/dna/evidence-strength";
import type { IndependenceBasis } from "@/lib/evidence/resolve-independence";
import { mkInvestor, mkTxn, uniqueKey } from "../helpers/db-fixtures";
import { fixtureBasis, rng } from "../helpers/independence";

const client = postgres(process.env.DATABASE_URL!, { max: 6 });
const db = drizzle(client, { schema });

let migrated = false;
const SKIP = "migration 0011 not applied to this database yet";

type Stance = "supporting" | "contradicting";
type AnswerKey = "eff" | "rej" | "neu" | "mp" | "mrvl";
interface Cite { answer: AnswerKey; stance: Stance }
interface World {
  investorId: string;
  answerId: Record<AnswerKey, string>;
  answerText: Record<AnswerKey, string>;
}

// A quiet, far-apart account (so isolation never fires by accident) plus the
// real MP -> MRVL pair, whose answers name each other and DO form a weak edge.
async function seedWorld(): Promise<World> {
  const investorId = await mkInvestor(db, "effective-evidence");
  const t = {
    eff: await mkTxn(db, investorId, "EFF", "buy", "2026-01-05", "10"),
    rej: await mkTxn(db, investorId, "REJ", "buy", "2026-02-10", "10"),
    neu: await mkTxn(db, investorId, "NEU", "buy", "2026-04-01", "10"),
    mpBuy: await mkTxn(db, investorId, "MP", "buy", "2026-08-05", "10"),
    mp: await mkTxn(db, investorId, "MP", "sell", "2026-08-28", "10"),
    mrvl: await mkTxn(db, investorId, "MRVL", "buy", "2026-08-28", "4"),
  };
  const session = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
  const answerText: Record<AnswerKey, string> = {
    eff: "EFFECTIVE-ANSWER I held through the rally",
    rej: "REJECTED-ANSWER a selectively reframed story",
    neu: "NEW-ANSWER a separate, later decision",
    mp: "MP-ANSWER I sold the rest of MP to fund MRVL",
    mrvl: "MRVL-ANSWER I sold MP to free the capital",
  };
  const txnOf: Record<AnswerKey, string> = { eff: t.eff, rej: t.rej, neu: t.neu, mp: t.mp, mrvl: t.mrvl };
  const answerId = {} as Record<AnswerKey, string>;
  for (const k of Object.keys(answerText) as AnswerKey[]) {
    answerId[k] = (await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: txnOf[k], questionText: "Q", answerText: answerText[k] })).id;
  }
  return { investorId, answerId, answerText };
}

interface Seeded {
  identityId: string;
  versionIds: string[];
  latestVersionId: string;
  evidenceId: Record<string, string>; // `${answer}:${stance}` -> Evidence.id
}
interface SeedSpec {
  effective: Cite[];
  rejected: Cite[];
  /** true: an earlier remediation wrote checks (effective supported, rejected unsupported); false: legacy zero-check version. */
  checked: boolean;
  /** Store a tier the current helper would not produce, so the confidence recalculation has something to correct. */
  staleTier?: boolean;
}
const counts = (cites: Cite[]) => ({
  S: cites.filter((c) => c.stance === "supporting").length,
  C: cites.filter((c) => c.stance === "contradicting").length,
});

interface Domain {
  name: "dna" | "strategy";
  seed(w: World, spec: SeedSpec): Promise<Seeded>;
  generate(w: World, target: Seeded, cites: Cite[], opts?: { rejectOnlyStance?: Stance }): Promise<{ versionedCount: number; unchangedCount: number; droppedCount: number }>;
  versions(identityId: string): Promise<{ id: string; versionNumber: number; s: number; c: number; tier: string; createdBy: string; basis: IndependenceBasis | null; json: string }[]>;
  checks(versionId: string): Promise<{ evidenceId: string; verdict: string; reason: string }[]>;
  effective(identityId: string, versionId: string): Promise<string[]>;
  rawJson(identityId: string): Promise<string[]>;
  evidenceApi(w: World, identityId: string): Promise<string[]>;
  /** Append a version through the repository, counted against an EXPLICIT base version (to exercise the stale-base guard). */
  appendCountedAgainst(w: World, identityId: string, expectedBaseVersionId: string, answerId?: string, expectedBaseCheckCount?: number): Promise<unknown>;
  /** What a remediation's checked_no_change does: adds a grounding verdict to an EXISTING version, without a new version. */
  addCheck(versionId: string, evidenceId: string, verdict: "supported" | "unsupported"): Promise<void>;
  recalcConfidence(identityId: string): Promise<{ action: string }>;
  recalcIndependence(w: World, identityId: string): Promise<{ action: string }>;
}

const proposal = (w: World, cites: Cite[]) => [
  {
    statement: "a proposed claim",
    evidence: cites.map((c) => ({ interviewAnswerId: w.answerId[c.answer], stance: c.stance, description: `cites ${c.answer}` })),
  },
];

function wireAi(w: World, target: string, opts: { propose: "dna" | "strategy"; cites: Cite[]; rejectTexts: string[]; rejectOnlyStance?: Stance }) {
  const p = proposal(w, opts.cites);
  ai.proposeDna.mockResolvedValue(opts.propose === "dna" ? p : []);
  ai.proposeStrategy.mockResolvedValue(opts.propose === "strategy" ? p : []);
  ai.classify.mockResolvedValue({ matchedId: target, reason: "same claim" });
  ai.ground.mockImplementation(async (input: { sourceAnswerText: string; stance: Stance }) =>
    opts.rejectTexts.some((t) => input.sourceAnswerText.includes(t)) && (!opts.rejectOnlyStance || input.stance === opts.rejectOnlyStance)
      ? { verdict: "unsupported", reason: "does not establish the claim" }
      : { verdict: "supported", reason: "matches" }
  );
}

const dnaDomain: Domain = {
  name: "dna",
  async seed(w, spec) {
    const [h] = await db.insert(schema.dnaHypotheses).values({ investorId: w.investorId }).returning();
    const all = [...spec.effective, ...spec.rejected];
    const legacy = counts(all);
    const [v1] = await db.insert(schema.dnaHypothesisVersions).values({ dnaHypothesisId: h!.id, versionNumber: 1, statementText: "stored claim", evidenceStrength: calculateEvidenceStrength(legacy.S, legacy.C), supportingEvidenceCount: legacy.S, contradictingEvidenceCount: legacy.C, createdBy: "ai_generated" }).returning();
    const rows = await db.insert(schema.evidence).values(all.map((c) => ({ dnaHypothesisId: h!.id, stance: c.stance, interviewAnswerId: w.answerId[c.answer], description: `seed ${c.answer}` }))).returning();
    const evidenceId: Record<string, string> = {};
    all.forEach((c, i) => (evidenceId[`${c.answer}:${c.stance}`] = rows[i]!.id));
    const versionIds = [v1!.id];
    if (spec.checked) {
      const eff = counts(spec.effective);
      const tier = spec.staleTier ? "moderate" : calculateEvidenceStrength(eff.S, eff.C);
      const [v2] = await db.insert(schema.dnaHypothesisVersions).values({ dnaHypothesisId: h!.id, versionNumber: 2, statementText: "stored claim", evidenceStrength: tier, supportingEvidenceCount: eff.S, contradictingEvidenceCount: eff.C, createdBy: "system_grounding_revalidation", changeReason: "seeded remediation" }).returning();
      await db.insert(schema.dnaEvidenceGroundingChecks).values(all.map((c, i) => ({ dnaHypothesisVersionId: v2!.id, evidenceId: rows[i]!.id, verdict: (spec.rejected.includes(c) ? "unsupported" : "supported") as "supported" | "unsupported", reason: "seeded grounding verdict" })));
      versionIds.push(v2!.id);
    }
    return { identityId: h!.id, versionIds, latestVersionId: versionIds[versionIds.length - 1]!, evidenceId };
  },
  async generate(w, target, cites, opts = {}) {
    wireAi(w, target.identityId, { propose: "dna", cites, rejectTexts: ["REJECTED-ANSWER"], ...opts });
    return dnaRouter.createCaller({ session: { investorId: w.investorId } } as never).generate();
  },
  async versions(identityId) {
    const rows = await db.select().from(schema.dnaHypothesisVersions).where(eqCol(schema.dnaHypothesisVersions.dnaHypothesisId, identityId)).orderBy(schema.dnaHypothesisVersions.versionNumber);
    return rows.map((v) => ({ id: v.id, versionNumber: v.versionNumber, s: v.supportingEvidenceCount, c: v.contradictingEvidenceCount, tier: v.evidenceStrength, createdBy: v.createdBy, basis: v.independenceBasisJson as IndependenceBasis | null, json: JSON.stringify(v) }));
  },
  async checks(versionId) {
    const rows = await db.select().from(schema.dnaEvidenceGroundingChecks).where(eqCol(schema.dnaEvidenceGroundingChecks.dnaHypothesisVersionId, versionId));
    return rows.map((r) => ({ evidenceId: r.evidenceId, verdict: r.verdict, reason: r.reason }));
  },
  async effective(identityId, versionId) {
    return (await getEffectiveEvidenceForDnaHypothesisVersion(db, identityId, versionId)).map((e) => e.id).sort();
  },
  async rawJson(identityId) {
    return (await client`select row_to_json(e) j from evidence e where e.dna_hypothesis_id = ${identityId}`).map((r) => JSON.stringify(r.j)).sort();
  },
  async evidenceApi(w, identityId) {
    return (await dnaRouter.createCaller({ session: { investorId: w.investorId } } as never).evidence({ dnaHypothesisId: identityId })).map((e) => e.id).sort();
  },
  async addCheck(versionId, evidenceId, verdict) {
    await db.insert(schema.dnaEvidenceGroundingChecks).values({ dnaHypothesisVersionId: versionId, evidenceId, verdict, reason: "late grounding verdict" });
  },
  appendCountedAgainst: async (w, identityId, expectedBaseVersionId, answerId = w.answerId.neu, expectedBaseCheckCount) =>
    insertDnaHypothesisVersionWithEvidence(db, identityId, {
      expectedBaseVersionId,
      expectedBaseCheckCount: expectedBaseCheckCount ?? (await dnaDomain.checks(expectedBaseVersionId)).length,
      statementText: "stored claim",
      evidenceStrength: "insufficient_evidence",
      supportingEvidenceCount: 2,
      contradictingEvidenceCount: 0,
      independenceBasis: fixtureBasis(2, 0),
      newEvidence: [{ interviewAnswerId: answerId, stance: "supporting", description: "d" }],
      changeReason: "stale-base test",
    }),
  recalcConfidence: (id) => recalculateDnaHypothesisConfidence(db, id),
  async recalcIndependence(w, id) {
    return recalculateDnaHypothesisIndependence(db, id, await loadIndependenceResolver(db, w.investorId));
  },
};

const strategyDomain: Domain = {
  name: "strategy",
  async seed(w, spec) {
    const [p] = await db.insert(schema.strategyPrinciples).values({ investorId: w.investorId, key: uniqueKey("effective-evidence") }).returning();
    const all = [...spec.effective, ...spec.rejected];
    const legacy = counts(all);
    const base = { strategyPrincipleId: p!.id, principleType: "observed" as const, statementText: "stored claim", rationaleText: "Observed as a pattern across your interview answers, not stated directly." };
    const [v1] = await db.insert(schema.strategyPrincipleVersions).values({ ...base, versionNumber: 1, evidenceStrength: calculateEvidenceStrength(legacy.S, legacy.C), supportingEvidenceCount: legacy.S, contradictingEvidenceCount: legacy.C, createdBy: "ai_observed" }).returning();
    const rows = await db.insert(schema.evidence).values(all.map((c) => ({ strategyPrincipleId: p!.id, stance: c.stance, interviewAnswerId: w.answerId[c.answer], description: `seed ${c.answer}` }))).returning();
    const evidenceId: Record<string, string> = {};
    all.forEach((c, i) => (evidenceId[`${c.answer}:${c.stance}`] = rows[i]!.id));
    const versionIds = [v1!.id];
    if (spec.checked) {
      const eff = counts(spec.effective);
      const tier = spec.staleTier ? "moderate" : calculateEvidenceStrength(eff.S, eff.C);
      const [v2] = await db.insert(schema.strategyPrincipleVersions).values({ ...base, versionNumber: 2, evidenceStrength: tier, supportingEvidenceCount: eff.S, contradictingEvidenceCount: eff.C, createdBy: "system_grounding_revalidation", changeReason: "seeded remediation" }).returning();
      await db.insert(schema.strategyEvidenceGroundingChecks).values(all.map((c, i) => ({ strategyPrincipleVersionId: v2!.id, evidenceId: rows[i]!.id, verdict: (spec.rejected.includes(c) ? "unsupported" : "supported") as "supported" | "unsupported", reason: "seeded grounding verdict" })));
      versionIds.push(v2!.id);
    }
    return { identityId: p!.id, versionIds, latestVersionId: versionIds[versionIds.length - 1]!, evidenceId };
  },
  async generate(w, target, cites, opts = {}) {
    wireAi(w, target.identityId, { propose: "strategy", cites, rejectTexts: ["REJECTED-ANSWER"], ...opts });
    return strategyRouter.createCaller({ session: { investorId: w.investorId } } as never).generateObserved();
  },
  async versions(identityId) {
    const rows = await db.select().from(schema.strategyPrincipleVersions).where(eqCol(schema.strategyPrincipleVersions.strategyPrincipleId, identityId)).orderBy(schema.strategyPrincipleVersions.versionNumber);
    return rows.map((v) => ({ id: v.id, versionNumber: v.versionNumber, s: v.supportingEvidenceCount ?? -1, c: v.contradictingEvidenceCount ?? -1, tier: v.evidenceStrength ?? "none", createdBy: v.createdBy, basis: v.independenceBasisJson as IndependenceBasis | null, json: JSON.stringify(v) }));
  },
  async checks(versionId) {
    const rows = await db.select().from(schema.strategyEvidenceGroundingChecks).where(eqCol(schema.strategyEvidenceGroundingChecks.strategyPrincipleVersionId, versionId));
    return rows.map((r) => ({ evidenceId: r.evidenceId, verdict: r.verdict, reason: r.reason }));
  },
  async effective(identityId, versionId) {
    return (await getEffectiveEvidenceForStrategyPrincipleVersion(db, identityId, versionId)).map((e) => e.id).sort();
  },
  async rawJson(identityId) {
    return (await client`select row_to_json(e) j from evidence e where e.strategy_principle_id = ${identityId}`).map((r) => JSON.stringify(r.j)).sort();
  },
  async evidenceApi(w, identityId) {
    return (await strategyRouter.createCaller({ session: { investorId: w.investorId } } as never).evidence({ strategyPrincipleId: identityId })).map((e) => e.id).sort();
  },
  async addCheck(versionId, evidenceId, verdict) {
    await db.insert(schema.strategyEvidenceGroundingChecks).values({ strategyPrincipleVersionId: versionId, evidenceId, verdict, reason: "late grounding verdict" });
  },
  appendCountedAgainst: async (w, identityId, expectedBaseVersionId, answerId = w.answerId.neu, expectedBaseCheckCount) =>
    insertObservedPrincipleVersionWithEvidence(db, identityId, {
      expectedBaseVersionId,
      expectedBaseCheckCount: expectedBaseCheckCount ?? (await strategyDomain.checks(expectedBaseVersionId)).length,
      statementText: "stored claim",
      evidenceStrength: "insufficient_evidence",
      supportingEvidenceCount: 2,
      contradictingEvidenceCount: 0,
      independenceBasis: fixtureBasis(2, 0),
      newEvidence: [{ interviewAnswerId: answerId, stance: "supporting", description: "d" }],
      changeReason: "stale-base test",
    }),
  recalcConfidence: (id) => recalculatePrincipleConfidence(db, id),
  async recalcIndependence(w, id) {
    return recalculatePrincipleIndependence(db, id, await loadIndependenceResolver(db, w.investorId));
  },
};

import { eq } from "drizzle-orm";
function eqCol(col: Parameters<typeof eq>[0], value: string) {
  return eq(col, value);
}

beforeAll(async () => {
  const probe = await client`select to_regclass('public.transaction_link_facts') as t`;
  migrated = probe[0]?.t !== null;
});
afterAll(async () => {
  await client.end();
});
beforeEach(() => {
  ai.proposeDna.mockReset();
  ai.proposeStrategy.mockReset();
  ai.ground.mockReset();
  ai.classify.mockReset();
});

describe.each([dnaDomain, strategyDomain])("$name: raw vs effective evidence at identity resolution", (d) => {
  it("A/H. a REJECTED citation is not counted: a new grounded independent citation grows S from the EFFECTIVE base (S=2), never from raw (S=3)", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });

    const out = await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    expect(out.versionedCount).toBe(1);

    const versions = await d.versions(s.identityId);
    const v3 = versions[2]!;
    expect(v3.versionNumber).toBe(3);
    expect(v3.s).toBe(2); // eff + neu — the rejected citation is NOT a third case
    expect(v3.c).toBe(0);
    expect(v3.tier).toBe("insufficient_evidence");
    const cited = v3.basis!.groups.flatMap((g) => g.citations).sort();
    expect(cited).toEqual([`answer:${w.answerId.eff}`, `answer:${w.answerId.neu}`].sort());
    expect(v3.basis!.supportingUpper).toBe(2); // S_ub is not inflated either
  });

  it("H. a rejected CONTRADICTING citation cannot raise C_ub either", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "contradicting" }], checked: true });

    await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    const v3 = (await d.versions(s.identityId))[2]!;
    expect(v3.c).toBe(0);
    expect(v3.basis!.contradictingUpper).toBe(0);
    expect(v3.s).toBe(2);
  });

  it("G. weak-edge counting runs over the EFFECTIVE set: a rejected MP sale must not form a weak edge with a newly grounded MRVL buy", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "mp", stance: "supporting" }], checked: true });

    await d.generate(w, s, [{ answer: "mrvl", stance: "supporting" }]);
    const v3 = (await d.versions(s.identityId))[2]!;
    expect(v3.basis!.weakEdges).toEqual([]); // raw-based counting would have paired MP(rejected)~MRVL
    expect(v3.basis!.supportingUpper).toBe(2);
    expect(v3.s).toBe(2);
    expect(v3.basis!.exact).toBe(true);
  });

  it("B. re-presenting a REJECTED citation mints no version and adds no Evidence — whether grounding rejects it again or (nondeterministically) accepts it now", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    for (const groundingNowRejects of [true, false]) {
      const w = await seedWorld();
      const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });
      const before = { raw: await d.rawJson(s.identityId), versions: (await d.versions(s.identityId)).map((v) => v.json) };

      // The seeded mock rejects text containing REJECTED-ANSWER; a second run flips the verdict by rewriting the answer text check.
      wireAi(w, s.identityId, { propose: d.name, cites: [{ answer: "rej", stance: "supporting" }], rejectTexts: groundingNowRejects ? ["REJECTED-ANSWER"] : [] });
      const out = await (d.name === "dna"
        ? dnaRouter.createCaller({ session: { investorId: w.investorId } } as never).generate()
        : strategyRouter.createCaller({ session: { investorId: w.investorId } } as never).generateObserved());

      expect(out.versionedCount, `grounding rejects: ${groundingNowRejects}`).toBe(0);
      expect(await d.rawJson(s.identityId)).toEqual(before.raw);
      expect((await d.versions(s.identityId)).map((v) => v.json)).toEqual(before.versions);
    }
  });

  it("B. re-presenting an EFFECTIVE citation alongside a rejected one is 'no new information'", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });
    const out = await d.generate(w, s, [{ answer: "eff", stance: "supporting" }, { answer: "rej", stance: "supporting" }]);
    expect(out.versionedCount).toBe(0);
    expect(await d.versions(s.identityId)).toHaveLength(2);
  });

  it("the rejection is stance-specific: the same answer cited with the OPPOSITE stance is a different judgment and can count", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });
    // The grounding fake rejects only what it rejected before: the SUPPORTING framing of that answer.
    const out = await d.generate(w, s, [{ answer: "rej", stance: "contradicting" }], { rejectOnlyStance: "supporting" });
    expect(out.versionedCount).toBe(1);
    const v3 = (await d.versions(s.identityId))[2]!;
    expect(v3.c).toBe(1);
    expect(v3.s).toBe(1);
  });

  it("the version chain stays consistent: the appended version carries every earlier verdict and adds its new evidence as supported, so the EFFECTIVE set is old-effective + new — never re-admitting the rejected row", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });
    const rawBefore = await d.rawJson(s.identityId);
    const versionsBefore = await d.versions(s.identityId);

    await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);

    const versions = await d.versions(s.identityId);
    const v3 = versions[2]!;
    const checks = await d.checks(v3.id);
    expect(checks).toHaveLength(3);
    const byEvidence = Object.fromEntries(checks.map((c) => [c.evidenceId, c.verdict]));
    expect(byEvidence[s.evidenceId["eff:supporting"]!]).toBe("supported");
    expect(byEvidence[s.evidenceId["rej:supporting"]!]).toBe("unsupported");
    expect(Object.values(byEvidence).filter((v) => v === "supported")).toHaveLength(2);

    const effectiveV3 = await d.effective(s.identityId, v3.id);
    expect(effectiveV3).toHaveLength(2);
    expect(effectiveV3).toContain(s.evidenceId["eff:supporting"]);
    expect(effectiveV3).not.toContain(s.evidenceId["rej:supporting"]);
    // "View Evidence" (the API) agrees with the version's own counts.
    expect(await d.evidenceApi(w, s.identityId)).toEqual(effectiveV3);
    expect(effectiveV3.length).toBe(v3.s);

    // J. Historical raw Evidence and earlier versions are byte-identical; only additions.
    const rawAfter = await d.rawJson(s.identityId);
    expect(rawBefore.every((row) => rawAfter.includes(row))).toBe(true);
    expect(rawAfter.length).toBe(rawBefore.length + 1);
    expect(versions.slice(0, 2).map((v) => v.json)).toEqual(versionsBefore.map((v) => v.json));
    expect(await d.checks(versionsBefore[1]!.id)).toHaveLength(2);
  });

  it("E. a LEGACY zero-check version keeps the approved fallback: every raw citation is effective, and the appended version stays zero-check", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }, { answer: "rej", stance: "supporting" }], rejected: [], checked: false });

    await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    const versions = await d.versions(s.identityId);
    expect(versions).toHaveLength(2);
    expect(versions[1]!.s).toBe(3); // no verdict was ever recorded, so all raw citations count — as approved
    expect(await d.checks(versions[1]!.id)).toEqual([]); // and no check rows are invented
    expect((await d.effective(s.identityId, versions[1]!.id)).length).toBe(3); // eff, rej and neu: all raw rows are effective
  });

  it("F. carried-forward checks stay effective through a CONFIDENCE recalculation version, and generation afterwards still ignores the rejected row", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true, staleTier: true });

    expect((await d.recalcConfidence(s.identityId)).action).toBe("appended");
    const afterRecalc = await d.versions(s.identityId);
    expect(afterRecalc).toHaveLength(3);
    expect(await d.effective(s.identityId, afterRecalc[2]!.id)).toEqual(await d.effective(s.identityId, s.latestVersionId));
    expect(await d.effective(s.identityId, afterRecalc[2]!.id)).not.toContain(s.evidenceId["rej:supporting"]);

    await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    const versions = await d.versions(s.identityId);
    expect(versions).toHaveLength(4);
    expect(versions[3]!.s).toBe(2);
    expect(versions[3]!.basis!.groups.flatMap((g) => g.citations)).not.toContain(`answer:${w.answerId.rej}`);
  });

  it("F/G. carried checks stay effective through an INDEPENDENCE recalculation version; the next generation counts the weak-linked pair once, never the rejected row", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, {
      effective: [{ answer: "mp", stance: "supporting" }, { answer: "mrvl", stance: "supporting" }],
      rejected: [{ answer: "rej", stance: "supporting" }],
      checked: true,
    });

    expect((await d.recalcIndependence(w, s.identityId)).action).toBe("appended"); // MP sale + MRVL buy are one weak-linked decision
    const afterRecalc = await d.versions(s.identityId);
    expect(afterRecalc[2]!.s).toBe(1);
    expect(afterRecalc[2]!.createdBy).toBe("system_independence_recalculation");
    expect(await d.effective(s.identityId, afterRecalc[2]!.id)).not.toContain(s.evidenceId["rej:supporting"]);

    await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    const v4 = (await d.versions(s.identityId))[3]!;
    expect(v4.s).toBe(2); // (MP~MRVL) + NEU — and not the rejected REJ row
    expect(v4.basis!.supportingUpper).toBe(3); // MP, MRVL, NEU if the weak edge is not real
    expect(v4.basis!.weakEdges).toHaveLength(1);
    expect(v4.basis!.groups.flatMap((g) => g.citations)).not.toContain(`answer:${w.answerId.rej}`);
    expect(await d.checks(v4.id)).toHaveLength(4);
  });

  it("a stale base: an append counted against a version that is no longer the latest is REFUSED and writes nothing (no version, no Evidence, no checks)", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });
    const before = { raw: await d.rawJson(s.identityId), versions: (await d.versions(s.identityId)).map((v) => v.json), checksV2: await d.checks(s.latestVersionId) };

    // The generation counted against v1, but v2 (a remediation) is the latest.
    await expect(d.appendCountedAgainst(w, s.identityId, s.versionIds[0]!)).rejects.toBeInstanceOf(StaleIdentityVersionError);

    expect(await d.rawJson(s.identityId)).toEqual(before.raw);
    expect((await d.versions(s.identityId)).map((v) => v.json)).toEqual(before.versions);
    expect(await d.checks(s.latestVersionId)).toEqual(before.checksV2);

    // The same call counted against the CURRENT latest version succeeds and carries the verdicts.
    await d.appendCountedAgainst(w, s.identityId, s.latestVersionId);
    const versions = await d.versions(s.identityId);
    expect(versions).toHaveLength(3);
    expect(await d.checks(versions[2]!.id)).toHaveLength(3);
  });

  it("a stale base with the SAME check count (legacy zero-check chain: another append landed since): refused on the version id alone, nothing written", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [], checked: false });

    // Two generations both counted against v1 (0 checks). The first lands, and — the base having no checks — carries none.
    await d.appendCountedAgainst(w, s.identityId, s.latestVersionId, w.answerId.neu, 0);
    const afterFirst = { raw: await d.rawJson(s.identityId), versions: (await d.versions(s.identityId)).map((v) => v.json) };
    expect(afterFirst.versions).toHaveLength(2);

    // The second still holds v1 with the same (zero) check count: only the version id tells it apart.
    await expect(d.appendCountedAgainst(w, s.identityId, s.latestVersionId, w.answerId.mp, 0)).rejects.toBeInstanceOf(StaleIdentityVersionError);
    expect(await d.rawJson(s.identityId)).toEqual(afterFirst.raw);
    expect((await d.versions(s.identityId)).map((v) => v.json)).toEqual(afterFirst.versions);
  });

  it("a base whose grounding checks CHANGED after counting (remediation's checked_no_change adds verdicts WITHOUT a new version): the append is REFUSED and writes nothing", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    // Legacy zero-check base: every raw row counts as effective, so a generation would count REJ.
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: false });
    expect(await d.checks(s.latestVersionId)).toHaveLength(0);
    const before = { raw: await d.rawJson(s.identityId), versions: (await d.versions(s.identityId)).map((v) => v.json) };

    // ...then a remediation grounds the base version in place: same version id, now with verdicts.
    await d.addCheck(s.latestVersionId, s.evidenceId["rej:supporting"]!, "unsupported");
    await d.addCheck(s.latestVersionId, s.evidenceId["eff:supporting"]!, "supported");

    // The generation counted against "version with 0 checks": its counts include the now-rejected row.
    await expect(d.appendCountedAgainst(w, s.identityId, s.latestVersionId, undefined, 0)).rejects.toBeInstanceOf(StaleIdentityVersionError);
    expect(await d.rawJson(s.identityId)).toEqual(before.raw);
    expect((await d.versions(s.identityId)).map((v) => v.json)).toEqual(before.versions);
    expect(await d.checks(s.latestVersionId)).toHaveLength(2);

    // Counted against what it now is (2 checks), the same append goes through and carries the verdicts.
    await d.appendCountedAgainst(w, s.identityId, s.latestVersionId, undefined, 2);
    const versions = await d.versions(s.identityId);
    expect(versions).toHaveLength(2);
    expect((await d.checks(versions[1]!.id)).map((c) => c.verdict).sort()).toEqual(["supported", "supported", "unsupported"]);
  });

  it("no version inflation: running the SAME generation twice mints exactly one version (the second run finds its citation already effective)", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const w = await seedWorld();
    const s = await d.seed(w, { effective: [{ answer: "eff", stance: "supporting" }], rejected: [{ answer: "rej", stance: "supporting" }], checked: true });

    const first = await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
    const second = await d.generate(w, s, [{ answer: "neu", stance: "supporting" }, { answer: "rej", stance: "supporting" }]);
    expect(first.versionedCount).toBe(1);
    expect(second.versionedCount).toBe(0);
    expect(await d.versions(s.identityId)).toHaveLength(3);
  });

  it("chain invariant on the production repositories: across random generate-appends and both recalculations, a rejected row NEVER becomes effective and the effective set NEVER shrinks", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    const rand = rng(31);
    for (let trial = 0; trial < 4; trial++) {
      const w = await seedWorld();
      const s = await d.seed(w, {
        effective: [{ answer: "mp", stance: "supporting" }, { answer: "mrvl", stance: "supporting" }],
        rejected: [{ answer: "rej", stance: "supporting" }, { answer: "eff", stance: "contradicting" }],
        checked: true,
        staleTier: true,
      });
      const rejectedIds = [s.evidenceId["rej:supporting"]!, s.evidenceId["eff:contradicting"]!];
      let previous = await d.effective(s.identityId, s.latestVersionId);

      for (let step = 0; step < 6; step++) {
        const action = ["append", "confidence", "independence"][Math.floor(rand() * 3)]!;
        const versionsBefore = await d.versions(s.identityId);
        const latest = versionsBefore[versionsBefore.length - 1]!;
        if (action === "append") {
          const t = await mkTxn(db, w.investorId, `CH${trial}${step}`, "buy", `2026-0${1 + (step % 6)}-1${step}`, "3");
          const answer = (await insertInterviewAnswer(db, { interviewSessionId: (await db.select().from(schema.interviewSessions).where(eqCol(schema.interviewSessions.investorId, w.investorId)))[0]!.id, transactionId: t, questionText: "Q", answerText: `chain answer ${step}` })).id;
          await d.appendCountedAgainst(w, s.identityId, latest.id, answer);
        } else if (action === "confidence") await d.recalcConfidence(s.identityId);
        else await d.recalcIndependence(w, s.identityId);

        const versions = await d.versions(s.identityId);
        const now = await d.effective(s.identityId, versions[versions.length - 1]!.id);
        for (const rejected of rejectedIds) expect(now, `trial ${trial} step ${step} (${action})`).not.toContain(rejected);
        expect(previous.every((id) => now.includes(id)), `effective set shrank at trial ${trial} step ${step} (${action})`).toBe(true);
        // and the version's own S never exceeds what its effective evidence could possibly hold
        expect(versions[versions.length - 1]!.s).toBeLessThanOrEqual(now.length);
        previous = now;
      }
    }
  });

  it("cross-mechanism concurrency: generate, confidence recalculation and independence recalculation racing on ONE identity converge to a valid, stable state (Phase 2.D)", async (ctx) => {
    ctx.skip(!migrated, SKIP);
    // Genuinely has work for all three: staleTier gives confidence recalc a tier to fix; the MP/MRVL
    // weak edge gives independence recalc a count to fix; NEU is a real, not-yet-cited answer for generate.
    const w = await seedWorld();
    const s = await d.seed(w, {
      effective: [{ answer: "mp", stance: "supporting" }, { answer: "mrvl", stance: "supporting" }],
      rejected: [{ answer: "rej", stance: "supporting" }, { answer: "eff", stance: "contradicting" }],
      checked: true,
      staleTier: true,
    });
    const rejectedIds = [s.evidenceId["rej:supporting"]!, s.evidenceId["eff:contradicting"]!];

    const ops: (() => Promise<unknown>)[] = [
      ...Array.from({ length: 3 }, () => () => d.generate(w, s, [{ answer: "neu", stance: "supporting" }])),
      ...Array.from({ length: 3 }, () => () => d.recalcConfidence(s.identityId)),
      ...Array.from({ length: 3 }, () => () => d.recalcIndependence(w, s.identityId)),
    ];
    const settled = await Promise.allSettled(ops.map((op) => op()));

    // Every outcome is a RECOGNIZED one — a successful action, or the router's classified
    // "concurrent generation" refusal. Never a raw/uncaught error, never partial state.
    for (const r of settled) {
      if (r.status === "fulfilled") continue;
      expect(r.reason, String(r.reason)).toBeInstanceOf(TRPCError);
      expect((r.reason as TRPCError).code).toBe("BAD_REQUEST");
    }

    // The version chain itself is well-formed: consecutive numbers, no duplicates, no gaps.
    const versions = await d.versions(s.identityId);
    expect(versions.map((v) => v.versionNumber)).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));

    // Converged, not merely quiet by luck: one more pass of each mechanism (now sequential,
    // storm over) finds nothing left to do — the storm didn't leave unfinished/divergent work.
    // The storm's 3 generate() attempts may ALL have lost their race to a
    // recalculation writer (the stale-base guard doing exactly its job) —
    // NEU can therefore still be genuinely unadded, and the first retry
    // below is what actually lands it, not a sign anything was lost. What
    // must hold regardless of how many retries that takes: NEU — one
    // genuinely new independent citation — is never versioned in twice.
    let versionedInDrain = 0;
    for (let i = 0; i < 5; i++) {
      const r = await d.generate(w, s, [{ answer: "neu", stance: "supporting" }]);
      versionedInDrain += r.versionedCount;
      if (r.versionedCount === 0) break;
    }
    expect(versionedInDrain).toBeLessThanOrEqual(1);
    // Drained: a further pass of every mechanism, in any order, now finds nothing left to do.
    expect((await d.recalcConfidence(s.identityId)).action).toBe("no_op");
    expect((await d.recalcIndependence(w, s.identityId)).action).toBe("no_op");
    expect((await d.generate(w, s, [{ answer: "neu", stance: "supporting" }])).versionedCount).toBe(0);

    // The stable end state itself still obeys every hardening invariant: no rejected evidence
    // effective, and the version's OWN counts match recomputing fresh over that effective set
    // (round-trip consistency — nothing about the interleaving left a stale/mismatched count).
    const finalVersions = await d.versions(s.identityId);
    const final = finalVersions[finalVersions.length - 1]!;
    const finalEffective = await d.effective(s.identityId, final.id);
    for (const rejected of rejectedIds) expect(finalEffective).not.toContain(rejected);
    expect(final.s).toBeLessThanOrEqual(finalEffective.length);
    expect(final.basis).not.toBeNull();
  });
});
