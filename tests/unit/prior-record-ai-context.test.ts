// Prior Record → AI Decision Context V1 — the pure projection/format contract
// (src/lib/prior-record/ai-context.ts), the Review formatter's NOT CAPTURED
// section, the conditional priorRecord citation, and the global test AI guard.
import { describe, expect, it } from "vitest";
import {
  formatPriorRecordContext,
  MAX_AI_DECISIONS,
  MAX_AI_EPISODES,
  PriorRecordContextError,
  projectPriorRecordForAi,
} from "@/lib/prior-record/ai-context";
import type { PriorRecordBrief, PriorRecordDecision, PriorRecordEpisode } from "@/lib/prior-record/prior-record";
import { validateReviewDimensions } from "@/lib/review/validate-review-dimensions";
import { formatInput, type ReviewInput } from "@/lib/ai/review";
import { anthropic } from "@/lib/ai/client";
import { generateInterviewQuestion } from "@/lib/ai/interview";

function decision(o: Partial<PriorRecordDecision> & { decisionId: string; decisionDate: string }): PriorRecordDecision {
  return {
    decisionType: "BUY",
    reviewByDate: null,
    priceAtDecision: "641.77",
    sizeDollars: "500",
    reasoningText: `reasoning ${o.decisionId}`,
    risksConsideredText: "risk text",
    exitConditionsText: "exit text",
    predictions: [],
    reviewCount: 0,
    latestReview: null,
    laterContexts: [],
    ...o,
  };
}
function episode(o: Partial<PriorRecordEpisode> & { key: string; firstDate: string }): PriorRecordEpisode {
  return {
    status: "closed",
    exitDate: "2026-06-18T00:00:00.000Z",
    holdingDays: 44,
    buyCount: 2,
    sellCount: 1,
    entry: { date: o.firstDate, quantity: 0.4674, price: 957.47 },
    sells: [{ date: "2026-06-18T00:00:00.000Z", realizedPnlPercent: 56.04, holdingPeriodDays: 31, trusted: true }],
    rationale: [],
    ...o,
  };
}
// A brief carrying every excluded kind of fact, with distinctive values.
function richBrief(): PriorRecordBrief {
  const d1 = decision({
    decisionId: "dec-b",
    decisionType: "PASS",
    decisionDate: "2026-08-20T09:00:00.000Z",
    sizeDollars: null,
    priceAtDecision: "1598.37",
    predictions: [
      { id: "p1", claimText: "SNDK will pull back from 1598.37", kind: null, status: "inconclusive", checkableByDate: null, resolvedAt: "2026-09-10T00:00:00.000Z", resolutionNote: "fell to ~$1490, then broke out to $1740+" },
      { id: "p2", claimText: "Guidance improves next quarter", kind: "reentry_condition", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null },
      { id: "p3", claimText: "Demand keeps growing", kind: "forecast", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null },
    ],
    reviewCount: 2,
    latestReview: { reviewId: "r1", reviewDate: "2026-09-10T00:00:00.000Z", decisionQualityOverall: "strong", thesisAccuracy: "partially_confirmed" },
    laterContexts: [
      { addedAt: "2026-08-23T00:00:00.000Z", text: "second clarification" },
      { addedAt: "2026-08-21T00:00:00.000Z", text: "deliberate test, not representative" },
    ],
  });
  const d2 = decision({ decisionId: "dec-a", decisionDate: "2026-08-19T09:00:00.000Z", priceAtDecision: "1278.83", predictions: [
    { id: "p4", claimText: "falls 15-20% from the entry price of ~$500", kind: null, status: "inconclusive", checkableByDate: null, resolvedAt: "2026-08-25T00:00:00.000Z", resolutionNote: "known extraction error" },
  ] });
  return {
    version: 1,
    ticker: "SNDK",
    generatedAt: "2026-09-24T10:00:00.000Z",
    asOf: "2026-09-24T10:00:00.000Z",
    historyThrough: "2026-09-21T00:00:00.000Z",
    accounting: "ok",
    position: { status: "held", quantity: 0.3859, costBasisPerShare: 1492.62 },
    decisions: [d1, d2],
    episodes: [
      episode({ key: "SNDK#2", firstDate: "2026-08-24T00:00:00.000Z", status: "open", exitDate: null, holdingDays: null, sellCount: 0, sells: [], rationale: [
        { answerId: "a2", questionText: "Why now?", answerText: "Waited for the pullback", answeredAt: "2026-09-01T00:00:00.000Z" },
        { answerId: "a1", questionText: "Why this size?", answerText: "Small starter", answeredAt: "2026-08-30T00:00:00.000Z" },
      ] }),
      episode({ key: "SNDK#1", firstDate: "2026-05-05T00:00:00.000Z" }),
    ],
    summary: { decisionCount: 2, reviewedDecisionCount: 1, episodeCount: 2, openEpisodeCount: 1, rationaleAnswerCount: 2, pendingPredictionCount: 2, pendingReentryConditions: [] },
  };
}

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
  return out;
}

describe("projectPriorRecordForAi — structural exclusions", () => {
  const ctx = projectPriorRecordForAi(richBrief());
  const text = formatPriorRecordContext(ctx);

  it("the contract holds only the approved fields", () => {
    expect([...allKeys(ctx)].sort()).toEqual([
      "accounting", "addedAt", "answerText", "answeredAt", "asOf", "buyCount", "claimText", "contractVersion", "decisionDate", "decisionId",
      "decisionType", "decisions", "episodes", "exitConditionsText", "exitDate", "firstDate", "historyThrough", "holdingDays", "key", "kind",
      "laterContexts", "omitted", "pendingClaims", "pendingReentryConditions", "questionText", "rationale", "reasoningText", "resolvedClaimCount",
      "reviewCount", "risksConsideredText", "sellCount", "sizeDollars", "sourceVersion", "status", "text", "ticker",
    ]);
    expect(ctx.decisions[0]!.pendingClaims.every((c) => Object.keys(c).sort().join() === "claimText,kind")).toBe(true);
    expect(ctx.episodes.every((e) => e.status === "open" || e.status === "closed")).toBe(true);
    expect(ctx).toMatchObject({ contractVersion: 1, sourceVersion: 1 });
  });

  it("no price, cost basis, realized result, resolved outcome, Review verdict or position reaches the AI text", () => {
    for (const leaked of ["1598.37", "1278.83", "641.77", "957.47", "1492.62", "0.3859", "0.4674", "56", "$1490", "1740", "known extraction error", "strong", "partially_confirmed", "inconclusive", "entry price of ~$500", "SNDK will pull back"]) {
      expect(text).not.toContain(leaked);
    }
    expect(JSON.stringify(ctx)).not.toMatch(/1598\.37|957\.47|56\.04|fell to|extraction error|strong|partially_confirmed|inconclusive/);
  });

  it("resolved claims and reviews appear only as counts; pending claims only", () => {
    expect(ctx.decisions.map((d) => [d.decisionId, d.resolvedClaimCount, d.reviewCount, d.pendingClaims.map((c) => c.claimText)])).toEqual([
      ["dec-b", 1, 2, ["Demand keeps growing", "Guidance improves next quarter"]],
      ["dec-a", 1, 0, []],
    ]);
    expect(ctx.pendingReentryConditions).toEqual([{ decisionId: "dec-b", decisionType: "PASS", decisionDate: "2026-08-20T09:00:00.000Z", claimText: "Guidance improves next quarter" }]);
  });

  it("labels provenance: past action, the investor's own words, AI extractions, later context, execution facts", () => {
    expect(text).toContain("[Prior decision 1] PAST ACTION (not a recommendation): PASS on 2026-08-20");
    expect(text).toContain('INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — reasoning: "reasoning dec-b"');
    expect(text).toContain('AI-EXTRACTED CLAIM (forecast), still pending — written by an AI from the reasoning above, NOT the investor\'s words: "Demand keeps growing"');
    expect(text).toContain('LATER CONTEXT — INVESTOR-AUTHORED HISTORICAL TEXT (verbatim), added on 2026-08-21 — authoritative over the older text and any AI extraction above: "deliberate test, not representative"');
    expect(text).toContain("[Episode SNDK#1] EXECUTION FACT: closed; 2026-05-05 → 2026-06-18 (44 days); 2 buy(s), 1 sell(s)");
    expect(text).toContain("[Episode SNDK#2] EXECUTION FACT: open since 2026-08-24");
    // an AI extraction is never rendered as the investor's own words, and each claim appears once
    for (const line of text.split("\n").filter((l) => l.includes("Demand keeps growing") || l.includes("Guidance improves"))) expect(line).not.toContain("INVESTOR-AUTHORED");
    expect(text.split("Guidance improves next quarter").length - 1).toBe(1);
    expect(text).toContain('- (from the PASS of 2026-08-20) "Guidance improves next quarter"');
  });
});

describe("missing information is never 'clean history'", () => {
  it("legacy NULL renders as NOT CAPTURED / UNKNOWN", () => {
    const text = formatPriorRecordContext(null);
    expect(text).toMatch(/NOT CAPTURED/);
    expect(text).toMatch(/UNKNOWN — not "no prior history"/);
    expect(text).not.toMatch(/none recorded before the cutoff/);
  });

  it("an empty captured record says none-before-cutoff; unavailable accounting says unknown", () => {
    const empty = projectPriorRecordForAi({ ...richBrief(), decisions: [], episodes: [] });
    expect(formatPriorRecordContext(empty)).toContain("- none recorded before the cutoff.");
    const unavailable = projectPriorRecordForAi({ ...richBrief(), accounting: "unavailable", episodes: [] });
    expect(formatPriorRecordContext(unavailable)).toContain('NOT AVAILABLE: the accounting for this ticker could not be trusted at the cutoff — unknown, not "none".');
  });

  it("the Review prompt carries the NOT CAPTURED section for a legacy decision and the frozen record otherwise", () => {
    const base = {
      ticker: "SNDK", decisionType: "PASS", decisionDate: "2026-08-20T09:00:00.000Z", priceAtDecision: 1, sizeDollars: null, userReasoningText: "r",
      risksConsideredText: null, exitConditionsText: null, aiRealtimeAssessmentText: null, thesisText: "t", thesisInterpretationText: null,
      portfolioStateAtDecision: { cash: 0, positions: [] }, marketContextAtDecision: { indexLevel: null, indexChange1d: null, volatilityIndexValue: null },
      caseMarketIntelligenceSummary: "{}", caseBullCaseText: null, caseBearCaseText: null, caseCatalystsText: null, caseInvalidationConditionsText: null,
      caseMarketBlindspotText: null, caseDevilsAdvocateText: null, casePersonalFitText: null, casePortfolioFitText: null, strategyPrinciplesInEffect: [],
      dnaHypothesesInEffect: [], predictionsWithResolutions: [], laterContexts: [],
      outcome: { priceAtDecision: 1, currentPrice: null, priceChangePercent: null, sizeDollars: null, positionValueNowUsd: null, pnlUsd: null, pnlPercent: null, stillHeld: false, asOfDate: "2026-09-24T00:00:00.000Z" },
    } satisfies Omit<ReviewInput, "priorRecordAtDecision">;
    expect(formatInput({ ...base, priorRecordAtDecision: null })).toContain("=== priorRecord (frozen at decision time) ===\n=== Investor's prior record on this ticker: NOT CAPTURED ===");
    expect(formatInput({ ...base, priorRecordAtDecision: projectPriorRecordForAi(richBrief()) })).toContain("=== priorRecord (frozen at decision time) ===\n=== Investor's own prior record on SNDK");
  });
});

describe("fail closed on an unsupported or malformed source", () => {
  it.each([
    ["null", null],
    ["a string", "brief"],
    ["another version", { ...richBrief(), version: 2 }],
    ["no version", { ...richBrief(), version: undefined }],
    ["decisions not a list", { ...richBrief(), decisions: {} }],
    ["a decision without text fields", { ...richBrief(), decisions: [{ decisionId: "x", decisionType: "BUY", decisionDate: "2026-01-01" }] }],
    ["a prediction without status", { ...richBrief(), decisions: [decision({ decisionId: "x", decisionDate: "2026-01-01", predictions: [{ claimText: "c", kind: null } as never] })] }],
    ["an episode with a bad status", { ...richBrief(), episodes: [{ ...episode({ key: "K#1", firstDate: "2026-01-01" }), status: "weird" }] }],
  ])("%s", (_label, raw) => {
    expect(() => projectPriorRecordForAi(raw)).toThrow(PriorRecordContextError);
  });
});

describe("determinism and bounds", () => {
  it("shuffled equivalent input gives the identical projection and text", () => {
    const a = richBrief();
    const b = richBrief();
    b.decisions.reverse();
    b.episodes.reverse();
    for (const d of b.decisions) { d.predictions.reverse(); d.laterContexts.reverse(); }
    for (const e of b.episodes) e.rationale.reverse();
    expect(projectPriorRecordForAi(b)).toEqual(projectPriorRecordForAi(a));
    expect(formatPriorRecordContext(projectPriorRecordForAi(b))).toBe(formatPriorRecordContext(projectPriorRecordForAi(a)));
    // same date → decision id tie-break; same first date → key tie-break
    const tie = { ...richBrief(), decisions: [decision({ decisionId: "z", decisionDate: "2026-01-01T00:00:00.000Z" }), decision({ decisionId: "a", decisionDate: "2026-01-01T00:00:00.000Z" })] };
    expect(projectPriorRecordForAi(tie).decisions.map((d) => d.decisionId)).toEqual(["a", "z"]);
    expect(projectPriorRecordForAi({ ...tie, decisions: [...tie.decisions].reverse() }).decisions.map((d) => d.decisionId)).toEqual(["a", "z"]);
  });

  it("more than 5 decisions / episodes: the most recent whole items are kept, prose intact, omitted counts stated", () => {
    const long = "x".repeat(5000);
    const decisions = Array.from({ length: 7 }, (_, i) =>
      decision({ decisionId: `d${i}`, decisionDate: `2026-0${i + 1}-01T00:00:00.000Z`, reasoningText: `${long}-${i}`, predictions: [{ id: `p${i}`, claimText: `reconsider ${i}`, kind: "reentry_condition", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null }] })
    );
    const episodes = Array.from({ length: 6 }, (_, i) => episode({ key: `T#${i + 1}`, firstDate: `2025-0${i + 1}-01T00:00:00.000Z` }));
    const ctx = projectPriorRecordForAi({ ...richBrief(), decisions, episodes });
    expect(ctx.decisions.map((d) => d.decisionId)).toEqual(["d6", "d5", "d4", "d3", "d2"]);
    expect(ctx.episodes.map((e) => e.key)).toEqual(["T#6", "T#5", "T#4", "T#3", "T#2"]);
    expect(ctx.omitted).toEqual({ decisions: 2, episodes: 1 });
    expect(ctx.pendingReentryConditions.map((c) => c.claimText)).toEqual(["reconsider 6", "reconsider 5", "reconsider 4", "reconsider 3", "reconsider 2"]);
    const text = formatPriorRecordContext(ctx);
    expect(text).toContain(`"${long}-2"`);
    expect(text).not.toContain(`${long}-1`);
    expect(text).toContain(`(2 older prior decision(s) omitted — at most ${MAX_AI_DECISIONS} are shown)`);
    expect(text).toContain(`(1 older holding period(s) omitted — at most ${MAX_AI_EPISODES} are shown)`);
  });
});

describe("Review citation of the prior record", () => {
  const proposal = [{ dimension: "thesis_quality", verdict: "strong" as const, rationaleText: "engaged with earlier trigger", citedSnapshotFields: ["priorRecord"] }];
  it("is dropped (and the verdict downgraded) for a legacy decision and by default", () => {
    for (const r of [validateReviewDimensions(proposal), validateReviewDimensions(proposal, { priorRecordCaptured: false })]) {
      expect(r.find((d) => d.dimension === "thesis_quality")).toMatchObject({ verdict: "insufficient_evidence", citedSnapshotFields: [] });
    }
  });
  it("is kept only when the frozen copy exists", () => {
    expect(validateReviewDimensions(proposal, { priorRecordCaptured: true }).find((d) => d.dimension === "thesis_quality")).toMatchObject({ verdict: "strong", citedSnapshotFields: ["priorRecord"] });
  });
});

describe("test AI safety — no real AI call can escape", () => {
  it("the real key is replaced and the SDK client rejects every call", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBe("test-placeholder-not-a-real-key");
    await expect(anthropic.messages.create({ model: "m", max_tokens: 1, messages: [] } as never)).rejects.toThrow(/Real AI call blocked in tests/);
  });
  it("an unmocked production AI function fails instead of calling out", async () => {
    const candidate = { transaction: { ticker: "X", transactionType: "buy", quantity: 1, price: 10, amount: -10, transactionDate: new Date("2026-01-02T00:00:00Z") }, category: "largest_buy" };
    await expect(generateInterviewQuestion(candidate as never)).rejects.toThrow(/Real AI call blocked in tests/);
  });
});
