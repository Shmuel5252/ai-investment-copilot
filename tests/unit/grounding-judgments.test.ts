// OD-R9 — what the remediation planners hand to the grounding judgment audit
// ledger, the run identity, the V3.2 contrast clarification, and the ledger's
// READ ISOLATION. Pure: no database, no model. The DB-backed half is
// tests/integration/grounding-judgments.test.ts.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import type { EvidenceGroundingCheckInput, EvidenceGroundingResult } from "@/lib/ai/dna-grounding";
import { planGroundingRemediation, type GroundingJudgment, type PersistedEvidenceForRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { buildGroundingRun } from "@/lib/evidence/grounding-run";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { contextFromTrades } from "../helpers/independence";
import { referenceGate, type ReferenceWorld } from "../helpers/reference-gate-v3-2";

const ANSWER_WITH_Q = "answer text with a question";
const ANSWER_NO_Q = "answer text without a question";
const DECISION_TEXT = "decision reasoning text";
const QUESTION = "What made you sell then?";
const resolver = createIndependenceResolver({
  ...contextFromTrades(
    [{ id: "t1", ticker: "AAA", type: "buy", date: "2026-01-05" }, { id: "t2", ticker: "BBB", type: "buy", date: "2026-03-05" }],
    [{ id: "ans-q", txn: "t1", text: ANSWER_WITH_Q }, { id: "ans-noq", txn: "t2", text: ANSWER_NO_Q }]
  ),
  decisions: [{ id: "dec-1", caseResolution: { kind: "own" } }],
});
const TEXTS = new Map([["ans-q", ANSWER_WITH_Q], ["ans-noq", ANSWER_NO_Q], ["decision:dec-1:reasoning", DECISION_TEXT]]);
const CONTEXT = new Map([["ans-q", QUESTION], ["ans-noq", "   "], ["decision:dec-1:reasoning", QUESTION]]);
const RAW: PersistedEvidenceForRemediation[] = [
  { id: "ev-q", interviewAnswerId: "ans-q", stance: "supporting" },
  { id: "ev-noq", interviewAnswerId: "ans-noq", stance: "supporting" },
  { id: "ev-dec", interviewAnswerId: null, decisionStatement: { decisionId: "dec-1", kind: "reasoning" }, stance: "contradicting" },
  { id: "ev-unsourced", interviewAnswerId: null, stance: "supporting" }, // no investor statement: convention check, never judged
];
const gateBy = (unsupported: readonly string[]) => async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
  unsupported.includes(i.sourceAnswerText) ? { verdict: "unsupported", reason: `not grounded: ${i.stance}` } : { verdict: "supported", reason: `grounded: ${i.stance}` };
const input = (already: ReadonlySet<string> | null) => ({ rawEvidence: RAW, answerTextById: TEXTS, independence: resolver, alreadyGroundedEvidenceIds: already, contextTextById: CONTEXT });
const ALL = new Set(RAW.map((r) => r.id));
const EXPECTED_ALL_SUPPORTED: GroundingJudgment[] = [
  { evidenceId: "ev-q", verdict: "supported", reason: "grounded: supporting", contextSupplied: true },
  { evidenceId: "ev-noq", verdict: "supported", reason: "grounded: supporting", contextSupplied: false }, // a blank question is no context
  { evidenceId: "ev-dec", verdict: "supported", reason: "grounded: contradicting", contextSupplied: false }, // a decision statement never has context
];

describe("planners return what the gate judged, for every judged outcome", () => {
  it("no_op: the judgments are returned although nothing semantic changes", async () => {
    const dna = await planGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim" } }, gateBy([]));
    const strategy = await planPrincipleGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim", principleType: "observed" } }, gateBy([]));
    for (const plan of [dna, strategy]) expect(plan).toEqual({ action: "no_op", judgments: EXPECTED_ALL_SUPPORTED });
  });

  it("checked_no_change: judgments beside the checks; the unsourced citation has a convention check and NO judgment", async () => {
    const plan = await planGroundingRemediation({ ...input(null), currentVersion: { id: "v1", statementText: "claim" } }, gateBy([]));
    expect(plan.action).toBe("checked_no_change");
    if (plan.action !== "checked_no_change") throw new Error("expected checked_no_change");
    expect(plan.judgments).toEqual(EXPECTED_ALL_SUPPORTED);
    expect(plan.checks.map((c) => c.evidenceId)).toEqual(["ev-q", "ev-noq", "ev-dec", "ev-unsourced"]);
    expect(plan.judgments.some((j) => j.evidenceId === "ev-unsourced")).toBe(false);
  });

  it("new_version: judgments carry the unsupported verdict too, and every judgment equals its check", async () => {
    const plan = await planPrincipleGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim", principleType: "observed" } }, gateBy([DECISION_TEXT]));
    expect(plan.action).toBe("new_version");
    if (plan.action !== "new_version") throw new Error("expected new_version");
    expect(plan.judgments.map((j) => [j.evidenceId, j.verdict])).toEqual([["ev-q", "supported"], ["ev-noq", "supported"], ["ev-dec", "unsupported"]]);
    for (const j of plan.judgments) expect(plan.checks.find((c) => c.evidenceId === j.evidenceId)).toEqual({ evidenceId: j.evidenceId, verdict: j.verdict, reason: j.reason });
    expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([3, 0]);
  });

  it("technical failure: there is no judgment at all, not even for the citations judged before it", async () => {
    const gate = async (i: EvidenceGroundingCheckInput): Promise<EvidenceGroundingResult> =>
      i.sourceAnswerText === DECISION_TEXT ? { verdict: "unsupported", reason: "Grounding check call failed — failing closed.", technicalFailure: true } : { verdict: "supported", reason: "ok" };
    const dna = await planGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim" } }, gate);
    const strategy = await planPrincipleGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim", principleType: "observed" } }, gate);
    for (const plan of [dna, strategy]) {
      expect(plan).toEqual({ action: "technical_failure", failures: [{ evidenceId: "ev-dec", reason: "Grounding check call failed — failing closed." }] });
      expect("judgments" in plan).toBe(false);
    }
  });

  it("a judgment names the evidence row and never copies the investor's text or the question", async () => {
    const plan = await planGroundingRemediation({ ...input(ALL), currentVersion: { id: "v1", statementText: "claim" } }, gateBy([]));
    if (plan.action !== "no_op") throw new Error("expected no_op");
    for (const j of plan.judgments) expect(Object.keys(j).sort()).toEqual(["contextSupplied", "evidenceId", "reason", "verdict"]);
    const serialized = JSON.stringify(plan);
    for (const text of [ANSWER_WITH_Q, ANSWER_NO_Q, DECISION_TEXT, QUESTION]) expect(serialized).not.toContain(text);
  });
});

describe("run identity", () => {
  const saved = { a: process.env.VERCEL_GIT_COMMIT_SHA, b: process.env.GIT_COMMIT_SHA };
  afterEach(() => {
    for (const [k, v] of [["VERCEL_GIT_COMMIT_SHA", saved.a], ["GIT_COMMIT_SHA", saved.b]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("takes the contract and the rule from the running code, the code version from the runtime, and normalizes the id", () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.GIT_COMMIT_SHA = "abc123";
    expect(buildGroundingRun({ runId: "0B9C2E7A-3F1D-4C5B-8A6E-1D2F3A4B5C6D", model: "claude-sonnet-5" })).toEqual({
      runId: "0b9c2e7a-3f1d-4c5b-8a6e-1d2f3a4b5c6d",
      contract: AI_CONTRACTS.evidenceGrounding,
      semanticRule: STANCE_SEMANTICS_VERSION,
      model: "claude-sonnet-5",
      codeVersion: "abc123",
    });
    delete process.env.GIT_COMMIT_SHA;
    expect(buildGroundingRun({ runId: "0b9c2e7a-3f1d-4c5b-8a6e-1d2f3a4b5c6d", model: "m" }).codeVersion).toBeNull();
  });

  it("refuses an id that is not a uuid — a timestamp or a label is never a run identity — and a run without a model", () => {
    for (const runId of ["", "2026-09-27T00:00:00Z", "1790470373015", "v3-2-final-run", "0b9c2e7a-3f1d-4c5b-8a6e"]) expect(() => buildGroundingRun({ runId, model: "m" })).toThrow(/uuid/);
    expect(() => buildGroundingRun({ runId: "0b9c2e7a-3f1d-4c5b-8a6e-1d2f3a4b5c6d", model: "  " })).toThrow(/model/);
  });
});

describe("V3.2 contrast clarification through the real pipeline (reference gate)", () => {
  const C = {
    INDEPENDENT: "You tend to sell winning positions out of fear of losing the gain, without a predefined price target.",
    RESTATES: "You tend to cut losing positions rather than hold them.",
    AMBIGUOUS: "You tend to hold onto positions without a plan.",
  } as const;
  const T = {
    FEAR_SALE: "It was a winning position and I sold it because I was afraid of losing the gain.",
    FEAR_SALE_NO_TARGET: "I had no price target; it was a winning position and I sold it because I was afraid of losing the gain.",
    KEPT_WINNER: "It was a winning position and I deliberately kept holding it.",
    CUT_LOSER: "It was a losing position and I cut it.",
    KEPT_LOSER: "It was a losing position and I kept holding it.",
    HOLDING: "I am still holding.",
    HOLDING_NO_PLAN: "I am still holding and I have no plan for it.",
  } as const;
  const WORLD: ReferenceWorld = {
    claims: {
      // an independent property: required for SUPPORT, never for CONTRADICTION
      [C.INDEPENDENT]: { support: [["WIN", "SELL", "FEAR", "NO_TARGET"]], contradict: [["WIN", "HOLD"]] },
      // restates the behavior: no requirement of its own
      [C.RESTATES]: { support: [["LOSING", "CUT"]], contradict: [["LOSING", "HOLD"]] },
      // role unclear: fail closed, required
      [C.AMBIGUOUS]: { support: [["HOLD", "NO_PLAN"]], contradict: [["SELL"]] },
    },
    says: {
      [T.FEAR_SALE]: ["WIN", "SELL", "FEAR"],
      [T.FEAR_SALE_NO_TARGET]: ["WIN", "SELL", "FEAR", "NO_TARGET"],
      [T.KEPT_WINNER]: ["WIN", "HOLD"],
      [T.CUT_LOSER]: ["LOSING", "CUT"],
      [T.KEPT_LOSER]: ["LOSING", "HOLD"],
      [T.HOLDING]: ["HOLD"],
      [T.HOLDING_NO_PLAN]: ["HOLD", "NO_PLAN"],
    },
    reasonAnswers: new Set<string>(),
    asks: {},
  };
  const KEYS = Object.keys(T) as (keyof typeof T)[];
  const ids = Object.fromEntries(KEYS.map((k) => [k, `ans-${k.toLowerCase()}`])) as Record<keyof typeof T, string>;
  const contrastResolver = createIndependenceResolver(
    contextFromTrades(
      KEYS.map((k, i) => ({ id: `t-${k}`, ticker: `TK${i}`, type: "buy" as const, date: "2026-01-05" })),
      KEYS.map((k) => ({ id: ids[k], txn: `t-${k}`, text: T[k] }))
    )
  );
  const texts = new Map(KEYS.map((k) => [ids[k], T[k]] as [string, string]));
  const counts = async (claim: string, key: keyof typeof T, stance: "supporting" | "contradicting") => {
    const validated = validateProposedHypotheses([{ statement: claim, evidence: [{ statementId: ids[key], stance, description: "d" }] }], contrastResolver);
    const h = (await groundValidatedHypotheses(validated, texts, contrastResolver, referenceGate(WORLD))).hypotheses[0];
    return h ? [h.supportingCount, h.contradictingCount] : null;
  };

  it("independent property: required to SUPPORT the whole claim", async () => {
    expect(await counts(C.INDEPENDENT, "FEAR_SALE", "supporting")).toBeNull();
    expect(await counts(C.INDEPENDENT, "FEAR_SALE_NO_TARGET", "supporting")).toEqual([1, 0]);
  });
  it("independent property: CONTRADICTION needs only the frozen components, never the contrast", async () => {
    expect(await counts(C.INDEPENDENT, "KEPT_WINNER", "contradicting")).toEqual([0, 1]);
  });
  it("a contrast that restates the behavior is not double-counted", async () => {
    expect(await counts(C.RESTATES, "CUT_LOSER", "supporting")).toEqual([1, 0]);
    expect(await counts(C.RESTATES, "KEPT_LOSER", "contradicting")).toEqual([0, 1]);
  });
  it("an ambiguous contrast fails closed: treated as required", async () => {
    expect(await counts(C.AMBIGUOUS, "HOLDING", "supporting")).toBeNull();
    expect(await counts(C.AMBIGUOUS, "HOLDING_NO_PLAN", "supporting")).toEqual([1, 0]);
  });
});

describe("read isolation: the audit ledger is never a semantic input", () => {
  const ROOT = path.resolve(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");
  const files = walk(ROOT).map((f) => ({ file: rel(f), source: fs.readFileSync(f, "utf8") }));
  // the table object, the repository module and everything it exports
  const USES = /\bgroundingJudgments\b|repositories\/grounding-judgments|\.\/grounding-judgments["']|\bapply(Dna|Strategy)GroundingRemediation\b|\blistGroundingJudgmentsForRun\b|\bGroundingJudgmentRow\b/;
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("only the schema and the one repository module use the table or the repository", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => USES.test(code(f.source))).map((f) => f.file).sort()).toEqual([
      "src/db/repositories/grounding-judgments.ts",
      "src/db/schema/grounding-judgments.ts",
      "src/db/schema/index.ts",
    ]);
  });

  it("no semantic consumer names the ledger, in code or in SQL", () => {
    const semantic = files.filter((f) =>
      /^src\/(server\/routers|lib\/ai|lib\/dna|lib\/strategy|lib\/learning|lib\/prior-record|lib\/monitoring|lib\/portfolio|app)\//.test(f.file) ||
      /^src\/lib\/evidence\/(?!grounding-run\.ts)/.test(f.file) ||
      /^src\/db\/repositories\/(?!grounding-judgments\.ts)/.test(f.file)
    );
    expect(semantic.length).toBeGreaterThan(60);
    for (const f of semantic) expect(code(f.source), f.file).not.toMatch(/grounding_judgments|groundingJudgments|grounding-judgments/);
  });

  it("the repository is append-only and the planners never reach the database", () => {
    const repo = code(files.find((f) => f.file === "src/db/repositories/grounding-judgments.ts")!.source);
    expect(repo).not.toMatch(/\.update\(|\.delete\(|onConflictDoUpdate|\bsql`/);
    expect(repo.match(/\.insert\(/g)).toHaveLength(1);
    for (const planner of ["src/lib/dna/remediate-grounding.ts", "src/lib/strategy/remediate-grounding.ts", "src/lib/evidence/grounding-run.ts"]) {
      expect(code(files.find((f) => f.file === planner)!.source), planner).not.toMatch(/@\/db\/|drizzle-orm/);
    }
  });

  it("the ledger has no relation, so no relational query can pull it in beside evidence or a version", () => {
    expect(code(files.find((f) => f.file === "src/db/schema/relations.ts")!.source)).not.toMatch(/groundingJudgments|grounding-judgments/);
  });
});
