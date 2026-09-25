// Evidence Reach V1 — Unit 1 (semantic foundation) and Unit 2 (reach engine),
// pure: the statement-id contract, OD-2 decision case resolution, the shared
// resolver with decision statements (explicit case traces A–N), the tier
// distance search (exhaustive), the reach summary and its regenerate
// done-condition, the OD-3 carry (cases + grounding gate) and the
// next-action catalogue with its day boundaries.
import { describe, expect, it } from "vitest";
import {
  DECISION_STATEMENT_KINDS,
  EVIDENCE_SOURCE_CONTRACT_VERSION,
  evidenceSourceColumnsOf,
  formatDecisionStatementId,
  parseStatementId,
  statementIdOf,
  statementKeyOf,
} from "@/lib/evidence/statement-ref";
import { decisionStatementsOf, type DecisionStatement } from "@/lib/evidence/decision-statements";
import { executableCandidateIds, resolveDecisionCase, resolveDecisionCases, type DecisionForCases, type TransactionForCases } from "@/lib/evidence/decision-cases";
import {
  INDEPENDENCE_POLICY,
  INDEPENDENCE_POLICY_VERSION,
  assessCitations,
  citationKey,
  createIndependenceResolver,
  type EvidenceCitation,
  type IndependenceContext,
  type IndependenceBasis,
} from "@/lib/evidence/resolve-independence";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { validateProposedObservedPrinciples } from "@/lib/strategy/validate-principles";
import { calculateEvidenceStrength, excludeInsufficientEvidence, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { computeClaimReach, distanceToNextTier, summarizeReach, type ClaimForReach } from "@/lib/evidence/reach";
import { buildLearningCarryCases, citedReviewsOfVersion, groundCarryCitations } from "@/lib/learning/carry-to-dna";
import { buildProvenance } from "@/lib/evidence/provenance";
import { fingerprintEntriesOf, fingerprintOfVersion, learningEvidenceFingerprint } from "@/lib/learning/evidence-fingerprint";
import { buildInvestorStatements, formatInvestorStatements, INVESTOR_STATEMENT_RULES } from "@/lib/ai/investor-statements";
import { deriveNextActions, NEXT_ACTION_KINDS, REVIEW_WITHOUT_HORIZON_NUDGE_DAYS, STALLED_CASE_DAYS, type NextActionsInput } from "@/lib/next-actions/next-actions";
import { ATTENTION_REASONS } from "@/lib/monitoring/decision-attention";
import { contextFromTrades, type TradeSpec, type AnswerSpec } from "../helpers/independence";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TIERS: EvidenceStrength[] = ["insufficient_evidence", "weak", "moderate", "strong"];
const rank = (t: EvidenceStrength) => TIERS.indexOf(t);

describe("statement-id contract (Unit 1)", () => {
  it("has exactly three decision statement kinds and a frozen contract + policy version (day tolerance is part of the policy)", () => {
    expect(DECISION_STATEMENT_KINDS).toEqual(["reasoning", "risks", "exit_conditions"]);
    expect(EVIDENCE_SOURCE_CONTRACT_VERSION).toBe("evidence-source-v1");
    expect(INDEPENDENCE_POLICY_VERSION).toBe("independence-policy-v2");
    expect(INDEPENDENCE_POLICY).toEqual({ maxGapDays: 14, isolationMarginDays: 3, decisionCases: "evidence-source-v1", candidateDayTolerance: 1 });
  });

  it("parses an answer id and a decision statement id, and nothing else", () => {
    expect(parseStatementId(U1)).toEqual({ interviewAnswerId: U1, decisionStatement: null });
    expect(parseStatementId(`decision:${U2}:risks`)).toEqual({ interviewAnswerId: null, decisionStatement: { decisionId: U2, kind: "risks" } });
    // No id form exists for AI text, post-decision text, reviews, outcomes, predictions, later context, snapshots, notes, origins.
    for (const bad of [
      "", "personal-fit:1", `review:${U1}`, `later-context:${U1}`, `decision:${U1}:ai_assessment`, `decision:${U1}:later_context`,
      `decision:${U1}:outcome`, `decision:${U1}:execution_note`, `decision:${U1}:reasoning:extra`, "decision::reasoning", `decision:${U1}:`,
      `evidence:${U1}`, `answer:${U1}`, `DECISION:${U1}:reasoning`, `origin_prediction:${U1}`, `snapshot:${U1}:userReasoningText`,
      42, null, undefined, { decisionId: U1 },
    ]) {
      expect(parseStatementId(bad as never)).toBeNull();
    }
    // Ids are opaque: colon-free raw text has the SHAPE of an answer id and is rejected one gate later — hasStatement knows only persisted rows.
    const raw = "I bought because valuation looked attractive.";
    expect(parseStatementId(raw)).toEqual({ interviewAnswerId: raw, decisionStatement: null });
    expect(createIndependenceResolver(contextFromTrades([], [{ id: "a1", txn: null, text: raw }])).hasStatement({ interviewAnswerId: raw })).toBe(false);
  });

  it("round-trips ids and keys and maps to the evidence columns", () => {
    const ref = { decisionId: U1, kind: "exit_conditions" as const };
    const id = formatDecisionStatementId(ref);
    expect(id).toBe(`decision:${U1}:exit_conditions`);
    expect(statementIdOf({ interviewAnswerId: null, decisionStatement: ref })).toBe(id);
    expect(statementIdOf({ interviewAnswerId: U2 })).toBe(U2);
    expect(statementIdOf({ interviewAnswerId: null })).toBeNull();
    expect(statementKeyOf({ interviewAnswerId: U2 })).toBe(`answer:${U2}`);
    expect(statementKeyOf({ interviewAnswerId: null, decisionStatement: ref })).toBe(id);
    expect(statementKeyOf({ interviewAnswerId: null })).toBe("unsourced");
    expect(evidenceSourceColumnsOf({ interviewAnswerId: null, decisionStatement: ref })).toEqual({ interviewAnswerId: null, decisionId: U1, decisionStatementKind: "exit_conditions" });
    expect(evidenceSourceColumnsOf({ interviewAnswerId: U2 })).toEqual({ interviewAnswerId: U2, decisionId: null, decisionStatementKind: null });
    expect(citationKey({ interviewAnswerId: null, decisionStatement: ref, stance: "contradicting" })).toBe(`${id}::contradicting`);
  });

  it("projects only the three investor-authored texts of a decision, verbatim, skipping empty ones", () => {
    const row = { id: U1, ticker: "LLY", decisionType: "BUY", decisionDate: d("2026-08-19"), createdAt: d("2026-08-19"), userReasoningText: "  my reasoning ", risksConsideredText: "   ", exitConditionsText: null };
    const out = decisionStatementsOf(row);
    expect(out.map((s) => s.kind)).toEqual(["reasoning"]);
    expect(out[0]!.text).toBe("  my reasoning "); // never trimmed or rewritten
    expect(out[0]!.statementId).toBe(`decision:${U1}:reasoning`);
    // Nothing else on a decision is projectable: the projection reads only these three fields.
    expect(Object.keys(row).filter((k) => k.endsWith("Text"))).toEqual(["userReasoningText", "risksConsideredText", "exitConditionsText"]);
  });
});

// ---- OD-2 -----------------------------------------------------------------
const trades: TransactionForCases[] = [
  { id: "t-avgo-before", ticker: "AVGO", transactionType: "buy", transactionDate: d("2026-09-02") },
  { id: "t-avgo-dayminus1", ticker: "AVGO", transactionType: "buy", transactionDate: d("2026-09-07") },
  { id: "t-avgo-same", ticker: "AVGO", transactionType: "buy", transactionDate: d("2026-09-08") },
  { id: "t-avgo-after", ticker: "AVGO", transactionType: "buy", transactionDate: d("2026-09-10") },
  { id: "t-avgo-sell", ticker: "AVGO", transactionType: "sell", transactionDate: d("2026-09-12") },
  { id: "t-sndk-after", ticker: "SNDK", transactionType: "buy", transactionDate: d("2026-08-24") },
  { id: "t-other", ticker: "MU", transactionType: "buy", transactionDate: d("2026-09-09") },
];
const buyAvgo: DecisionForCases = { id: "d-avgo", ticker: "AVGO", decisionType: "BUY", decisionDate: new Date("2026-09-08T22:30:00Z") };
const passSndk: DecisionForCases = { id: "d-sndk", ticker: "SNDK", decisionType: "PASS", decisionDate: d("2026-08-20") };
const holdAvgo: DecisionForCases = { id: "d-hold", ticker: "AVGO", decisionType: "HOLD", decisionDate: d("2026-09-01") };
const sellAvgo: DecisionForCases = { id: "d-sell", ticker: "avgo", decisionType: "SELL", decisionDate: d("2026-09-11") };

describe("OD-2 decision case resolution (pure)", () => {
  it("candidates: same ticker (case-insensitive), executable side, on/after the decision UTC day minus the policy tolerance; never earlier", () => {
    expect(executableCandidateIds(buyAvgo, trades)).toEqual(["t-avgo-after", "t-avgo-dayminus1", "t-avgo-same"]);
    expect(executableCandidateIds(sellAvgo, trades)).toEqual(["t-avgo-sell"]);
    expect(executableCandidateIds(passSndk, trades)).toEqual([]);
    expect(executableCandidateIds(holdAvgo, trades)).toEqual([]);
  });

  it("day−1 chronology attack: the UTC-day−1 trade is a SUPERSET member for every zone — it can only make the decision UNRESOLVED, never merged, never counted", () => {
    // Decision instant 22:30Z on 09-08: local day is 09-08 (UTC), 09-09 (Asia/Jerusalem, UTC+3) or 09-08 (America/New_York).
    // A date-only trade on 09-07 is BEFORE the decision day in every one of those zones — still a candidate here (tolerance), never an execution.
    const r = resolveDecisionCase(buyAvgo, [trades.find((t) => t.id === "t-avgo-dayminus1")!], []);
    expect(r).toEqual({ kind: "unresolved", candidateTransactionIds: ["t-avgo-dayminus1"] });
    // A genuinely earlier trade (two days before) is never a candidate: own case, nothing to classify.
    expect(resolveDecisionCase(buyAvgo, [trades.find((t) => t.id === "t-avgo-before")!], [])).toEqual({ kind: "own" });
    // Wrong side and other tickers never become candidates, whatever the day.
    expect(resolveDecisionCase(buyAvgo, [trades.find((t) => t.id === "t-avgo-sell")!, trades.find((t) => t.id === "t-other")!], [])).toEqual({ kind: "own" });
    // A decision at 01:00Z on 09-09 is still 09-08 in New York: the product's zone-aware candidate list starts at 09-08; the superset starts at 09-08 too (utc day 09-09 − 1).
    const lateNight: DecisionForCases = { ...buyAvgo, decisionDate: new Date("2026-09-09T01:00:00Z") };
    expect(executableCandidateIds(lateNight, trades)).toEqual(["t-avgo-after", "t-avgo-same"]);
    // The only way OUT of unresolved is an investor-asserted fact (either verdict) — there is no inference path.
    expect(resolveDecisionCase(buyAvgo, [trades.find((t) => t.id === "t-avgo-dayminus1")!], [{ decisionId: "d-avgo", transactionId: "t-avgo-dayminus1", verdict: "unrelated" }])).toEqual({ kind: "own" });
  });

  it("C. executable candidates, none classified -> UNRESOLVED (never own, never merged)", () => {
    expect(resolveDecisionCase(buyAvgo, trades, [])).toEqual({ kind: "unresolved", candidateTransactionIds: ["t-avgo-after", "t-avgo-dayminus1", "t-avgo-same"] });
  });

  it("A/G. an effective executed fact merges the decision with that transaction; several executed trades are still ONE case", () => {
    expect(resolveDecisionCase(buyAvgo, trades, [{ decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "executed" }])).toEqual({ kind: "merged", executedFactIds: [], transactionIds: ["t-avgo-same"] });
    expect(
      resolveDecisionCase(buyAvgo, trades, [
        { decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "executed" },
        { decisionId: "d-avgo", transactionId: "t-avgo-after", verdict: "executed" },
        { decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "executed" }, // duplicate row
      ])
    ).toEqual({ kind: "merged", executedFactIds: [], transactionIds: ["t-avgo-after", "t-avgo-same"] });
  });

  it("F. unrelated facts classify but never merge; all candidates unrelated -> own case", () => {
    expect(resolveDecisionCase(buyAvgo, trades, [{ decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "unrelated" }])).toEqual({ kind: "unresolved", candidateTransactionIds: ["t-avgo-after", "t-avgo-dayminus1"] });
    expect(
      resolveDecisionCase(buyAvgo, trades, [
        { decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "unrelated" },
        { decisionId: "d-avgo", transactionId: "t-avgo-after", verdict: "unrelated" },
        { decisionId: "d-avgo", transactionId: "t-avgo-dayminus1", verdict: "unrelated" },
      ])
    ).toEqual({ kind: "own" });
  });

  it("D/E. PASS and HOLD are their own case; a decision with no executable candidate is its own case", () => {
    expect(resolveDecisionCase(passSndk, trades, [])).toEqual({ kind: "own" });
    expect(resolveDecisionCase(holdAvgo, trades, [])).toEqual({ kind: "own" });
    expect(resolveDecisionCase({ ...buyAvgo, ticker: "NVDA" }, trades, [])).toEqual({ kind: "own" });
  });

  it("B. facts of ANOTHER decision never bridge; the loader hands EFFECTIVE facts only, so a superseded fact is simply absent", () => {
    expect(resolveDecisionCase(buyAvgo, trades, [{ decisionId: "d-other", transactionId: "t-avgo-same", verdict: "executed" }]).kind).toBe("unresolved");
    expect(resolveDecisionCase(buyAvgo, trades, [{ decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "unrelated" }, { decisionId: "d-avgo", transactionId: "t-avgo-after", verdict: "executed" }])).toEqual({ kind: "merged", executedFactIds: [], transactionIds: ["t-avgo-after"] });
  });

  it("resolves every decision deterministically as a map", () => {
    const m = resolveDecisionCases([buyAvgo, passSndk], trades, []);
    expect([...m.keys()]).toEqual(["d-avgo", "d-sndk"]);
    expect(m.get("d-sndk")).toEqual({ kind: "own" });
  });
});

// ---- resolver with decision statements: explicit case traces A–N ---------
const TRADES: TradeSpec[] = [
  { id: "mp-buy", ticker: "MP", type: "buy", date: "2026-08-05" },
  { id: "mp-sell", ticker: "MP", type: "sell", date: "2026-08-28" },
  { id: "lly-buy", ticker: "LLY", type: "buy", date: "2026-08-20" },
  { id: "lly-buy2", ticker: "LLY", type: "buy", date: "2026-08-22" },
  { id: "nvda-buy", ticker: "NVDA", type: "buy", date: "2026-05-01" },
  { id: "nvda-sell", ticker: "NVDA", type: "sell", date: "2026-06-01" },
  { id: "nvda-buy2", ticker: "NVDA", type: "buy", date: "2026-07-01" },
];
const ANSWERS: AnswerSpec[] = [
  { id: "a-mp", txn: "mp-buy", text: "MP entry" },
  { id: "a-lly", txn: "lly-buy", text: "LLY entry" },
  { id: "a-nvda", txn: "nvda-buy", text: "NVDA first entry" },
  { id: "a-nvda2", txn: "nvda-buy2", text: "NVDA second entry" },
];
function ctx(decisions: IndependenceContext["decisions"]): IndependenceContext {
  return { ...contextFromTrades(TRADES, ANSWERS), decisions };
}
const ds = (decisionId: string, kind: "reasoning" | "risks" | "exit_conditions", stance: "supporting" | "contradicting" = "supporting"): EvidenceCitation => ({ interviewAnswerId: null, decisionStatement: { decisionId, kind }, stance });
const ans = (id: string, stance: "supporting" | "contradicting" = "supporting"): EvidenceCitation => ({ interviewAnswerId: id, stance });

/** A readable trace of one resolution: citation -> group key / stance, plus the counts. */
function trace(basis: IndependenceBasis) {
  return {
    groups: basis.groups.map((g) => ({ key: g.key, stance: g.stance, citations: g.citations, reasons: g.reasons.map((r) => r.kind) })),
    S: basis.supportingLower,
    C: basis.contradictingUpper,
    unresolved: basis.unresolvedDecisionIds ?? [],
  };
}

describe("shared resolver with decision statements — case traces A–N (Unit 1 / OD-2)", () => {
  const episodeOf = (txn: string) => contextFromTrades(TRADES, ANSWERS).episodeKeyByTransactionId.get(txn)!;
  it("NVDA has two accounting episodes in the fixture (closed then re-opened)", () => {
    expect(episodeOf("nvda-buy")).not.toBe(episodeOf("nvda-buy2"));
    expect(episodeOf("lly-buy")).toBe(episodeOf("lly-buy2"));
  });

  it("A. decision only -> one own case", () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }]));
    expect(trace(r.resolve([ds("d1", "reasoning")]))).toEqual({ groups: [{ key: "decision:d1", stance: "supporting", citations: ["decision:d1:reasoning"], reasons: ["decision_case"] }], S: 1, C: 0, unresolved: [] });
  });

  it("B. decision + executed transaction -> the decision joins the trade's episode: one case", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy"] } }]));
    const t = trace(r.resolve([ds("d-lly", "reasoning")]));
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0]!.reasons.sort()).toEqual(["decision_case", "same_episode"]);
    expect(t.S).toBe(1);
  });

  it("C. decision + executed transaction + interview answer about the same episode -> ONE case", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy"] } }]));
    const t = trace(r.resolve([ds("d-lly", "reasoning"), ans("a-lly")]));
    expect(t).toMatchObject({ S: 1, C: 0 });
    expect(t.groups[0]!.citations).toEqual(["answer:a-lly", "decision:d-lly:reasoning"]);
  });

  it("D. decision + several executed transactions in ONE episode -> one case", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy", "lly-buy2"] } }]));
    expect(trace(r.resolve([ds("d-lly", "reasoning"), ans("a-lly")]))).toMatchObject({ S: 1, C: 0 });
  });

  it("E. decision + executed transactions in DIFFERENT episodes -> the decision is one case that bridges both episodes (union); without the decision cited, the episodes stay separate", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-nvda", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["nvda-buy", "nvda-buy2"] } }]));
    expect(trace(r.resolve([ds("d-nvda", "reasoning"), ans("a-nvda"), ans("a-nvda2")]))).toMatchObject({ S: 1, C: 0 });
    // the decision never becomes two cases
    expect(trace(r.resolve([ds("d-nvda", "reasoning"), ds("d-nvda", "risks")])).groups).toHaveLength(1);
    // elsewhere (no decision citation) the two NVDA episodes remain two cases — determinism of the accounting key is untouched
    expect(trace(r.resolve([ans("a-nvda"), ans("a-nvda2")]))).toMatchObject({ S: 2, C: 0 });
  });

  it("F. two decisions linked (executed) to the same episode -> one case, not two", () => {
    const r = createIndependenceResolver(ctx([
      { id: "d-lly-1", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy"] } },
      { id: "d-lly-2", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy2"] } },
    ]));
    expect(trace(r.resolve([ds("d-lly-1", "reasoning"), ds("d-lly-2", "reasoning")]))).toMatchObject({ S: 1, C: 0 });
  });

  it("G. same ticker, two separate episodes, no executed facts -> two cases (never merged by ticker)", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-mp2", caseResolution: { kind: "own" } }]));
    expect(trace(r.resolve([ds("d-mp2", "reasoning"), ans("a-mp")]))).toMatchObject({ S: 2, C: 0 });
  });

  it("H. PASS then later BUY on one ticker -> two own cases", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-pass", caseResolution: { kind: "own" } }, { id: "d-buy", caseResolution: { kind: "own" } }]));
    expect(trace(r.resolve([ds("d-pass", "reasoning"), ds("d-buy", "reasoning")]))).toMatchObject({ S: 2, C: 0 });
  });

  it("I. an unrelated execution fact classifies without merging -> own case beside the episode's answer", () => {
    // resolution "own" is what resolveDecisionCase yields once every candidate is `unrelated`
    const r = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "own" } }]));
    expect(trace(r.resolve([ds("d-lly", "reasoning"), ans("a-lly")]))).toMatchObject({ S: 2, C: 0 });
  });

  it("J/K. supersession is resolved BEFORE the resolver: unrelated->executed = merged; executed->unrelated = own (the loader hands chain heads only)", () => {
    const merged = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy"] } }]));
    const own = createIndependenceResolver(ctx([{ id: "d-lly", caseResolution: { kind: "own" } }]));
    expect(trace(merged.resolve([ds("d-lly", "reasoning"), ans("a-lly")])).S).toBe(1);
    expect(trace(own.resolve([ds("d-lly", "reasoning"), ans("a-lly")])).S).toBe(2);
  });

  it("L. unclassified executable candidate -> UNRESOLVED: counted on neither side, reported", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-u", caseResolution: { kind: "unresolved", candidateTransactionIds: ["lly-buy"] } }]));
    expect(trace(r.resolve([ds("d-u", "reasoning"), ans("a-nvda")]))).toEqual({ groups: [{ key: `episode:${episodeOf("nvda-buy")}`, stance: "supporting", citations: ["answer:a-nvda"], reasons: ["same_episode"] }], S: 1, C: 0, unresolved: ["d-u"] });
    expect(trace(r.resolve([ds("d-u", "reasoning", "contradicting"), ans("a-nvda")]))).toMatchObject({ S: 1, C: 0, unresolved: ["d-u"] });
    expect(r.resolve([ds("d-u", "reasoning")]).groups).toHaveLength(0);
    expect(calculateEvidenceStrength(r.resolve([ds("d-u", "reasoning")]).confidenceInputs.supporting, 0)).toBe("insufficient_evidence");
  });

  it("M. several statements from one decision supporting one hypothesis -> one case (OD-2 G)", () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }]));
    const t = trace(r.resolve([ds("d1", "reasoning"), ds("d1", "risks"), ds("d1", "exit_conditions")]));
    expect(t).toEqual({ groups: [{ key: "decision:d1", stance: "supporting", citations: ["decision:d1:exit_conditions", "decision:d1:reasoning", "decision:d1:risks"], reasons: ["decision_case"] }], S: 1, C: 0, unresolved: [] });
  });

  it("N. reasoning supports while risks contradicts within one decision -> that ONE case is contradicting: S=0, C=1 — never S=1 AND C=1", () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }]));
    const t = trace(r.resolve([ds("d1", "reasoning", "supporting"), ds("d1", "risks", "contradicting"), ds("d1", "exit_conditions", "supporting")]));
    expect(t).toMatchObject({ S: 0, C: 1 });
    expect(t.groups).toHaveLength(1);
    expect(calculateEvidenceStrength(t.S, t.C)).toBe("insufficient_evidence");
  });

  it("an unknown decision id collapses to the unmapped sentinel; hasStatement gates this investor's decisions only", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-pass", caseResolution: { kind: "own" } }]));
    expect(r.hasStatement({ interviewAnswerId: null, decisionStatement: { decisionId: "d-pass", kind: "risks" } })).toBe(true);
    expect(r.hasStatement({ interviewAnswerId: null, decisionStatement: { decisionId: "ghost", kind: "risks" } })).toBe(false);
    const unknown = r.resolve([ds("ghost-1", "reasoning"), ds("ghost-2", "reasoning")]);
    expect(unknown.supportingLower).toBe(1);
    expect(unknown.groups[0]!.reasons).toEqual([{ kind: "unmapped", ref: "unmapped" }]);
  });

  it("cross-investor: a decision absent from the context is never a persisted statement (both validators drop it)", () => {
    const r = createIndependenceResolver(ctx([{ id: "mine", caseResolution: { kind: "own" } }]));
    const proposed = [{ statement: "claim", evidence: [
      { statementId: "decision:44444444-4444-4444-8444-444444444444:reasoning", stance: "supporting" as const, description: "another investor's decision" },
      { statementId: "decision:theirs:reasoning", stance: "supporting" as const, description: "not in this investor's context" },
    ] }];
    expect(validateProposedHypotheses(proposed, r)).toEqual([]);
    expect(validateProposedObservedPrinciples(proposed, r)).toEqual([]);
    expect(parseStatementId("decision:theirs:reasoning")).toEqual({ interviewAnswerId: null, decisionStatement: { decisionId: "theirs", kind: "reasoning" } });
  });

  it("validators accept a decision statement id of a real decision and count it through the resolver — identically for DNA and Strategy", () => {
    const r = createIndependenceResolver(ctx([{ id: U1, caseResolution: { kind: "own" } }, { id: U2, caseResolution: { kind: "unresolved", candidateTransactionIds: ["x"] } }]));
    const proposed = [{ statement: "claim", evidence: [
      { statementId: `decision:${U1}:reasoning`, stance: "supporting" as const, description: "d" },
      { statementId: `decision:${U1}:risks`, stance: "supporting" as const, description: "d" },
      { statementId: `decision:${U2}:reasoning`, stance: "supporting" as const, description: "unresolved" },
      { statementId: "a-nvda", stance: "supporting" as const, description: "a real answer: a second, separate case" },
      { statementId: "answer:a-nvda", stance: "supporting" as const, description: "a key form, not an id: dropped" },
    ] }];
    const [h] = validateProposedHypotheses(proposed, r);
    expect(h!.evidence).toHaveLength(4);
    expect(h!.supportingCount).toBe(2);
    expect(h!.independenceBasis.unresolvedDecisionIds).toEqual([U2]);
    expect(h!.evidence[0]).toMatchObject({ interviewAnswerId: null, decisionStatement: { decisionId: U1, kind: "reasoning" } });
    const [p] = validateProposedObservedPrinciples(proposed, r);
    expect(p!.supportingCount).toBe(2);
    expect(p!.independenceBasis).toEqual(h!.independenceBasis);
  });

  it("assessCitations over decision statements never exceeds the tier the same counts give an answers-only claim", () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }, { id: "d2", caseResolution: { kind: "own" } }, { id: "d3", caseResolution: { kind: "own" } }]));
    const a = assessCitations(r, [ds("d1", "reasoning"), ds("d2", "reasoning"), ds("d3", "reasoning")]);
    expect(a.supportingCount).toBe(3);
    expect(a.evidenceStrength).toBe(calculateEvidenceStrength(3, 0));
  });
});

// ---- reach engine (Unit 2) ------------------------------------------------
describe("reach math (exhaustive over S,C in 0..25)", () => {
  it("distance is exact (first k that raises the tier, target named), the tier is monotone non-increasing in C, and unresolved never enters", () => {
    for (let s = 0; s <= 25; s++) {
      for (let c = 0; c <= 25; c++) {
        const tier = calculateEvidenceStrength(s, c);
        const dist = distanceToNextTier(s, c);
        if (dist === null) {
          expect(tier).toBe("strong");
          continue;
        }
        expect(rank(calculateEvidenceStrength(s + dist.additionalSupportingCases, c))).toBeGreaterThan(rank(tier));
        expect(rank(calculateEvidenceStrength(s + dist.additionalSupportingCases - 1, c))).toBe(rank(tier));
        expect(calculateEvidenceStrength(s + dist.additionalSupportingCases, c)).toBe(dist.nextTier);
        expect(dist.additionalSupportingCases).toBeGreaterThanOrEqual(1);
        // a contradiction never raises the tier reachable with the same supporting cases
        expect(rank(calculateEvidenceStrength(s, c + 1))).toBeLessThanOrEqual(rank(tier));
        // sample-size gate: below 3 supporting cases nothing but insufficient, whatever C
        if (s < 3) expect(tier).toBe("insufficient_evidence");
      }
    }
    // a contradiction can LOWER the current tier and therefore change which tier is "next" — the distance names its target, so it is never read as "one more answer promotes you"
    expect(distanceToNextTier(3, 2)).toEqual({ nextTier: "strong", additionalSupportingCases: 5 });
    expect(distanceToNextTier(3, 3)).toEqual({ nextTier: "moderate", additionalSupportingCases: 2 });
    expect(distanceToNextTier(2, 0)).toEqual({ nextTier: "moderate", additionalSupportingCases: 1 });
    expect(distanceToNextTier(2, 5)).toEqual({ nextTier: "weak", additionalSupportingCases: 1 });
    expect(distanceToNextTier(5, 0)).toBeNull();
  });

  it("visibleToAi is exactly the production filter (excludeInsufficientEvidence) for every tier — weak IS visible", () => {
    const r = createIndependenceResolver(ctx([]));
    for (const tier of TIERS) {
      const reach = computeClaimReach({ id: "x", kind: "dna_hypothesis", statementText: "s", evidenceStrength: tier, supportingCount: 0, contradictingCount: 0, effective: [], generatedAt: null }, r);
      expect(reach.visibleToAi).toBe(excludeInsufficientEvidence([{ evidenceStrength: tier }]).length === 1);
    }
  });

  it("a claim's reach reports sources by kind, AI visibility by tier, unresolved decisions, and never changes the stored counts", () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }, { id: "d-u", caseResolution: { kind: "unresolved", candidateTransactionIds: ["lly-buy"] } }]));
    const claim: ClaimForReach = { id: "h1", kind: "dna_hypothesis", statementText: "s", evidenceStrength: "insufficient_evidence", supportingCount: 2, contradictingCount: 0, generatedAt: d("2026-09-20"), effective: [
      { interviewAnswerId: "a-mp", decisionStatement: null, stance: "supporting" },
      { interviewAnswerId: null, decisionStatement: { decisionId: "d1", kind: "reasoning" }, stance: "supporting" },
      { interviewAnswerId: null, decisionStatement: { decisionId: "d1", kind: "risks" }, stance: "supporting" },
      { interviewAnswerId: null, decisionStatement: { decisionId: "d-u", kind: "reasoning" }, stance: "supporting" },
    ] };
    const reach = computeClaimReach(claim, r);
    expect(reach.visibleToAi).toBe(false);
    expect(reach.sources).toEqual({ interviewAnswers: 1, decisionStatements: 3 });
    expect(reach.unresolvedDecisionIds).toEqual(["d-u"]);
    expect(reach.supportingCount).toBe(2); // stored, not recomputed here
    expect(reach.distance).toEqual({ nextTier: "moderate", additionalSupportingCases: 1 });
    expect(reach.citedStatementKeys).toEqual(["answer:a-mp", "decision:d-u:reasoning", "decision:d1:reasoning", "decision:d1:risks"]);
    const visible = computeClaimReach({ id: "h2", kind: "strategy_principle", statementText: "s", evidenceStrength: "weak", supportingCount: 3, contradictingCount: 3, effective: [], generatedAt: null }, r);
    expect(visible.visibleToAi).toBe(true);
    const statements = [
      { key: "answer:a-mp", createdAt: d("2026-09-01") }, { key: "answer:a-lly", createdAt: d("2026-09-02") },
      { key: "decision:d1:reasoning", createdAt: d("2026-09-03") }, { key: "decision:d9:reasoning", createdAt: d("2026-09-25") },
    ];
    const summary = summarizeReach([reach, visible], statements);
    expect(summary.statements).toEqual({ total: 4, interviewAnswers: 2, decisionStatements: 2 });
    expect(summary.dna).toMatchObject({ claims: 1, visibleToAi: 0, insufficient: 1, uncitedStatements: 2, unresolvedDecisions: 1, lastGeneratedAt: d("2026-09-20").toISOString(), newestStatementAt: d("2026-09-25").toISOString(), regenerationMayChangeReach: true });
    expect(summary.strategy).toMatchObject({ claims: 1, visibleToAi: 1, insufficient: 0, uncitedStatements: 4, unresolvedDecisions: 0, lastGeneratedAt: null, regenerationMayChangeReach: true });
  });

  it("regenerate DONE condition: once a generate run postdates every statement, uncited statements no longer justify a regenerate action", () => {
    const r = createIndependenceResolver(ctx([]));
    const claim = (generatedAt: Date | null) => computeClaimReach({ id: "h", kind: "dna_hypothesis", statementText: "s", evidenceStrength: "insufficient_evidence", supportingCount: 1, contradictingCount: 0, effective: [{ interviewAnswerId: "a-mp", decisionStatement: null, stance: "supporting" }], generatedAt }, r);
    const statements = [{ key: "answer:a-mp", createdAt: d("2026-09-01") }, { key: "answer:a-lly", createdAt: d("2026-09-10") }];
    expect(summarizeReach([claim(d("2026-09-20"))], statements).dna.regenerationMayChangeReach).toBe(false); // the run saw a-lly and chose not to cite it
    expect(summarizeReach([claim(d("2026-09-05"))], statements).dna.regenerationMayChangeReach).toBe(true); // a-lly arrived after the run
    expect(summarizeReach([claim(null)], statements).dna.regenerationMayChangeReach).toBe(true); // legacy: no generate provenance on record
    expect(summarizeReach([], statements).dna.regenerationMayChangeReach).toBe(true); // nothing generated yet
    expect(summarizeReach([claim(d("2026-09-20"))], [{ key: "answer:a-mp", createdAt: d("2026-09-01") }]).dna.regenerationMayChangeReach).toBe(false); // nothing uncited
  });
});

// ---- OD-R1 fingerprint / OD-R2 union reasons ------------------------------
describe("OD-R1 effective evidence-state fingerprint (deterministic)", () => {
  const e = (decisionId: string, decisionReviewId: string, stance: "supporting" | "contradicting" = "supporting") => ({ decisionId, decisionReviewId, stance });
  it("is a pure function of (decision, review, stance): order, duplicates, wording, timestamps and descriptions never enter", () => {
    const a = learningEvidenceFingerprint([e("d1", "r1"), e("d2", "r2", "contradicting")]);
    const b = learningEvidenceFingerprint([e("d2", "r2", "contradicting"), e("d1", "r1"), e("d1", "r1")]);
    expect(a).toBe(b);
    expect(a).toBe("lef-v1:d1|r1|supporting;d2|r2|contradicting");
    expect(learningEvidenceFingerprint([])).toBe("lef-v1:");
  });
  it("changes on: new case, removed case, stance flip, review replacement; nothing else", () => {
    const base = learningEvidenceFingerprint([e("d1", "r1"), e("d2", "r2")]);
    expect(learningEvidenceFingerprint([e("d1", "r1"), e("d2", "r2"), e("d3", "r3")])).not.toBe(base); // new case
    expect(learningEvidenceFingerprint([e("d1", "r1")])).not.toBe(base); // removed case
    expect(learningEvidenceFingerprint([e("d1", "r1"), e("d2", "r2", "contradicting")])).not.toBe(base); // stance flip
    expect(learningEvidenceFingerprint([e("d1", "r1b"), e("d2", "r2")])).not.toBe(base); // review replacement
  });
  it("entries come only from reviews that map to this investor's decisions; a version's fingerprint is read from its provenance, legacy versions from rows", () => {
    const entries = fingerprintEntriesOf([{ decisionReviewId: "r1", stance: "supporting" }, { decisionReviewId: "r-foreign", stance: "supporting" }], new Map([["r1", "d1"]]));
    expect(entries).toEqual([e("d1", "r1")]);
    expect(fingerprintOfVersion({ evidenceFingerprint: "lef-v1:d1|r1|supporting" }, [])).toEqual({ fingerprint: "lef-v1:d1|r1|supporting", source: "provenance" });
    expect(fingerprintOfVersion({ citedReviews: [{ decisionReviewId: "r1", decisionId: "d1", stance: "supporting" }] }, [])).toEqual({ fingerprint: "lef-v1:d1|r1|supporting", source: "provenance" });
    expect(fingerprintOfVersion(null, [e("d9", "r9")])).toEqual({ fingerprint: "lef-v1:d9|r9|supporting", source: "legacy_rows" });
    expect(fingerprintOfVersion({ citedReviews: [{ decisionReviewId: "r1", stance: "supporting" }] }, [e("d9", "r9")]).source).toBe("legacy_rows"); // no decision ids: cannot reconstruct the case key from provenance
  });
});

describe("OD-R2 union basis reconstruction", () => {
  it("a decision executed by trades in two episodes is ONE group whose reasons name the decision, both episodes and the executed facts", () => {
    const r = createIndependenceResolver(ctx([{ id: "d-nvda", caseResolution: { kind: "merged", transactionIds: ["nvda-buy", "nvda-buy2"], executedFactIds: ["f-1", "f-2"] } }]));
    const basis = r.resolve([ds("d-nvda", "reasoning"), ans("a-nvda"), ans("a-nvda2")]);
    expect(basis.groups).toHaveLength(1);
    expect(basis.groups[0]!.reasons.map((x) => x.kind).sort()).toEqual(["decision_case", "executed_fact", "executed_fact", "same_episode", "same_episode"]);
    expect(basis.groups[0]!.reasons.filter((x) => x.kind === "executed_fact").map((x) => x.ref)).toEqual(["f-1", "f-2"]);
    expect(basis.supportingLower).toBe(1);
    // executed-fact reasons never group anything by themselves: an own decision has none
    expect(createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }])).resolve([ds("d1", "reasoning")]).groups[0]!.reasons).toEqual([{ kind: "decision_case", ref: "d1" }]);
  });
  it("resolveDecisionCase records the executed fact ids it merged through", () => {
    expect(resolveDecisionCase(buyAvgo, trades, [{ id: "f-a", decisionId: "d-avgo", transactionId: "t-avgo-same", verdict: "executed" }, { id: "f-b", decisionId: "d-avgo", transactionId: "t-avgo-after", verdict: "executed" }]))
      .toEqual({ kind: "merged", transactionIds: ["t-avgo-after", "t-avgo-same"], executedFactIds: ["f-a", "f-b"] });
  });
});

// ---- OD-3 carry (Unit 5) --------------------------------------------------
describe("OD-3 learning carry: cases from the agreed version, grounding gate for the claim", () => {
  const ok = async () => ({ verdict: "supported" as const, reason: "grounded" });
  const stmt = (decisionId: string, kind: DecisionStatement["kind"], text: string): DecisionStatement =>
    ({ statementId: `decision:${decisionId}:${kind}`, decisionId, kind, ticker: "X", decisionType: "BUY", decisionDate: d("2026-01-01"), createdAt: d("2026-01-01"), text });

  it("the agreed VERSION's provenance is the stance authority; identity evidence rows are only the legacy fallback", () => {
    const rows = [{ decisionReviewId: "r1", stance: "supporting" as const }, { decisionReviewId: "r2", stance: "supporting" as const }, { decisionReviewId: null, stance: "supporting" as const }];
    expect(citedReviewsOfVersion({ provenanceJson: { citedReviews: [{ decisionReviewId: "r1", stance: "contradicting" }] } }, rows)).toEqual([{ decisionReviewId: "r1", stance: "contradicting" }]);
    expect(citedReviewsOfVersion({ provenanceJson: null }, rows)).toEqual([{ decisionReviewId: "r1", stance: "supporting" }, { decisionReviewId: "r2", stance: "supporting" }]);
    expect(citedReviewsOfVersion({ provenanceJson: { citedReviews: [{ decisionReviewId: 5 }] } }, rows)).toHaveLength(2); // malformed provenance -> fallback
  });

  it("cases: one per (decision, stance); several reviews of one decision collapse; unmapped (foreign) reviews are dropped; disagreeing reviews keep both stances", () => {
    const cases = buildLearningCarryCases(
      [
        { decisionReviewId: "r1", stance: "supporting" }, { decisionReviewId: "r1b", stance: "supporting" }, { decisionReviewId: "r1c", stance: "contradicting" },
        { decisionReviewId: "r2", stance: "contradicting" }, { decisionReviewId: "r-foreign", stance: "supporting" },
      ],
      new Map([["r1", "d1"], ["r1b", "d1"], ["r1c", "d1"], ["r2", "d2"]])
    );
    expect(cases).toEqual([{ decisionId: "d1", stance: "contradicting" }, { decisionId: "d1", stance: "supporting" }, { decisionId: "d2", stance: "contradicting" }]);
    expect(buildLearningCarryCases([], new Map())).toEqual([]);
  });

  it("grounding gate: a review having cited a decision is not textual grounding — unrelated reasoning is excluded, the grounded statement kind is what gets cited, and it fails closed", async () => {
    const statements = [
      stmt("d1", "reasoning", "I bought because valuation looked attractive."),
      stmt("d1", "exit_conditions", "I will sell if the thesis breaks, no matter the price."),
      stmt("d2", "reasoning", "Momentum was strong."),
    ];
    const gate = async (input: { sourceAnswerText: string; stance: string }) =>
      input.sourceAnswerText.includes("sell if the thesis breaks") ? { verdict: "supported" as const, reason: "exit discipline stated" } : { verdict: "unsupported" as const, reason: "silent on exit discipline" };
    const result = await groundCarryCitations("I tend to ignore exit discipline.", [{ decisionId: "d1", stance: "contradicting" }, { decisionId: "d2", stance: "supporting" }, { decisionId: "d3", stance: "supporting" }], statements, gate);
    expect(result.citations).toEqual([{ interviewAnswerId: null, decisionStatement: { decisionId: "d1", kind: "exit_conditions" }, stance: "contradicting", groundingReason: "exit discipline stated" }]);
    expect(result.excluded.map((e) => `${e.decisionId}:${e.kind}:${e.stance}`)).toEqual(["d1:reasoning:contradicting", "d2:reasoning:supporting"]);
    expect(result.decisionsWithoutStatements).toEqual(["d3"]);
    // fail closed on a throwing gate
    const thrown = await groundCarryCitations("claim", [{ decisionId: "d1", stance: "supporting" }], statements, async () => { throw new Error("network"); });
    expect(thrown.citations).toEqual([]);
    expect(thrown.excluded).toHaveLength(2);
    // the accepting gate cites every statement of the decision, still ONE case through the resolver
    const all = await groundCarryCitations("claim", [{ decisionId: "d1", stance: "supporting" }], statements, ok);
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "own" } }]));
    expect(assessCitations(r, all.citations)).toMatchObject({ supportingCount: 1, contradictingCount: 0 });
  });

  it("two carried decisions that collapse to one episode count once; the agreement itself adds nothing", async () => {
    const r = createIndependenceResolver(ctx([{ id: "d1", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy"] } }, { id: "d2", caseResolution: { kind: "merged", executedFactIds: [], transactionIds: ["lly-buy2"] } }]));
    const grounded = await groundCarryCitations("claim", [{ decisionId: "d1", stance: "supporting" }, { decisionId: "d2", stance: "supporting" }], [stmt("d1", "reasoning", "a"), stmt("d2", "reasoning", "b")], ok);
    expect(assessCitations(r, grounded.citations).supportingCount).toBe(1);
  });
});

// ---- provenance + prompt inputs (Units 3/4) --------------------------------
describe("provenance and AI inputs", () => {
  it("provenance answers source type / model / contracts / policy / time / code version; carry ids and cited reviews only where they apply", () => {
    const p = buildProvenance({ generator: "dna.generate", model: "m", promptContracts: ["a", "b"], sourceTypes: ["interview_answer", "decision_statement"], now: new Date("2026-09-25T00:00:00Z") });
    expect(p).toEqual({ schemaVersion: 1, generator: "dna.generate", model: "m", promptContracts: ["a", "b"], evidenceSourceContract: "evidence-source-v1", independencePolicy: "independence-policy-v2", sourceTypes: ["interview_answer", "decision_statement"], generatedAt: "2026-09-25T00:00:00.000Z", codeVersion: p.codeVersion });
    expect("carriedFromLearningInsightId" in p).toBe(false);
    expect("citedReviews" in p).toBe(false);
    const carry = buildProvenance({ generator: "learning.agree_carry", model: "m", promptContracts: ["evidence-grounding-v3-statements"], sourceTypes: ["decision_statement"], carriedFromLearningInsightId: U1, carriedFromLearningInsightVersionId: U2 });
    expect(carry.carriedFromLearningInsightId).toBe(U1);
    const learning = buildProvenance({ generator: "learning.generate", model: "m", promptContracts: ["x"], sourceTypes: ["decision_review"], citedReviews: [{ decisionReviewId: "r1", stance: "supporting" }] });
    expect(learning.citedReviews).toEqual([{ decisionReviewId: "r1", stance: "supporting" }]);
  });

  it("statements handed to the AI are source-labelled, verbatim, with Statement IDs only for answers and decision statements", () => {
    const statements = buildInvestorStatements(
      [{ id: U1, questionText: "Why?", answerText: "because <b>" }],
      [{ statementId: `decision:${U2}:risks`, decisionId: U2, kind: "risks", ticker: "LLY", decisionType: "BUY", decisionDate: d("2026-08-19"), createdAt: d("2026-08-19"), text: "risk text" }]
    );
    expect(statements).toEqual([
      { id: U1, source: "interview_answer", heading: "Question: Why?", text: "because <b>" },
      { id: `decision:${U2}:risks`, source: "decision_statement", heading: "risks considered the investor wrote when recording BUY LLY on 2026-08-19", text: "risk text" },
    ]);
    const text = formatInvestorStatements(statements);
    expect(text).toContain(`Statement ID: ${U1}\nSource: [interview answer]`);
    expect(text).toContain(`Statement ID: decision:${U2}:risks\nSource: [decision statement — risks considered the investor wrote when recording BUY LLY on 2026-08-19]\nText: risk text`);
    for (const rule of ["Never invent an ID", "no ID for any AI-written text", "Later Context", "PROCESS evidence", "never evidence that the decision was right", "ONE case", "repeated wording"]) {
      expect(INVESTOR_STATEMENT_RULES).toContain(rule);
    }
  });
});

// ---- next actions (Unit 6) -------------------------------------------------
describe("next-action catalogue", () => {
  const today = d("2026-09-25");
  const noRegen = { uncitedStatements: 0, regenerationMayChangeReach: false };
  const base: Omit<NextActionsInput, "today" | "decisions"> = { openConditions: [], cases: [], episodes: [], reach: { dna: noRegen, strategy: noRegen } };
  const decision = (id: string, decisionDate: string, extra: Partial<NextActionsInput["decisions"][number]> = {}) =>
    ({ id, ticker: "X", decisionType: "BUY", decisionDate: d(decisionDate), reviewByDate: null, reviewCount: 0, unclassifiedCandidateCount: 0, ...extra });

  it("leaves the monitoring's frozen reasons untouched and has its own fixed catalogue", () => {
    expect(ATTENTION_REASONS).toEqual(["REVIEW_DUE", "PREDICTION_DUE", "NEW_EXECUTION_AFTER_DECISION", "HISTORY_BACKFILLED"]);
    expect(NEXT_ACTION_KINDS).toHaveLength(7);
    expect(new Set(NEXT_ACTION_KINDS as readonly string[]).has("REVIEW_DUE")).toBe(false);
  });

  it("emits FACT->DESTINATION rows only while the fact holds, in catalogue order then newest first", () => {
    const decisions = [
      decision("d-old", "2026-08-19"),
      decision("d-new", "2026-09-08", { unclassifiedCandidateCount: 3 }),
      decision("d-due", "2026-09-01", { reviewByDate: d("2026-09-20"), decisionType: "PASS" }),
      decision("d-done", "2026-08-20", { reviewCount: 2, decisionType: "PASS" }),
    ];
    const out = deriveNextActions({ ...base, today, decisions,
      openConditions: [
        { predictionId: "p-due", decisionId: "d-new", ticker: "AVGO", decisionType: "BUY", checkableByDate: d("2026-09-24") },
        { predictionId: "p-later", decisionId: "d-new", ticker: "AVGO", decisionType: "BUY", checkableByDate: d("2026-10-01") },
        { predictionId: "p-undated", decisionId: "d-new", ticker: "AVGO", decisionType: "BUY", checkableByDate: null },
      ],
      cases: [
        { id: "c-stalled", ticker: "MU", status: "researching", updatedAt: d("2026-08-26") },
        { id: "c-fresh", ticker: "NVDA", status: "researching", updatedAt: d("2026-09-20") },
        { id: "c-decided", ticker: "LLY", status: "decided", updatedAt: d("2026-07-01") },
      ],
      episodes: [{ anchorable: true, hasRationale: false }, { anchorable: true, hasRationale: true }, { anchorable: false, hasRationale: false }],
      reach: { dna: { uncitedStatements: 12, regenerationMayChangeReach: true }, strategy: { uncitedStatements: 7, regenerationMayChangeReach: false } },
    });
    expect(out.map((a) => a.key)).toEqual(["exec:d-new", "review:d-due", "review:d-old", "horizon:d-new", "horizon:d-old", "condition:p-due", "case:c-stalled", "rationale", "regen:dna"]);
    expect(out.find((a) => a.key === "exec:d-new")).toMatchObject({ kind: "RESOLVE_EXECUTION_CANDIDATES", count: 3, destination: "/decisions/d-new" });
    expect(out.find((a) => a.key === "review:d-due")!.destination).toBe("/decisions/d-due#review");
    expect(out.find((a) => a.key === "rationale")).toMatchObject({ count: 1, destination: "/journal" });
    expect(out.find((a) => a.key === "regen:dna")).toMatchObject({ domain: "dna", count: 12, destination: "/dna" });
    expect(out.some((a) => a.key === "regen:strategy")).toBe(false); // uncited but the last run already saw every statement
    expect(out.some((a) => a.key === "review:d-new")).toBe(false); // 17 days old, no horizon: below the suggestion window
  });

  it("day boundaries: review suggestion at 29/30/31 days, stalled case at 13/14/15 days (thresholds are dashboard policy, not evidence)", () => {
    expect(REVIEW_WITHOUT_HORIZON_NUDGE_DAYS).toBe(30);
    expect(STALLED_CASE_DAYS).toBe(14);
    const reviewKeys = (ageDays: number) => deriveNextActions({ ...base, today, decisions: [decision("d", new Date(today.getTime() - ageDays * 86_400_000).toISOString().slice(0, 10))] }).map((a) => a.kind);
    expect(reviewKeys(29)).toEqual(["SET_REVIEW_HORIZON"]);
    expect(reviewKeys(30)).toEqual(["REVIEW_UNREVIEWED_DECISION", "SET_REVIEW_HORIZON"]);
    expect(reviewKeys(31)).toEqual(["REVIEW_UNREVIEWED_DECISION", "SET_REVIEW_HORIZON"]);
    // with a horizon set, age never matters: only the horizon passing does
    const withHorizon = (reviewBy: string) => deriveNextActions({ ...base, today, decisions: [decision("d", "2026-01-01", { reviewByDate: d(reviewBy) })] }).map((a) => a.kind);
    expect(withHorizon("2026-09-26")).toEqual([]);
    expect(withHorizon("2026-09-25")).toEqual(["REVIEW_UNREVIEWED_DECISION"]);
    const stalledKeys = (idleDays: number) => deriveNextActions({ ...base, today, decisions: [], cases: [{ id: "c", ticker: "X", status: "researching", updatedAt: new Date(today.getTime() - idleDays * 86_400_000) }] }).map((a) => a.kind);
    expect(stalledKeys(13)).toEqual([]);
    expect(stalledKeys(14)).toEqual(["CONTINUE_STALLED_CASE"]);
    expect(stalledKeys(15)).toEqual(["CONTINUE_STALLED_CASE"]);
  });

  it("disappears when done: a reviewed decision, a classified candidate, a resolved condition, a decided case, a rationale, a generate run that saw everything", () => {
    expect(deriveNextActions({ ...base, today, decisions: [decision("d", "2026-01-01", { reviewByDate: d("2026-02-01"), reviewCount: 1 })] })).toEqual([]);
    expect(deriveNextActions({ ...base, today, decisions: [], cases: [{ id: "c", ticker: "X", status: "decided", updatedAt: d("2026-01-01") }] })).toEqual([]);
    expect(deriveNextActions({ ...base, today, decisions: [], episodes: [{ anchorable: true, hasRationale: true }] })).toEqual([]);
    expect(deriveNextActions({ ...base, today, decisions: [], reach: { dna: { uncitedStatements: 5, regenerationMayChangeReach: false }, strategy: noRegen } })).toEqual([]);
  });
});
