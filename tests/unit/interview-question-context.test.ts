import { describe, expect, it } from "vitest";
import { aiQuestionContext, buildInvestorStatements, buildStatementContextById, formatInvestorStatements, LEGACY_QUESTION_WITHHELD } from "@/lib/ai/investor-statements";
import { buildAnchorContext, type AnchorContextV1 } from "@/lib/interview/anchor-context";

// Unit 7C-B — the one policy for what an AI consumer may see of an interview
// question. The answer is always verbatim evidence; a legacy guided question
// (AI wording from before the point-in-time rule) never reaches an AI.

const LEAK = "Sample legacy: what made you sell QRST after that 42% run in 70 days?";
const ANSWER = "the investor's own words, verbatim";
const anchor = { anchorTicker: "QRST", anchorSide: "sell", anchorDate: new Date("2026-04-24T00:00:00Z") };

const pitContext: AnchorContextV1 = (() => {
  const r = buildAnchorContext(
    {
      transactions: [
        { id: "b", ticker: "QRST", transactionType: "buy", quantity: 10, price: 5, amount: -50, transactionDate: new Date("2026-03-01T00:00:00Z"), intraDayOrder: null },
        { id: "s", ticker: "QRST", transactionType: "sell", quantity: 10, price: 9, amount: 90, transactionDate: new Date("2026-04-24T00:00:00Z"), intraDayOrder: null },
      ],
      openingStates: [],
      corporateActions: [],
    },
    "s"
  );
  if (!r.ok) throw new Error(r.reason);
  return r.context;
})();

describe("aiQuestionContext", () => {
  it("guided_legacy: the stored wording is withheld; a neutral referent from the anchored transaction takes its place", () => {
    const ctx = aiQuestionContext({ questionText: LEAK, questionProvenance: "guided_legacy", ...anchor });
    expect(ctx).not.toContain("42%");
    expect(ctx).not.toContain("70");
    expect(ctx).toContain(LEGACY_QUESTION_WITHHELD);
    expect(ctx).toContain("במכירה של QRST ב-24/04/2026");
  });

  it("guided_legacy without an anchored transaction: withheld, no referent", () => {
    expect(aiQuestionContext({ questionText: LEAK, questionProvenance: "guided_legacy" })).toBe(LEGACY_QUESTION_WITHHELD);
  });

  it("tell_me_why_legacy keeps its code-built question", () => {
    expect(aiQuestionContext({ questionText: "ספר לי על ההשקעה שלך ב-QRST", questionProvenance: "tell_me_why_legacy", ...anchor })).toBe("ספר לי על ההשקעה שלך ב-QRST");
  });

  it("PIT rows: the snapshot's facts line, then the question", () => {
    for (const p of ["guided_pit_ai", "guided_pit_fallback", "tell_me_why_pit"]) {
      expect(aiQuestionContext({ questionText: "מה גרם לך למכור?", questionProvenance: p, anchorContext: pitContext })).toBe(`${pitContext.factsLine}\nמה גרם לך למכור?`);
    }
  });

  it("fails closed: unknown provenance, missing provenance, or a PIT row without a readable snapshot", () => {
    for (const a of [
      { questionText: LEAK, questionProvenance: "something_new", ...anchor },
      { questionText: LEAK, ...anchor },
      { questionText: LEAK, questionProvenance: "guided_pit_ai", anchorContext: null, ...anchor },
      { questionText: LEAK, questionProvenance: "guided_pit_ai", anchorContext: { version: 99 }, ...anchor },
    ]) {
      const ctx = aiQuestionContext(a);
      expect(ctx).not.toContain("42%");
      expect(ctx).toContain(LEGACY_QUESTION_WITHHELD);
    }
  });
});

describe("the consumers built on it", () => {
  const legacy = { id: "a1", questionText: LEAK, answerText: ANSWER, questionProvenance: "guided_legacy", ...anchor };

  it("DNA / observed-Strategy statements: the answer is verbatim, the legacy question is not in the prompt text", () => {
    const text = formatInvestorStatements(buildInvestorStatements([legacy], []));
    expect(text).toContain(`Text: ${ANSWER}`);
    expect(text).toContain("Source: [interview answer]");
    expect(text).not.toContain("42%");
    expect(text).toContain(LEGACY_QUESTION_WITHHELD);
  });

  it("grounding CONTEXT: the legacy question never reaches the gate; a PIT question does, with its facts", () => {
    const map = buildStatementContextById([legacy, { id: "a2", questionText: "מה גרם לך למכור?", questionProvenance: "guided_pit_ai", anchorContext: pitContext }]);
    expect(map.get("a1")).not.toContain("42%");
    expect(map.get("a2")).toBe(`${pitContext.factsLine}\nמה גרם לך למכור?`);
  });
});
