// Grounding Semantics V3.2 (OD-V32-7, frozen 2026-09-27): the INTERVIEW
// QUESTION is CONTEXT, NEVER EVIDENCE. It reaches the grounding gate in its
// own labelled section; it may resolve what the investor's answer refers to
// and never supplies a claim component. Decision statements never carry it.
//
// Pins (1) the exact request text and its evidence/context boundary, (2) the
// rule text, (3) the question-context attack cases A..G through the REAL
// pipeline with the reference gate, (4) that context is never evidence, a
// case or a count. No model is called.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

import { anthropic } from "@/lib/ai/client";
import { AFFIRMATIVE_STANCE_RULES } from "@/lib/ai/stance-rules";
import { NO_CONTEXT, buildGroundingUserMessage, checkEvidenceGrounding, GROUNDING_TOOL, GROUNDING_TOOL_NAME, type EvidenceGroundingCheckInput } from "@/lib/ai/dna-grounding";
import { buildInvestorStatements, buildStatementContextById, formatInvestorStatements } from "@/lib/ai/investor-statements";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { validateProposedObservedPrinciples } from "@/lib/strategy/validate-principles";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { createIndependenceResolver } from "@/lib/evidence/resolve-independence";
import { contextFromTrades } from "../helpers/independence";
import { referenceGate, type ReferenceWorld } from "../helpers/reference-gate-v3-2";

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
type Stance = "supporting" | "contradicting";

const C = {
  FEAR_SALE: "You tend to sell out of fear of losing the gain.",
  GAIN50: "You tend to sell after a gain of more than 50%.",
  QUICK: "You tend to sell within a few months of buying.",
  MOMENTUM_SELL: "When momentum weakens, you tend to sell.",
  VALUATION_SELL: "You tend to sell because valuation became too high.",
  BELIEF_HOLD: "You tend to hold because you believe in the company.",
  BELIEF_HOLD_TRIGGERED: "When momentum weakens, you tend to hold because you believe in the company.",
  IGNORE_VALUATION: "You tend to ignore valuation.",
} as const;

const ANSWER = {
  FEAR: "I feared losing the gain.",
  BELIEF: "Because I believed in the company.",
  VALUATION: "Because valuation became too high.",
  YES: "Yes.",
  YES_OWN_WORDS: "Yes, I ignored valuation.",
} as const;

const Q = {
  SELL_THEN: "What made you sell then?",
  SELL_COMPUTED: "With a 95% gain after 101 days, what made you sell then?",
  HOLD_DESPITE: "Why did you hold despite weakening momentum?",
  WHY_SELL: "Why did you sell?",
  IGNORE: "Did you ignore valuation?",
} as const;

const WORLD: ReferenceWorld = {
  claims: {
    [C.FEAR_SALE]: { support: [["SELL", "FEAR"]], contradict: [["HOLD"]] },
    [C.GAIN50]: { support: [["SELL", "GAIN_OVER_50"]], contradict: [["GAIN_OVER_50", "HOLD"]] },
    [C.QUICK]: { support: [["SELL", "SHORT_HOLD"]], contradict: [["LONG_HOLD"]] },
    [C.MOMENTUM_SELL]: { support: [["WEAK", "SELL"]], contradict: [["WEAK", "HOLD"]] },
    [C.VALUATION_SELL]: { support: [["SELL", "VALUATION"]], contradict: [["HOLD"]] },
    [C.BELIEF_HOLD]: { support: [["HOLD", "BELIEF"]], contradict: [["SELL"]] },
    [C.BELIEF_HOLD_TRIGGERED]: { support: [["WEAK", "HOLD", "BELIEF"]], contradict: [["WEAK", "SELL"]] },
    [C.IGNORE_VALUATION]: { support: [["IGNORE_VALUATION"]], contradict: [["WEIGH_VALUATION"]] },
  },
  // what the investor's OWN WORDS establish — a bare "Yes." establishes nothing
  says: {
    [ANSWER.FEAR]: ["FEAR"],
    [ANSWER.BELIEF]: ["BELIEF"],
    [ANSWER.VALUATION]: ["VALUATION"],
    [ANSWER.YES]: [],
    [ANSWER.YES_OWN_WORDS]: ["IGNORE_VALUATION"],
  },
  reasonAnswers: new Set<string>([ANSWER.FEAR, ANSWER.BELIEF, ANSWER.VALUATION]),
  // the ACTION each question poses. The 95%, the 101 days and "weakening momentum" are the question's words, not components.
  asks: { [Q.SELL_THEN]: ["SELL"], [Q.SELL_COMPUTED]: ["SELL"], [Q.HOLD_DESPITE]: ["HOLD"], [Q.WHY_SELL]: ["SELL"], [Q.IGNORE]: [] },
};

// One answer row per (answer text, question) pairing under test.
const ROWS = [
  { id: "ans-fear-plain", text: ANSWER.FEAR, question: Q.SELL_THEN },
  { id: "ans-fear-computed", text: ANSWER.FEAR, question: Q.SELL_COMPUTED },
  { id: "ans-fear-noq", text: ANSWER.FEAR, question: null },
  { id: "ans-belief", text: ANSWER.BELIEF, question: Q.HOLD_DESPITE },
  { id: "ans-valuation", text: ANSWER.VALUATION, question: Q.WHY_SELL },
  { id: "ans-yes", text: ANSWER.YES, question: Q.IGNORE },
  { id: "ans-yes-own", text: ANSWER.YES_OWN_WORDS, question: Q.IGNORE },
] as const;
const DECISION = "dec-fear";
const DSID = `decision:${DECISION}:reasoning`;
const resolver = createIndependenceResolver({
  ...contextFromTrades(
    ROWS.map((r, i) => ({ id: `t-${r.id}`, ticker: `TK${i}`, type: "buy" as const, date: "2026-01-05" })),
    ROWS.map((r) => ({ id: r.id, txn: `t-${r.id}`, text: r.text }))
  ),
  decisions: [{ id: DECISION, caseResolution: { kind: "own" as const } }],
});
const TEXT_BY_ID = new Map<string, string>([...ROWS.map((r) => [r.id, r.text] as [string, string]), [DSID, ANSWER.FEAR]]);
// deliberately hostile: an entry keyed by the DECISION statement id, which must never be used
const CONTEXT_BY_ID = new Map<string, string>([...ROWS.filter((r) => r.question !== null).map((r) => [r.id, r.question!] as [string, string]), [DSID, Q.SELL_THEN]]);

const cite = (statementId: string, stance: Stance = "supporting") => ({ statementId, stance, description: `cites ${statementId}` });
async function run(claim: string, statementId: string, log: EvidenceGroundingCheckInput[] = []) {
  const validated = validateProposedHypotheses([{ statement: claim, evidence: [cite(statementId)] }], resolver);
  return groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(WORLD, log), CONTEXT_BY_ID);
}
const supported = async (claim: string, statementId: string) => (await run(claim, statementId)).hypotheses.length === 1;

describe("the request's evidence/context boundary", () => {
  it("five labelled parts; the answer is the evidence and the question sits only under CONTEXT — NOT EVIDENCE", () => {
    expect(buildGroundingUserMessage({ hypothesisStatement: C.FEAR_SALE, stance: "supporting", sourceKind: "interview_answer", sourceAnswerText: ANSWER.FEAR, contextText: Q.SELL_COMPUTED })).toBe(
      [
        `CLAIM: ${C.FEAR_SALE}`,
        "STANCE: supporting",
        "SOURCE KIND: interview answer",
        "",
        "INVESTOR EVIDENCE (verbatim — the only source of evidence):",
        ANSWER.FEAR,
        "",
        "CONTEXT — NOT EVIDENCE (the interview question the answer responded to; it may resolve what the answer refers to and never supplies a claim component):",
        Q.SELL_COMPUTED,
      ].join("\n")
    );
  });

  it("no question: the context section says none and nothing is invented; a blank question counts as none", () => {
    for (const contextText of [undefined, "", "   \n "]) {
      const m = buildGroundingUserMessage({ hypothesisStatement: C.FEAR_SALE, stance: "supporting", sourceAnswerText: ANSWER.FEAR, ...(contextText !== undefined ? { contextText } : {}) });
      expect(m.endsWith(`never supplies a claim component):\n${NO_CONTEXT}`)).toBe(true);
      expect(m).toContain("SOURCE KIND: interview answer");
    }
  });

  it("a decision statement never carries context, even if a caller passes one", () => {
    const m = buildGroundingUserMessage({ hypothesisStatement: C.FEAR_SALE, stance: "supporting", sourceKind: "decision_statement", sourceAnswerText: ANSWER.FEAR, contextText: Q.SELL_THEN });
    expect(m).toContain("SOURCE KIND: decision statement (what the investor wrote when recording a decision)");
    expect(m.endsWith(`\n${NO_CONTEXT}`)).toBe(true);
    expect(m).not.toContain(Q.SELL_THEN);
  });

  describe("real request (mocked client)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("sends exactly that message with the strict tool, and the question appears once, after the context label", async () => {
      create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "supported", reason: "r" } }] });
      const input: EvidenceGroundingCheckInput = { hypothesisStatement: C.FEAR_SALE, stance: "supporting", sourceKind: "interview_answer", sourceAnswerText: ANSWER.FEAR, contextText: Q.SELL_COMPUTED };
      expect(await checkEvidenceGrounding(input)).toEqual({ verdict: "supported", reason: "r" });
      const call = create.mock.calls[0]![0];
      const user = call.messages[0].content as string;
      expect(call.messages).toHaveLength(1);
      expect(user).toBe(buildGroundingUserMessage(input));
      expect(user.split(Q.SELL_COMPUTED).length - 1).toBe(1);
      expect(user.indexOf(Q.SELL_COMPUTED)).toBeGreaterThan(user.indexOf("CONTEXT — NOT EVIDENCE"));
      const evidenceSection = user.slice(user.indexOf("INVESTOR EVIDENCE"), user.indexOf("CONTEXT — NOT EVIDENCE"));
      expect(evidenceSection).toContain(ANSWER.FEAR);
      expect(evidenceSection).not.toContain("95%");
      // strict tooling is unchanged
      expect(call.tools).toEqual([GROUNDING_TOOL]);
      expect(call.tools[0].strict).toBe(true);
      expect(call.tools[0].input_schema.additionalProperties).toBe(false);
      expect(call.tools[0].input_schema.properties.verdict.enum).toEqual(["supported", "unsupported"]);
      expect([...call.tools[0].input_schema.required].sort()).toEqual(["reason", "verdict"]);
      expect(call.tool_choice).toEqual({ type: "tool", name: GROUNDING_TOOL_NAME });
    });

    it("the system prompt names the five parts and states the four boundary sentences", async () => {
      create.mockResolvedValueOnce({ content: [{ type: "tool_use", name: GROUNDING_TOOL_NAME, input: { verdict: "unsupported", reason: "r" } }] });
      await checkEvidenceGrounding({ hypothesisStatement: C.GAIN50, stance: "supporting", sourceAnswerText: ANSWER.FEAR, contextText: Q.SELL_COMPUTED });
      const system = create.mock.calls[0]![0].system as string;
      expect(system).toContain(AFFIRMATIVE_STANCE_RULES);
      expect(system).toMatch(/five labelled parts: CLAIM \(the hypothesis statement\), STANCE .*, SOURCE KIND .*, INVESTOR EVIDENCE \(the real, verbatim statement text\) and CONTEXT — NOT EVIDENCE/);
      expect(system).toMatch(/INVESTOR EVIDENCE is the ONLY source of evidence/);
      expect(system).toMatch(/CONTEXT is never evidence: it may resolve what the investor's answer refers to, and nothing else/);
      for (const sentence of [
        "Context may resolve what the investor answer refers to",
        "Context may NOT supply evidence for a missing claim component",
        "Any material component supported only by context remains unsupported",
        "Computed or AI-authored facts in context",
        "are not investor evidence",
      ]) expect(system).toContain(sentence);
      // the question text itself is never part of the system prompt
      expect(system).not.toContain(Q.SELL_COMPUTED);
    });
  });
});

describe("the canonical rule (OD-V32-7)", () => {
  it("states what the question may resolve, what it can never establish, both Owner examples, the yes/no rule and the no-invention rule", () => {
    for (const phrase of [
      "INTERVIEW QUESTION — CONTEXT, NEVER EVIDENCE",
      "The investor's answer is the evidence; the question is not",
      "a pronoun or referent (\"it\", \"that\", \"then\"), which action or topic the answer is responding to, or an explicit question premise needed to read the answer's grammar",
      "it never establishes a motive, belief, rule, behavioral tendency, trigger or precondition, risk preference, exit discipline or confidence",
      "question \"What made you sell then?\", answer \"I was afraid the gain would disappear\": the answer gives the investor's stated reason for the sale being discussed",
      "nothing the question says about the size or speed of the gain is established",
      "Question \"Why did you hold despite weakening momentum?\", answer \"Because I believed in the company\": the answer concerns holding and states a belief; weakening momentum is NOT established",
      "An answer that only affirms or denies the question (\"yes\", \"no\") adopts words the investor did not write and establishes no component by itself",
      "A decision statement has no question",
      "When no question is given, never assume, reconstruct or invent one",
    ]) expect(AFFIRMATIVE_STANCE_RULES).toContain(phrase);
  });
});

describe("question-context attack cases through the real pipeline (reference gate)", () => {
  it("A: 'What made you sell then?' / 'I feared losing the gain.' — the reason applies to the sale under discussion; nothing else is established", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await run(C.FEAR_SALE, "ans-fear-plain", log);
    expect([out.hypotheses[0]!.supportingCount, out.hypotheses[0]!.contradictingCount]).toEqual([1, 0]);
    expect(log[0]).toEqual({ hypothesisStatement: C.FEAR_SALE, stance: "supporting", sourceAnswerText: ANSWER.FEAR, sourceKind: "interview_answer", contextText: Q.SELL_THEN });
    // return %, duration, momentum, valuation, belief: none of them
    for (const claim of [C.GAIN50, C.QUICK, C.MOMENTUM_SELL, C.VALUATION_SELL, C.BELIEF_HOLD]) expect(await supported(claim, "ans-fear-plain")).toBe(false);
  });

  it("B: 'Why did you hold despite weakening momentum?' / 'Because I believed in the company.' — the answer concerns holding; weakening momentum is not investor evidence", async () => {
    expect(await supported(C.BELIEF_HOLD, "ans-belief")).toBe(true);
    const out = await run(C.BELIEF_HOLD_TRIGGERED, "ans-belief");
    expect(out.hypotheses).toEqual([]);
    expect(out.excluded.map((e) => e.statementId)).toEqual(["ans-belief"]);
    expect(await supported(C.MOMENTUM_SELL, "ans-belief")).toBe(false);
  });

  it("C: a computed return and duration in the question cannot satisfy a claim component", async () => {
    expect(await supported(C.GAIN50, "ans-fear-computed")).toBe(false);
    expect(await supported(C.QUICK, "ans-fear-computed")).toBe(false);
    expect(await supported(C.FEAR_SALE, "ans-fear-computed")).toBe(true); // the action is still resolved
  });

  it("D: 'Why did you sell?' / 'Because valuation became too high.' — the answer supplies the motive and the context resolves the action", async () => {
    const out = await run(C.VALUATION_SELL, "ans-valuation");
    expect([out.hypotheses[0]!.supportingCount, out.hypotheses[0]!.contradictingCount]).toEqual([1, 0]);
  });

  it("E (pinned, conservative): a bare 'Yes.' to 'Did you ignore valuation?' is NOT investor evidence; the proposition in the investor's own words is", async () => {
    expect(await supported(C.IGNORE_VALUATION, "ans-yes")).toBe(false);
    expect(await supported(C.IGNORE_VALUATION, "ans-yes-own")).toBe(true);
  });

  it("F: question context missing — never invented; the action stays unresolved and the citation is NEITHER", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await run(C.FEAR_SALE, "ans-fear-noq", log);
    expect(out.hypotheses).toEqual([]);
    expect("contextText" in log[0]!).toBe(false);
    expect(buildGroundingUserMessage(log[0]!).endsWith(`\n${NO_CONTEXT}`)).toBe(true);
  });

  it("G: a decision statement gets no contextText, even when the context map holds an entry under its id", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const out = await run(C.FEAR_SALE, DSID, log);
    expect(log).toHaveLength(1);
    expect(log[0]!.sourceKind).toBe("decision_statement");
    expect("contextText" in log[0]!).toBe(false);
    expect(out.hypotheses).toEqual([]); // the same words with no question resolve no action
  });
});

describe("context is never evidence, a case, a count or an identity", () => {
  it("the grounded result carries the citation only: same evidence shape, one case, S from the citation alone", async () => {
    const withContext = await run(C.FEAR_SALE, "ans-fear-plain");
    const h = withContext.hypotheses[0]!;
    expect(h.evidence).toHaveLength(1);
    expect(Object.keys(h.evidence[0]!).sort()).toEqual(["decisionStatement", "description", "interviewAnswerId", "stance"]);
    expect(h.evidence[0]).toMatchObject({ interviewAnswerId: "ans-fear-plain", stance: "supporting" });
    expect(h.independenceBasis.groups).toHaveLength(1);
    expect([h.supportingCount, h.contradictingCount, h.evidenceStrength]).toEqual([1, 0, "insufficient_evidence"]);
    expect(JSON.stringify(h)).not.toContain(Q.SELL_THEN);
    // two answers, two questions: two cases; the questions add nothing of their own
    const validated = validateProposedHypotheses([{ statement: C.FEAR_SALE, evidence: [cite("ans-fear-plain"), cite("ans-fear-computed")] }], resolver);
    const two = await groundValidatedHypotheses(validated, TEXT_BY_ID, resolver, referenceGate(WORLD), CONTEXT_BY_ID);
    expect([two.hypotheses[0]!.supportingCount, two.hypotheses[0]!.independenceBasis.groups.length]).toEqual([2, 2]);
  });

  it("Strategy path: same propagation and the same boundary", async () => {
    const log: EvidenceGroundingCheckInput[] = [];
    const validated = validateProposedObservedPrinciples([{ statement: C.GAIN50, evidence: [cite("ans-fear-computed"), cite(DSID)] }], resolver);
    const out = await groundValidatedObservedPrinciples(validated, TEXT_BY_ID, resolver, referenceGate(WORLD, log), CONTEXT_BY_ID);
    expect(out.principles).toEqual([]);
    expect(log.map((l) => [l.sourceKind, l.contextText])).toEqual([["interview_answer", Q.SELL_COMPUTED], ["decision_statement", undefined]]);
  });

  it("both remediation planners pass the question for an answer and nothing for a decision statement", async () => {
    const raw = [
      { id: "ev-answer", interviewAnswerId: "ans-fear-computed", stance: "supporting" as const },
      { id: "ev-decision", interviewAnswerId: null, decisionStatement: { decisionId: DECISION, kind: "reasoning" as const }, stance: "supporting" as const },
    ];
    for (const planner of ["dna", "strategy"] as const) {
      const log: EvidenceGroundingCheckInput[] = [];
      const input = { rawEvidence: raw, answerTextById: TEXT_BY_ID, independence: resolver, alreadyGroundedEvidenceIds: null, contextTextById: CONTEXT_BY_ID };
      const plan = planner === "dna"
        ? await planGroundingRemediation({ ...input, currentVersion: { id: "v1", statementText: C.FEAR_SALE } }, referenceGate(WORLD, log))
        : await planPrincipleGroundingRemediation({ ...input, currentVersion: { id: "v1", statementText: C.FEAR_SALE, principleType: "observed" } }, referenceGate(WORLD, log));
      expect(log.map((l) => [l.sourceKind, l.sourceAnswerText, l.contextText])).toEqual([["interview_answer", ANSWER.FEAR, Q.SELL_COMPUTED], ["decision_statement", ANSWER.FEAR, undefined]]);
      expect(plan.action).toBe("new_version");
      if (plan.action !== "new_version") throw new Error("expected new_version");
      // the check rows name evidence ids and verdicts only — the question is in none of them
      expect(plan.checks.map((c) => [c.evidenceId, c.verdict])).toEqual([["ev-answer", "supported"], ["ev-decision", "unsupported"]]);
      expect(JSON.stringify(plan)).not.toContain(Q.SELL_COMPUTED);
      expect([plan.version.supportingEvidenceCount, plan.version.contradictingEvidenceCount]).toEqual([1, 0]);
    }
  });
});

describe("where the question comes from", () => {
  it("buildStatementContextById reads the persisted question of each answer, skips a blank one, and has no entry for anything else", () => {
    const map = buildStatementContextById([{ id: "a1", questionProvenance: "tell_me_why_legacy", questionText: Q.WHY_SELL }, { id: "a2", questionProvenance: "tell_me_why_legacy", questionText: "   " }, { id: "a3", questionProvenance: "tell_me_why_legacy", questionText: Q.IGNORE }]);
    expect([...map]).toEqual([["a1", Q.WHY_SELL], ["a3", Q.IGNORE]]);
  });

  it("the proposers still see the question beside the answer, and a decision statement has a record heading, not a question", () => {
    const statements = buildInvestorStatements(
      [{ id: "a1", questionProvenance: "tell_me_why_legacy", questionText: Q.WHY_SELL, answerText: ANSWER.VALUATION }],
      [{ statementId: DSID, decisionId: DECISION, kind: "reasoning", ticker: "X", decisionType: "BUY", decisionDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), text: "decision text" }]
    );
    const shown = formatInvestorStatements(statements);
    expect(shown).toContain(`Question: ${Q.WHY_SELL}\nText: ${ANSWER.VALUATION}`);
    expect(shown).toContain("Source: [decision statement — reasoning the investor wrote when recording BUY X on 2026-01-01]\nText: decision text");
    expect(buildStatementContextById([{ id: "a1", questionText: Q.WHY_SELL }]).has(DSID)).toBe(false);
  });
});
