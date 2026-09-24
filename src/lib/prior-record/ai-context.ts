// Prior Record → AI Decision Context V1 (docs/architecture.md §2.5a).
//
// The ONLY representation of a PriorRecordBrief that an AI ever sees: a pure,
// deterministic projection onto an explicit allow-list, plus a deterministic
// text rendering. Used by exactly two consumers:
//   - Decision AI (synthesizeDecisionContext): the PIT brief built for the new
//     decision's cutoff — the SAME brief object that is then frozen into
//     decision_snapshots.prior_record_json;
//   - Decision Review (synthesizeDecisionReview): ONLY the frozen copy from the
//     snapshot, never a recomputed brief; a legacy NULL renders as NOT CAPTURED.
//
// Structural exclusions (Owner decision, V1): the contract has no field for any
// price (price at decision, entry price, cost basis), any realized result or
// per-sell holding metric, any resolved prediction's status/note/date, any
// Review verdict, or the position. A past action is context; a past outcome is
// never evidence for a new decision — and a field that does not exist cannot
// leak, whatever the prompt says. No AI summarizes the record before an AI
// reads it.
//
// Bounds: at most MAX_AI_DECISIONS prior decisions and MAX_AI_EPISODES episodes
// (most recent first); whole items are dropped, prose is never cut, and the
// omitted counts are stated. Ordering never depends on input order.
import { PRIOR_RECORD_VERSION, type PriorRecordBrief } from "./prior-record";

export const PRIOR_RECORD_AI_CONTEXT_VERSION = 1 as const;
export const MAX_AI_DECISIONS = 5;
export const MAX_AI_EPISODES = 5;

export interface PriorRecordAiDecision {
  decisionId: string;
  decisionType: string;
  decisionDate: string;
  sizeDollars: string | null;
  reasoningText: string | null;
  risksConsideredText: string | null;
  exitConditionsText: string | null;
  /** Claims an AI extracted from this decision's reasoning that were still pending at the cutoff. */
  pendingClaims: { kind: string | null; claimText: string }[];
  /** A count only — which way they resolved is deliberately absent. */
  resolvedClaimCount: number;
  /** A count only — the verdicts are deliberately absent. */
  reviewCount: number;
  laterContexts: { addedAt: string; text: string }[];
}

export interface PriorRecordAiEpisode {
  key: string;
  status: "open" | "closed";
  firstDate: string;
  exitDate: string | null;
  holdingDays: number | null;
  buyCount: number;
  sellCount: number;
  rationale: { questionText: string; answerText: string; answeredAt: string }[];
}

export interface PriorRecordDecisionContextV1 {
  contractVersion: typeof PRIOR_RECORD_AI_CONTEXT_VERSION;
  sourceVersion: typeof PRIOR_RECORD_VERSION;
  ticker: string;
  asOf: string;
  historyThrough: string | null;
  accounting: "ok" | "unavailable";
  decisions: PriorRecordAiDecision[];
  episodes: PriorRecordAiEpisode[];
  /** Pending re-entry conditions of the decisions shown (never of an omitted one). */
  pendingReentryConditions: { decisionId: string; decisionType: string; decisionDate: string; claimText: string }[];
  omitted: { decisions: number; episodes: number };
}

// The one rule both AI consumers (Decision AI, Review) give the model about
// numbers inside quoted investor text (Owner decision, final review): the prose
// is historical truth and stays verbatim — never redacted — so its
// interpretation is constrained instead. Structured price/performance/outcome
// fields do not exist in the contract at all.
export const QUOTED_HISTORY_RULES = `Lines marked INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) (including LATER CONTEXT) are the investor's own words, quoted verbatim as historical context. The prior record supplies NO structured historical price, performance or outcome field; that quoted text may itself mention prices, percentages or outcomes. Any number, price, percentage or outcome description inside it:
  - is NOT a structured market fact supplied by the system and NOT an independently verified outcome;
  - must NOT be used to calculate a historical return, and must NOT be compared with the current price to infer performance;
  - must NOT become evidence that a prior decision was good or bad;
  - must NOT support repeating or reversing a past action because of how it later turned out.
Treat it as what the investor wrote at the time — keep its meaning, constrain its use.`;

export class PriorRecordContextError extends Error {
  constructor(reason: string) {
    super(`Prior Record cannot be given to the AI: ${reason}.`);
    this.name = "PriorRecordContextError";
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

// The brief reaches Review as jsonb read back from the DB — typed only by a
// cast. Every field the projection reads is checked; anything else fails
// closed (the AI is then never called), never "best effort".
function assertBrief(raw: unknown): asserts raw is PriorRecordBrief {
  const fail = (what: string): never => {
    throw new PriorRecordContextError(what);
  };
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const b = raw as Record<string, unknown>;
  if (b.version !== PRIOR_RECORD_VERSION) fail(`unsupported source version ${JSON.stringify(b.version)}`);
  if (!isStr(b.ticker) || !isStr(b.asOf) || !isStrOrNull(b.historyThrough)) fail("malformed header");
  if (b.accounting !== "ok" && b.accounting !== "unavailable") fail("malformed accounting");
  if (!Array.isArray(b.decisions) || !Array.isArray(b.episodes)) fail("malformed lists");
  for (const d of b.decisions as Record<string, unknown>[]) {
    if (typeof d !== "object" || d === null) fail("malformed decision");
    if (!isStr(d.decisionId) || !isStr(d.decisionType) || !isStr(d.decisionDate)) fail("malformed decision");
    if (!isStrOrNull(d.sizeDollars) || !isStrOrNull(d.reasoningText) || !isStrOrNull(d.risksConsideredText) || !isStrOrNull(d.exitConditionsText)) fail("malformed decision text");
    if (!isNum(d.reviewCount) || !Array.isArray(d.predictions) || !Array.isArray(d.laterContexts)) fail("malformed decision");
    for (const p of d.predictions as Record<string, unknown>[]) {
      if (typeof p !== "object" || p === null || !isStr(p.claimText) || !isStr(p.status) || !isStrOrNull(p.kind)) fail("malformed prediction");
    }
    for (const lc of d.laterContexts as Record<string, unknown>[]) {
      if (typeof lc !== "object" || lc === null || !isStr(lc.addedAt) || !isStr(lc.text)) fail("malformed later context");
    }
  }
  for (const e of b.episodes as Record<string, unknown>[]) {
    if (typeof e !== "object" || e === null) fail("malformed episode");
    if (!isStr(e.key) || (e.status !== "open" && e.status !== "closed") || !isStr(e.firstDate) || !isStrOrNull(e.exitDate)) fail("malformed episode");
    if (!isNumOrNull(e.holdingDays) || !isNum(e.buyCount) || !isNum(e.sellCount) || !Array.isArray(e.rationale)) fail("malformed episode");
    for (const r of e.rationale as Record<string, unknown>[]) {
      if (typeof r !== "object" || r === null || !isStr(r.questionText) || !isStr(r.answerText) || !isStr(r.answeredAt)) fail("malformed rationale");
    }
  }
}

export function projectPriorRecordForAi(brief: unknown): PriorRecordDecisionContextV1 {
  assertBrief(brief);

  const allDecisions = [...brief.decisions].sort((a, b) => cmp(b.decisionDate, a.decisionDate) || cmp(a.decisionId, b.decisionId));
  const decisions: PriorRecordAiDecision[] = allDecisions.slice(0, MAX_AI_DECISIONS).map((d) => ({
    decisionId: d.decisionId,
    decisionType: d.decisionType,
    decisionDate: d.decisionDate,
    sizeDollars: d.sizeDollars,
    reasoningText: d.reasoningText,
    risksConsideredText: d.risksConsideredText,
    exitConditionsText: d.exitConditionsText,
    pendingClaims: d.predictions
      .filter((p) => p.status === "pending")
      .map((p) => ({ kind: p.kind, claimText: p.claimText }))
      .sort((a, b) => cmp(a.kind ?? "", b.kind ?? "") || cmp(a.claimText, b.claimText)),
    resolvedClaimCount: d.predictions.filter((p) => p.status !== "pending").length,
    reviewCount: d.reviewCount,
    laterContexts: d.laterContexts
      .map((lc) => ({ addedAt: lc.addedAt, text: lc.text }))
      .sort((a, b) => cmp(a.addedAt, b.addedAt) || cmp(a.text, b.text)),
  }));

  const allEpisodes = [...brief.episodes].sort((a, b) => cmp(b.firstDate, a.firstDate) || cmp(b.key, a.key));
  const episodes: PriorRecordAiEpisode[] = allEpisodes.slice(0, MAX_AI_EPISODES).map((e) => ({
    key: e.key,
    status: e.status,
    firstDate: e.firstDate,
    exitDate: e.exitDate,
    holdingDays: e.holdingDays,
    buyCount: e.buyCount,
    sellCount: e.sellCount,
    rationale: e.rationale
      .map((r) => ({ questionText: r.questionText, answerText: r.answerText, answeredAt: r.answeredAt }))
      .sort((a, b) => cmp(a.answeredAt, b.answeredAt) || cmp(a.questionText, b.questionText) || cmp(a.answerText, b.answerText)),
  }));

  const pendingReentryConditions = decisions.flatMap((d) =>
    d.pendingClaims
      .filter((c) => c.kind === "reentry_condition")
      .map((c) => ({ decisionId: d.decisionId, decisionType: d.decisionType, decisionDate: d.decisionDate, claimText: c.claimText }))
  );

  return {
    contractVersion: PRIOR_RECORD_AI_CONTEXT_VERSION,
    sourceVersion: PRIOR_RECORD_VERSION,
    ticker: brief.ticker,
    asOf: brief.asOf,
    historyThrough: brief.historyThrough,
    accounting: brief.accounting,
    decisions,
    episodes,
    pendingReentryConditions,
    omitted: { decisions: allDecisions.length - decisions.length, episodes: allEpisodes.length - episodes.length },
  };
}

const day = (iso: string) => iso.slice(0, 10);
const quoted = (text: string | null) => (text === null || text.trim() === "" ? "(none recorded)" : `"${text}"`);

// Provenance labels: every line says what KIND of fact it is — a past action,
// the investor's own words, an AI extraction, later investor context, an
// execution fact, or missing information.
export function formatPriorRecordContext(ctx: PriorRecordDecisionContextV1 | null): string {
  if (ctx === null) {
    return [
      "=== Investor's prior record on this ticker: NOT CAPTURED ===",
      "This decision was recorded before the prior record was frozen into decisions. What the investor's earlier record on this ticker looked like at decision time is UNKNOWN — not \"no prior history\". Do not treat its absence as evidence of anything, and do not credit or penalize the decision for it.",
    ].join("\n");
  }

  const lines = [
    `=== Investor's own prior record on ${ctx.ticker} (information cutoff ${ctx.asOf}; executions known through ${ctx.historyThrough ? day(ctx.historyThrough) : "none known"}; dates are UTC days) ===`,
    "Context about this investor's past process on this ticker — NOT evidence for or against the current decision. No structured historical price, performance or outcome fields are supplied here (no price, cost basis, position, realized result or return, resolved-claim outcome or Review verdict). INVESTOR-AUTHORED HISTORICAL TEXT is quoted verbatim and may itself mention such information — that is what the investor wrote then, not verified market or performance data.",
    "",
    "Prior decisions on this ticker:",
  ];
  if (ctx.decisions.length === 0) lines.push("- none recorded before the cutoff.");
  ctx.decisions.forEach((d, i) => {
    lines.push(`[Prior decision ${i + 1}] PAST ACTION (not a recommendation): ${d.decisionType} on ${day(d.decisionDate)}${d.sizeDollars !== null ? ` — size $${d.sizeDollars} (a dollar amount invested, NOT a price)` : ""}`);
    lines.push(`  INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — reasoning: ${quoted(d.reasoningText)}`);
    lines.push(`  INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — risks: ${quoted(d.risksConsideredText)}`);
    lines.push(`  INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — exit conditions: ${quoted(d.exitConditionsText)}`);
    const reentry = d.pendingClaims.filter((c) => c.kind === "reentry_condition").length;
    for (const c of d.pendingClaims.filter((c) => c.kind !== "reentry_condition")) {
      lines.push(`  AI-EXTRACTED CLAIM (${c.kind ?? "kind unknown"}), still pending — written by an AI from the reasoning above, NOT the investor's words: "${c.claimText}"`);
    }
    if (reentry > 0) lines.push(`  Pending re-entry conditions from this decision: ${reentry} (listed below)`);
    lines.push(`  Claims already resolved: ${d.resolvedClaimCount} (how they resolved is deliberately not shown) · Reviews recorded: ${d.reviewCount} (verdicts deliberately not shown)`);
    for (const lc of d.laterContexts) {
      lines.push(`  LATER CONTEXT — INVESTOR-AUTHORED HISTORICAL TEXT (verbatim), added on ${day(lc.addedAt)} — authoritative over the older text and any AI extraction above: "${lc.text}"`);
    }
  });
  if (ctx.omitted.decisions > 0) lines.push(`(${ctx.omitted.decisions} older prior decision(s) omitted — at most ${MAX_AI_DECISIONS} are shown)`);

  lines.push("", "Holding periods on this ticker (execution facts):");
  if (ctx.accounting === "unavailable") {
    lines.push("- NOT AVAILABLE: the accounting for this ticker could not be trusted at the cutoff — unknown, not \"none\".");
  } else if (ctx.episodes.length === 0) {
    lines.push("- none in the known history before the cutoff.");
  }
  for (const e of ctx.episodes) {
    const span = e.status === "open" ? `open since ${day(e.firstDate)}` : `closed; ${day(e.firstDate)} → ${e.exitDate ? day(e.exitDate) : "unknown"}${e.holdingDays !== null ? ` (${e.holdingDays} days)` : ""}`;
    lines.push(`[Episode ${e.key}] EXECUTION FACT: ${span}; ${e.buyCount} buy(s), ${e.sellCount} sell(s)`);
    for (const r of e.rationale) {
      lines.push(`  INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — rationale recorded ${day(r.answeredAt)}: Q: ${r.questionText} A: "${r.answerText}"`);
    }
  }
  if (ctx.omitted.episodes > 0) lines.push(`(${ctx.omitted.episodes} older holding period(s) omitted — at most ${MAX_AI_EPISODES} are shown)`);

  if (ctx.pendingReentryConditions.length > 0) {
    lines.push(
      "",
      "Pending re-entry conditions — the investor's own earlier checks, AI-extracted from their exit conditions, still unresolved at the cutoff (not automatically satisfied or failed):"
    );
    for (const c of ctx.pendingReentryConditions) lines.push(`- (from the ${c.decisionType} of ${day(c.decisionDate)}) "${c.claimText}"`);
  }
  return lines.join("\n");
}
