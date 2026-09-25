import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import { partitionEvidenceForCounting } from "@/lib/evidence/identity-evidence-for-counting";
import { checksForAppendedVersion, type CheckRow } from "@/lib/evidence/append-version-checks";
import { resolveHypothesisIdentities } from "@/lib/dna/resolve-hypothesis-identity";
import { resolveObservedPrincipleIdentities } from "@/lib/strategy/resolve-principle-identity";
import { fixtureBasis, resolverFromCaseKeys, rng } from "../helpers/independence";

// Raw vs EFFECTIVE evidence — DB-free coverage of the rules the production
// routers/repositories now share. The router-level, end-to-end behavior is
// in tests/integration/generation-effective-evidence.test.ts.

type Stance = "supporting" | "contradicting";
const row = (id: string, interviewAnswerId: string | null, stance: Stance = "supporting") => ({ id, interviewAnswerId, stance });
const check = (evidenceId: string, verdict: "supported" | "unsupported", reason = "seeded"): CheckRow => ({ evidenceId, verdict, reason });

describe("partitionEvidenceForCounting — what an identity's CURRENT version counts", () => {
  it("E. a version with ZERO grounding checks keeps the approved fallback: every raw citation is effective, nothing is rejected", () => {
    const p = partitionEvidenceForCounting([row("e1", "a1"), row("e2", "a2", "contradicting")], []);
    expect(p.effective).toEqual([
      { interviewAnswerId: "a1", decisionStatement: null, stance: "supporting" },
      { interviewAnswerId: "a2", decisionStatement: null, stance: "contradicting" },
    ]);
    expect(p.rejected).toEqual([]);
  });

  it("A. with checks, only 'supported' rows are effective; 'unsupported' rows are REJECTED", () => {
    const p = partitionEvidenceForCounting(
      [row("e1", "a1"), row("e2", "a2"), row("e3", "a3", "contradicting")],
      [check("e1", "supported"), check("e2", "unsupported"), check("e3", "supported")]
    );
    expect(p.effective.map((e) => e.interviewAnswerId)).toEqual(["a1", "a3"]);
    expect(p.rejected).toEqual([{ interviewAnswerId: "a2", decisionStatement: null, stance: "supporting" }]);
  });

  it("fail closed: on a checked version a raw row with NO check row is rejected, never assumed supported", () => {
    const p = partitionEvidenceForCounting([row("e1", "a1"), row("e2", "a2")], [check("e1", "supported")]);
    expect(p.effective.map((e) => e.interviewAnswerId)).toEqual(["a1"]);
    expect(p.rejected.map((e) => e.interviewAnswerId)).toEqual(["a2"]);
  });

  it("reports how many check rows it read, so the writer can refuse a base whose checks changed since (0 for a legacy version)", () => {
    expect(partitionEvidenceForCounting([row("e1", "a1")], []).checkCount).toBe(0);
    expect(partitionEvidenceForCounting([row("e1", "a1"), row("e2", "a2")], [check("e1", "supported"), check("e2", "unsupported")]).checkCount).toBe(2);
    // counts every check row, including ones for evidence with no answer
    expect(partitionEvidenceForCounting([row("note", null), row("e1", "a1")], [check("note", "supported"), check("e1", "supported")]).checkCount).toBe(2);
  });

  it("evidence with no interview answer is never countable (it never reached the resolver)", () => {
    const p = partitionEvidenceForCounting([row("note", null), row("e1", "a1")], []);
    expect(p.effective).toHaveLength(1);
    expect(p.rejected).toHaveLength(0);
  });

  it("raw evidence is never mutated and effective + rejected partitions the answer-sourced rows exactly", () => {
    const rand = rng(21);
    for (let trial = 0; trial < 500; trial++) {
      const raw = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => row(`e${i}`, rand() < 0.15 ? null : `a${i}`, rand() < 0.3 ? "contradicting" : "supporting"));
      const checks = rand() < 0.3 ? [] : raw.filter(() => rand() < 0.8).map((r) => check(r.id, rand() < 0.5 ? "supported" : "unsupported"));
      const snapshot = JSON.stringify(raw);
      const p = partitionEvidenceForCounting(raw, checks);
      expect(JSON.stringify(raw)).toBe(snapshot);
      expect(p.effective.length + p.rejected.length).toBe(raw.filter((r) => r.interviewAnswerId !== null).length);
      // Independent oracle: the ONE effective-evidence rule everything else uses.
      const oracle = selectEffectiveEvidence(raw, checks).filter((r) => r.interviewAnswerId !== null).length;
      expect(p.effective.length).toBe(oracle);
    }
  });
});

describe("checksForAppendedVersion — a generate-appended version must not lose earlier verdicts", () => {
  it("E. a base version with NO checks gets none: the legacy zero-check fallback is untouched", () => {
    expect(checksForAppendedVersion("v1", [], ["new-1", "new-2"])).toEqual([]);
  });

  it("carries every base verdict unchanged (rejections stay rejections) and records added evidence as supported", () => {
    const out = checksForAppendedVersion("v2", [check("e1", "supported", "ok"), check("e2", "unsupported", "no")], ["n1"]);
    expect(out.map((c) => [c.evidenceId, c.verdict])).toEqual([["e1", "supported"], ["e2", "unsupported"], ["n1", "supported"]]);
    expect(out[1]!.reason).toContain("Carried forward unchanged from version v2");
    expect(out[1]!.reason).toContain("Original reason: no");
    expect(out[2]!.reason).toMatch(/Supported by Evidence Grounding at generation time/);
  });

  it("F. carrying is stable across a chain: rejections survive any number of appended versions", () => {
    let checks: CheckRow[] = [check("e1", "supported"), check("rejected", "unsupported")];
    for (let v = 2; v <= 6; v++) checks = checksForAppendedVersion(`v${v}`, checks, [`added-${v}`]);
    expect(checks.find((c) => c.evidenceId === "rejected")!.verdict).toBe("unsupported");
    expect(checks.filter((c) => c.verdict === "supported")).toHaveLength(1 + 5);
    expect(new Set(checks.map((c) => c.evidenceId)).size).toBe(checks.length); // one row per Evidence row
  });

  it("independent oracle: the effective set after appending is exactly (old effective) U (added) — never the rejected rows", () => {
    const rand = rng(22);
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rand() * 8);
      const raw = Array.from({ length: n }, (_, i) => row(`e${i}`, `a${i}`));
      const base = raw.map((r) => check(r.id, rand() < 0.5 ? "supported" : "unsupported"));
      const added = Array.from({ length: Math.floor(rand() * 3) }, (_, i) => row(`add${i}`, `n${i}`));
      const appended = checksForAppendedVersion("base", base, added.map((a) => a.id));

      const oldEffective = selectEffectiveEvidence(raw, base).map((r) => r.id).sort();
      const newEffective = selectEffectiveEvidence([...raw, ...added], appended).map((r) => r.id).sort();
      expect(newEffective).toEqual([...oldEffective, ...added.map((a) => a.id)].sort());
    }
  });
});

// ---------------------------------------------------------------------
// Identity resolution: explicit rejections are sticky, for DNA AND Strategy.
// ---------------------------------------------------------------------
type Outcome = { action: string; newEvidence?: string[]; supporting?: number; contradicting?: number; supportingUpper?: number };
interface ExistingSpec {
  id: string;
  effective: [string, Stance][];
  rejected: [string, Stance][];
}
interface ProposalSpec {
  statement: string;
  cites: [string, Stance][];
}
type Runner = (existing: ExistingSpec[], proposals: ProposalSpec[], matchTo: (statement: string) => string | null) => Promise<Map<string, Outcome>>;

const ANSWERS = new Map([["A", "A#1"], ["R", "R#1"], ["N", "N#1"], ["N2", "N2#1"], ["B", "B#1"]]);
const independence = resolverFromCaseKeys(ANSWERS);
const evidenceOf = (cites: [string, Stance][]) => cites.map(([interviewAnswerId, stance]) => ({ interviewAnswerId, stance, description: "d" }));
const persistedOf = (cites: [string, Stance][]) => cites.map(([interviewAnswerId, stance]) => ({ interviewAnswerId, stance }));
const grounded = (p: ProposalSpec) => ({
  statement: p.statement,
  evidence: evidenceOf(p.cites),
  supportingCount: 0,
  contradictingCount: 0,
  evidenceStrength: "insufficient_evidence" as const,
  independenceBasis: fixtureBasis(),
});

const dnaRunner: Runner = async (existing, proposals, matchTo) => {
  const results = await resolveHypothesisIdentities(
    proposals.map(grounded),
    existing.map((e) => ({ id: e.id, statementText: `stored ${e.id}`, evidenceForCounting: persistedOf(e.effective), rejectedEvidence: persistedOf(e.rejected) })),
    independence,
    async (statement) => ({ matchedId: matchTo(statement), reason: "test" })
  );
  return new Map(results.map((r, i) => [r.action === "new_identity" ? `new-${i}` : r.hypothesisId, {
    action: r.action,
    newEvidence: r.action === "new_version" ? r.newEvidence.map((e) => `${e.interviewAnswerId}:${e.stance}`) : undefined,
    supporting: r.action === "no_new_information" ? undefined : r.supportingCount,
    contradicting: r.action === "no_new_information" ? undefined : r.contradictingCount,
    supportingUpper: r.action === "no_new_information" ? undefined : r.independenceBasis.supportingUpper,
  }]));
};
const strategyRunner: Runner = async (existing, proposals, matchTo) => {
  const results = await resolveObservedPrincipleIdentities(
    proposals.map(grounded),
    existing.map((e) => ({ id: e.id, statementText: `stored ${e.id}`, evidenceForCounting: persistedOf(e.effective), rejectedEvidence: persistedOf(e.rejected) })),
    independence,
    async (statement) => ({ matchedId: matchTo(statement), reason: "test" })
  );
  return new Map(results.map((r, i) => [r.action === "new_identity" ? `new-${i}` : r.principleId, {
    action: r.action,
    newEvidence: r.action === "new_version" ? r.newEvidence.map((e) => `${e.interviewAnswerId}:${e.stance}`) : undefined,
    supporting: r.action === "no_new_information" ? undefined : r.supportingCount,
    contradicting: r.action === "no_new_information" ? undefined : r.contradictingCount,
    supportingUpper: r.action === "no_new_information" ? undefined : r.independenceBasis.supportingUpper,
  }]));
};

describe.each([
  ["DNA", dnaRunner],
  ["Strategy", strategyRunner],
])("%s identity resolution: explicit rejections are sticky", (_name, run) => {
  const H = (id = "H"): ExistingSpec => ({ id, effective: [["A", "supporting"]], rejected: [["R", "supporting"]] });
  const matchH = () => "H";

  it("B. re-presenting ONLY a rejected citation is 'no new information' — no version, nothing to insert", async () => {
    const out = await run([H()], [{ statement: "p", cites: [["R", "supporting"]] }], matchH);
    expect(out.get("H")).toEqual({ action: "no_new_information" });
  });

  it("A/C. a rejected citation is not counted, and a genuinely new grounded one grows from the EFFECTIVE base only", async () => {
    const out = await run([H()], [{ statement: "p", cites: [["R", "supporting"], ["N", "supporting"]] }], matchH);
    expect(out.get("H")).toMatchObject({ action: "new_version", newEvidence: ["N:supporting"], supporting: 2, contradicting: 0, supportingUpper: 2 });
  });

  it("H. a rejected CONTRADICTING citation cannot raise C either", async () => {
    const e: ExistingSpec = { id: "H", effective: [["A", "supporting"]], rejected: [["R", "contradicting"]] };
    const out = await run([e], [{ statement: "p", cites: [["R", "contradicting"], ["N", "supporting"]] }], matchH);
    expect(out.get("H")).toMatchObject({ action: "new_version", supporting: 2, contradicting: 0 });
  });

  it("the rejection is stance-specific: the same answer with the opposite stance is a different judgment", async () => {
    const out = await run([H()], [{ statement: "p", cites: [["R", "contradicting"]] }], matchH);
    expect(out.get("H")).toMatchObject({ action: "new_version", newEvidence: ["R:contradicting"], supporting: 1, contradicting: 1 });
  });

  it("re-presenting an EFFECTIVE citation alongside a rejected one is still 'no new information'", async () => {
    const out = await run([H()], [{ statement: "p", cites: [["A", "supporting"], ["R", "supporting"]] }], matchH);
    expect(out.get("H")).toEqual({ action: "no_new_information" });
  });

  it("E. an identity with NO rejections (zero-check legacy) counts every persisted citation exactly as before", async () => {
    const legacy: ExistingSpec = { id: "H", effective: [["A", "supporting"], ["R", "supporting"]], rejected: [] };
    const out = await run([legacy], [{ statement: "p", cites: [["N", "supporting"]] }], matchH);
    expect(out.get("H")).toMatchObject({ action: "new_version", supporting: 3 });
  });

  it("same-generation pool: two proposals matched to one identity — the rejected pair is dropped, the new pair counts once", async () => {
    const out = await run(
      [H()],
      [
        { statement: "p1", cites: [["R", "supporting"]] },
        { statement: "p2", cites: [["N", "supporting"], ["N", "supporting"]] },
      ],
      matchH
    );
    expect(out.get("H")).toMatchObject({ action: "new_version", newEvidence: ["N:supporting"], supporting: 2 });
  });

  it("rejections belong to ONE identity: citing that pair for a different identity, or a brand-new one, counts normally", async () => {
    const other: ExistingSpec = { id: "G", effective: [["B", "supporting"]], rejected: [] };
    const out = await run(
      [H(), other],
      [
        { statement: "to-G", cites: [["R", "supporting"]] },
        { statement: "brand-new", cites: [["R", "supporting"], ["N2", "supporting"]] },
      ],
      (s) => (s === "to-G" ? "G" : null)
    );
    expect(out.get("G")).toMatchObject({ action: "new_version", newEvidence: ["R:supporting"], supporting: 2 });
    const created = [...out.entries()].find(([k]) => k.startsWith("new-"))![1];
    expect(created).toMatchObject({ action: "new_identity", supporting: 2 });
    expect(out.has("H")).toBe(false); // untouched identities produce no resolution at all
  });

  it("an existing identity nothing in the batch matched is never touched, rejections or not", async () => {
    const out = await run([H()], [{ statement: "elsewhere", cites: [["N", "supporting"]] }], () => null);
    expect(out.has("H")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Static boundary: the routers count against EFFECTIVE evidence only.
// ---------------------------------------------------------------------
describe("the production routers cannot read the raw pool for identity counting", () => {
  // Comments may legitimately name the raw getters; only real imports/calls count.
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const dnaRouter = code("src/server/routers/dna.ts");
  const strategyRouter = code("src/server/routers/strategy.ts");

  it("DNA generate counts via getCountingEvidenceForDnaVersion and never imports the raw getter", () => {
    expect(dnaRouter).toMatch(/getCountingEvidenceForDnaVersion/);
    expect(dnaRouter).not.toMatch(/\bgetEvidenceForDnaHypothesis\b/);
    expect(dnaRouter).toMatch(/rejectedEvidence:\s*rejected/);
    expect(dnaRouter).toMatch(/expectedBaseVersionId/);
    expect(dnaRouter).toMatch(/expectedBaseCheckCount/);
    expect(dnaRouter).toMatch(/err instanceof StaleIdentityVersionError/);
  });

  it("Strategy generateObserved counts via getCountingEvidenceForStrategyPrincipleVersion and never imports the raw getter", () => {
    expect(strategyRouter).toMatch(/getCountingEvidenceForStrategyPrincipleVersion/);
    expect(strategyRouter).not.toMatch(/\bgetEvidenceForStrategyPrinciple\b/);
    expect(strategyRouter).toMatch(/rejectedEvidence:\s*rejected/);
    expect(strategyRouter).toMatch(/expectedBaseVersionId/);
    expect(strategyRouter).toMatch(/expectedBaseCheckCount/);
    expect(strategyRouter).toMatch(/err instanceof StaleIdentityVersionError/);
  });

  it("both generate-appended version writers carry grounding checks and guard the base version", () => {
    for (const file of ["src/db/repositories/dna.ts", "src/db/repositories/strategy.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toMatch(/checksForAppendedVersion/);
      expect(text, file).toMatch(/StaleIdentityVersionError/);
      expect(text, file).toMatch(/expectedBaseCheckCount/);
    }
  });

  it("the recalculations still read raw + the LATEST version's checks (effective), never raw alone", () => {
    for (const file of ["src/db/repositories/independence-recalculation.ts", "src/db/repositories/confidence-recalculation.ts"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/selectEffectiveEvidence\(/);
    }
  });
});
