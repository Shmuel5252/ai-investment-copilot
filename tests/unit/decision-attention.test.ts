// Open-Decision Monitoring V1 — the pure derivation, exercised only through
// the production deriveDecisionAttention() (src/lib/monitoring). Expected
// values are pinned by hand from the frozen rules, never recomputed here.
import { describe, expect, it } from "vitest";
import {
  deriveDecisionAttention,
  utcDay,
  type AttentionDecisionInput,
  type AttentionPortfolioInput,
  type AttentionTransactionInput,
  type DeriveDecisionAttentionInput,
} from "@/lib/monitoring/decision-attention";

const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const TODAY = at("2026-09-23T12:00:00Z");
const FRESH = at("2026-09-21");
let seq = 0;
const decision = (o: Omit<Partial<AttentionDecisionInput>, "decisionDate"> & { ticker: string; decisionDate: string }): AttentionDecisionInput => ({
  id: o.id ?? `d${++seq}`,
  ticker: o.ticker,
  decisionType: o.decisionType ?? "BUY",
  decisionDate: at(o.decisionDate),
  reviewByDate: o.reviewByDate ?? null,
  snapshot: o.snapshot === undefined ? { createdAt: at(o.decisionDate), frozenHoldingQuantity: 0 } : o.snapshot,
  predictions: o.predictions ?? [],
  reviews: o.reviews ?? [],
});
const txn = (ticker: string, type: "buy" | "sell", date: string, createdAt: string, id = `t${++seq}`): AttentionTransactionInput => ({
  id, ticker, transactionType: type, quantity: 1, price: 10, transactionDate: at(date), createdAt: at(createdAt),
});
const ok = (positions: AttentionPortfolioInput["positions"] = [], keys: [string, string][] = []): AttentionPortfolioInput => ({
  status: "ok", warningCount: 0, positions, episodeKeyByTransactionId: new Map(keys),
});
const derive = (decisions: AttentionDecisionInput[], transactions: AttentionTransactionInput[] = [], over: Partial<DeriveDecisionAttentionInput> = {}) =>
  deriveDecisionAttention({ today: TODAY, timeZone: "UTC", historyLatestTransactionDate: FRESH, decisions, transactions, portfolio: ok(), ...over });
const one = (...args: Parameters<typeof derive>) => derive(...args).items[0]!;

describe("canonical real-data shapes (2026-09-23)", () => {
  it("SNDK PASS 2026-08-20: three transactions after the decision, persisted after its 09-06 review → NEW_EXECUTION_AFTER_DECISION only", () => {
    const sndk = decision({ id: "sndk", ticker: "SNDK", decisionType: "PASS", decisionDate: "2026-08-20T14:07:46Z", predictions: [{ id: "p", status: "inconclusive", checkableByDate: null }], reviews: [{ id: "r", reviewDate: at("2026-09-06T16:03:03Z") }] });
    const rows = [txn("SNDK", "buy", "2026-08-24", "2026-09-23T16:38:28Z", "b1"), txn("SNDK", "sell", "2026-09-02", "2026-09-23T16:38:28Z", "s1"), txn("SNDK", "sell", "2026-09-08", "2026-09-23T16:38:28Z", "s2")];
    const item = one([sndk], rows, { portfolio: ok([{ ticker: "SNDK", quantity: 0.3859, costBasisPerShare: 1492.62 }], [["b1", "SNDK#1"], ["s1", "SNDK#1"], ["s2", "SNDK#1"]]) });
    expect(item.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(item.state).toBe("attention");
    expect(item.baseline).toEqual({ kind: "latest_review", at: at("2026-09-06T16:03:03Z") });
    expect(item.execution.after.map((f) => f.transactionId)).toEqual(["b1", "s1", "s2"]);
    expect(item.newExecutionAfterDecision).toHaveLength(3);
    expect(item.execution.knownBefore).toEqual([]);
    expect(item.position).toMatchObject({ status: "ok", held: true, quantity: 0.3859, episodeKeys: ["SNDK#1"] });
    expect(item.horizon.status).toBe("not_set");
  });
  it("AVGO BUY 2026-09-08: the 08-05 sell and 09-02 buy entered the system after the snapshot → HISTORY_BACKFILLED; four undated pending predictions are not due", () => {
    const avgo = decision({ id: "avgo", ticker: "AVGO", decisionDate: "2026-09-08T07:10:53Z", snapshot: { createdAt: at("2026-09-08T07:10:53.802Z"), frozenHoldingQuantity: 1.2169 }, predictions: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, status: "pending", checkableByDate: null })) });
    const rows = [txn("AVGO", "buy", "2026-06-18", "2026-08-16T12:35:37Z", "b0"), txn("AVGO", "sell", "2026-08-05", "2026-09-23T16:38:28Z", "s0"), txn("AVGO", "buy", "2026-09-02", "2026-09-23T16:38:28Z", "b1")];
    const item = one([avgo], rows, { portfolio: ok([{ ticker: "AVGO", quantity: 1.8121, costBasisPerShare: 369.72 }], [["b0", "AVGO#1"], ["s0", "AVGO#1"], ["b1", "AVGO#2"]]) });
    expect(item.reasons).toEqual(["HISTORY_BACKFILLED"]);
    expect(item.state).toBe("attention");
    expect(item.baseline.kind).toBe("decision");
    expect(item.execution.knownBefore.map((f) => f.transactionId)).toEqual(["b0"]);
    expect(item.execution.backfilledBefore.map((f) => f.transactionId)).toEqual(["s0", "b1"]);
    expect(item.execution.after).toEqual([]);
    expect(item.predictions).toMatchObject({ total: 4, pending: 4, undated: 4, due: [] });
    expect(item.position.frozenHoldingQuantity).toBe(1.2169);
    expect(item.position).toMatchObject({ held: true, quantity: 1.8121, episodeKeys: ["AVGO#1", "AVGO#2"] });
  });
  it("LLY BUY 2026-08-19: reviewed twice, predictions resolved, nothing persisted since → settled, no reasons", () => {
    const lly = decision({ id: "lly", ticker: "LLY", decisionDate: "2026-08-19T19:58:22Z", predictions: [1, 2, 3].map((i) => ({ id: `p${i}`, status: "inconclusive", checkableByDate: null })), reviews: [{ id: "r1", reviewDate: at("2026-09-06T16:24:03Z") }, { id: "r2", reviewDate: at("2026-09-07T04:09:15Z") }] });
    const rows = [txn("LLY", "buy", "2026-04-09", "2026-08-16T12:35:37Z"), txn("LLY", "sell", "2026-05-12", "2026-08-16T12:35:37Z")];
    const item = one([lly], rows);
    expect(item.reasons).toEqual([]);
    expect(item.state).toBe("settled");
    expect(item.baseline).toEqual({ kind: "latest_review", at: at("2026-09-07T04:09:15Z") });
    expect(item.execution.knownBefore).toHaveLength(2);
    expect(item.execution.after).toEqual([]);
    expect(item.position.held).toBe(false);
  });
});

describe("review horizon", () => {
  const withHorizon = (reviewByDate: string | null, reviews: string[] = []) =>
    one([decision({ ticker: "A", decisionDate: "2026-08-01", reviewByDate: reviewByDate ? at(reviewByDate) : null, reviews: reviews.map((r, i) => ({ id: `r${i}`, reviewDate: at(r) })) })]);
  it("NULL never fires; a future date is upcoming (monitoring)", () => {
    expect(withHorizon(null)).toMatchObject({ reasons: [], horizon: { status: "not_set" }, state: "monitoring" });
    expect(withHorizon("2026-10-01")).toMatchObject({ reasons: [], horizon: { status: "upcoming" }, state: "monitoring" });
  });
  it("due exactly on the date and still due when overdue", () => {
    expect(withHorizon("2026-09-23")).toMatchObject({ reasons: ["REVIEW_DUE"], horizon: { status: "due" }, state: "attention" });
    expect(withHorizon("2026-09-01")).toMatchObject({ reasons: ["REVIEW_DUE"], horizon: { status: "due" } });
  });
  it("a review before the horizon does not satisfy it; a review on/after the date does", () => {
    expect(withHorizon("2026-09-10", ["2026-09-05T10:00:00Z"])).toMatchObject({ reasons: ["REVIEW_DUE"], horizon: { status: "due" } });
    expect(withHorizon("2026-09-10", ["2026-09-10T00:00:00Z"])).toMatchObject({ reasons: [], horizon: { status: "satisfied" }, state: "settled" });
    expect(withHorizon("2026-09-10", ["2026-09-12T08:00:00Z"])).toMatchObject({ reasons: [], horizon: { status: "satisfied" } });
    expect(withHorizon("2026-10-10", ["2026-09-12T08:00:00Z"])).toMatchObject({ reasons: [], horizon: { status: "upcoming" }, state: "monitoring" });
  });
});

describe("predictions", () => {
  const withPreds = (preds: { status: string; date: string | null }[]) =>
    one([decision({ ticker: "A", decisionDate: "2026-08-01", predictions: preds.map((p, i) => ({ id: `p${i}`, status: p.status, checkableByDate: p.date ? at(p.date) : null })) })]);
  it("NULL checkable date never due; future pending not due; exact date due; resolved never due", () => {
    expect(withPreds([{ status: "pending", date: null }]).reasons).toEqual([]);
    expect(withPreds([{ status: "pending", date: "2026-10-01" }]).reasons).toEqual([]);
    expect(withPreds([{ status: "pending", date: "2026-09-23" }])).toMatchObject({ reasons: ["PREDICTION_DUE"], predictions: { due: [{ id: "p0" }] } });
    expect(withPreds([{ status: "confirmed", date: "2026-09-01" }, { status: "refuted", date: "2026-09-01" }]).reasons).toEqual([]);
  });
  it("multiple predictions: only the due pending ones are listed, earliest first", () => {
    const item = withPreds([{ status: "pending", date: "2026-09-20" }, { status: "pending", date: null }, { status: "pending", date: "2026-09-10" }, { status: "inconclusive", date: "2026-09-01" }]);
    expect(item.reasons).toEqual(["PREDICTION_DUE"]);
    expect(item.predictions).toMatchObject({ total: 4, pending: 3, undated: 1 });
    expect(item.predictions.due.map((d) => d.id)).toEqual(["p2", "p0"]);
  });
});

describe("execution facts and novelty", () => {
  const D = "2026-09-08T07:10:00Z";
  it("before the decision and known before the snapshot → known-before, no reason", () => {
    const item = one([decision({ ticker: "A", decisionDate: D })], [txn("A", "buy", "2026-09-01", "2026-09-02T00:00:00Z")]);
    expect(item.execution.knownBefore).toHaveLength(1);
    expect(item.reasons).toEqual([]);
  });
  it("before the decision but persisted after the snapshot → HISTORY_BACKFILLED", () => {
    const item = one([decision({ ticker: "A", decisionDate: D })], [txn("A", "sell", "2026-09-01", "2026-09-20T00:00:00Z")]);
    expect(item.execution.backfilledBefore).toHaveLength(1);
    expect(item.reasons).toEqual(["HISTORY_BACKFILLED"]);
  });
  it("same day → listed, never NEW_EXECUTION_AFTER_DECISION, whatever created_at says", () => {
    const item = one([decision({ ticker: "A", decisionDate: D })], [txn("A", "buy", "2026-09-08", "2026-09-20T00:00:00Z"), txn("A", "sell", "2026-09-08", "2026-09-01T00:00:00Z")]);
    expect(item.execution.sameDay).toHaveLength(2);
    expect(item.execution.after).toEqual([]);
    expect(item.reasons).toEqual([]);
  });
  it("after the decision but known before the latest review → absorbed; persisted after the review → NEW_EXECUTION_AFTER_DECISION", () => {
    const reviewed = decision({ ticker: "A", decisionDate: D, reviews: [{ id: "r", reviewDate: at("2026-09-15T00:00:00Z") }] });
    expect(one([reviewed], [txn("A", "buy", "2026-09-10", "2026-09-12T00:00:00Z")])).toMatchObject({ reasons: [], state: "settled", execution: { after: [expect.anything()] } });
    expect(one([reviewed], [txn("A", "buy", "2026-09-10", "2026-09-16T00:00:00Z")])).toMatchObject({ reasons: ["NEW_EXECUTION_AFTER_DECISION"], state: "attention" });
  });
  it("other tickers, dividends and fees never count", () => {
    const item = one([decision({ ticker: "A", decisionDate: D })], [txn("B", "buy", "2026-09-10", "2026-09-20T00:00:00Z"), { ...txn("A", "buy", "2026-09-10", "2026-09-20T00:00:00Z"), transactionType: "dividend" }]);
    expect(item.execution.after).toEqual([]);
    expect(item.reasons).toEqual([]);
  });
  it("a backfilled fact already absorbed by a later review raises nothing but stays in its group", () => {
    const item = one([decision({ ticker: "A", decisionDate: D, reviews: [{ id: "r", reviewDate: at("2026-09-21T00:00:00Z") }] })], [txn("A", "sell", "2026-09-01", "2026-09-20T00:00:00Z")]);
    expect(item.execution.backfilledBefore).toHaveLength(1);
    expect(item.backfilled).toEqual([]);
    expect(item.reasons).toEqual([]);
  });
});

describe("fail closed", () => {
  const D = "2026-09-08T07:10:00Z";
  it("history freshness before the decision day → no execution facts or reasons; due-date reasons still work", () => {
    const item = one([decision({ ticker: "A", decisionDate: D, reviewByDate: at("2026-09-10") })], [txn("A", "buy", "2026-09-10", "2026-09-20T00:00:00Z")], { historyLatestTransactionDate: at("2026-09-07") });
    expect(item.execution).toMatchObject({ status: "history_before_decision", after: [], knownBefore: [] });
    expect(item.reasons).toEqual(["REVIEW_DUE"]);
    expect(one([decision({ ticker: "A", decisionDate: D })], [], { historyLatestTransactionDate: null }).execution.status).toBe("history_before_decision");
  });
  it("accounting warnings or an unavailable portfolio → position interpretation withheld, raw facts kept", () => {
    const rows = [txn("A", "buy", "2026-09-10", "2026-09-20T00:00:00Z", "x")];
    for (const status of ["warnings", "unavailable"] as const) {
      const item = one([decision({ ticker: "A", decisionDate: D })], rows, { portfolio: { status, warningCount: status === "warnings" ? 1 : 0, positions: [{ ticker: "A", quantity: 5, costBasisPerShare: 1 }], episodeKeyByTransactionId: new Map([["x", "A#1"]]) } });
      expect(item.position).toMatchObject({ status, held: null, quantity: null, episodeKeys: [] });
      expect(item.execution.after[0]!.episodeKey).toBeNull();
      expect(item.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    }
  });
  it("missing snapshot → pre-decision facts fall into known-before (no backfill claim); frozen holding unknown", () => {
    const item = one([decision({ ticker: "A", decisionDate: D, snapshot: null })], [txn("A", "sell", "2026-09-01", "2026-09-20T00:00:00Z")]);
    expect(item.execution.knownBefore).toHaveLength(1);
    expect(item.reasons).toEqual([]);
    expect(item.position.frozenHoldingQuantity).toBeNull();
  });
});

describe("result shape and ordering", () => {
  it("no decisions → empty, and the section facts are still reported", () => {
    expect(derive([])).toMatchObject({ items: [], attention: [], monitoredWithoutHorizon: 0, historyThrough: FRESH, portfolioStatus: "ok", timeZone: "UTC" });
  });
  it("multiple reasons coexist on one decision in the fixed order; one item per decision", () => {
    const d = decision({ ticker: "A", decisionDate: "2026-09-01", reviewByDate: at("2026-09-20"), predictions: [{ id: "p", status: "pending", checkableByDate: at("2026-09-21") }] });
    const r = derive([d], [txn("A", "buy", "2026-09-05", "2026-09-22T00:00:00Z"), txn("A", "sell", "2026-08-30", "2026-09-22T00:00:00Z")]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.reasons).toEqual(["REVIEW_DUE", "PREDICTION_DUE", "NEW_EXECUTION_AFTER_DECISION", "HISTORY_BACKFILLED"]);
    expect(r.monitoredWithoutHorizon).toBe(0);
  });
  it("due items first by earliest due date, then newest novel fact, then decision date, then id", () => {
    const dueLate = decision({ id: "z", ticker: "A", decisionDate: "2026-01-01", reviewByDate: at("2026-09-20") });
    const dueEarly = decision({ id: "y", ticker: "B", decisionDate: "2026-05-01", predictions: [{ id: "p", status: "pending", checkableByDate: at("2026-09-10") }] });
    const factNew = decision({ id: "x", ticker: "C", decisionDate: "2026-06-01" });
    const factOld = decision({ id: "w", ticker: "D", decisionDate: "2026-02-01" });
    const settledA = decision({ id: "b", ticker: "E", decisionDate: "2026-03-01", reviews: [{ id: "r", reviewDate: at("2026-04-01") }] });
    const settledB = decision({ id: "a", ticker: "F", decisionDate: "2026-03-01", reviews: [{ id: "r", reviewDate: at("2026-04-01") }] });
    const rows = [txn("C", "buy", "2026-06-05", "2026-09-22T00:00:00Z"), txn("D", "buy", "2026-02-05", "2026-09-21T00:00:00Z")];
    const r = derive([settledA, factOld, dueLate, settledB, factNew, dueEarly], rows);
    expect(r.items.map((i) => i.decisionId)).toEqual(["y", "z", "x", "w", "a", "b"]);
    expect(r.attention.map((i) => i.decisionId)).toEqual(["y", "z", "x", "w"]);
    expect(r.monitoredWithoutHorizon).toBe(3); // y, x, w (z has a horizon; a/b are settled)
  });
  it("utcDay compares calendar days in UTC", () => {
    expect(utcDay(at("2026-09-08T23:59:59Z"))).toBe(utcDay(at("2026-09-08")));
    expect(utcDay(at("2026-09-09T00:00:00Z"))).toBe(utcDay(at("2026-09-08")) + 1);
  });
});

describe("calendar days — the investor's zone, not the server's (final review)", () => {
  // 2026-09-07T21:30Z is 00:30 on 2026-09-08 in Jerusalem (UTC+3 in September).
  const nightDecision = () => decision({ ticker: "A", decisionDate: "2026-09-07T21:30:00Z" });
  const IL = { timeZone: "Asia/Jerusalem" };
  it("a trade dated the decision's Jerusalem day is SAME DAY in Jerusalem — listed, never 'after' (on the UTC day it would have been a false NEW_EXECUTION)", () => {
    const rows = [txn("A", "buy", "2026-09-08", "2026-09-20T00:00:00Z")];
    const il = one([nightDecision()], rows, IL);
    expect(il.execution.sameDay).toHaveLength(1);
    expect(il.execution.after).toEqual([]);
    expect(il.reasons).toEqual([]);
    const utc = one([nightDecision()], rows, { timeZone: "UTC" });
    expect(utc.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]); // the defect the zone fixes
  });
  it("the next Jerusalem day is provably after; the previous day is before; a west-of-UTC zone moves the decision the other way", () => {
    expect(one([nightDecision()], [txn("A", "buy", "2026-09-09", "2026-09-20T00:00:00Z")], IL).reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(one([nightDecision()], [txn("A", "sell", "2026-09-07", "2026-09-20T00:00:00Z")], IL).execution.backfilledBefore).toHaveLength(1);
    // 2026-09-08T02:30Z is still 2026-09-07 in Los Angeles: a trade dated 09-08 is the NEXT day there.
    const laDecision = decision({ ticker: "A", decisionDate: "2026-09-08T02:30:00Z" });
    expect(one([laDecision], [txn("A", "buy", "2026-09-08", "2026-09-20T00:00:00Z")], { timeZone: "America/Los_Angeles" }).reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(one([laDecision], [txn("A", "buy", "2026-09-08", "2026-09-20T00:00:00Z")], IL).reasons).toEqual([]);
  });
  it("REVIEW_DUE: due from 00:00 of the horizon day in the investor's zone; a review at 00:30 on the horizon day satisfies it, one at 23:30 the day before does not", () => {
    const d = (reviews: string[]) => decision({ ticker: "A", decisionDate: "2026-08-01T10:00:00Z", reviewByDate: at("2026-10-15"), reviews: reviews.map((r, i) => ({ id: `r${i}`, reviewDate: at(r) })) });
    const justAfterMidnight = at("2026-10-14T21:30:00Z"); // 00:30 Oct 15 Jerusalem
    expect(one([d([])], [], { ...IL, today: justAfterMidnight }).horizon.status).toBe("due");
    expect(one([d([])], [], { timeZone: "UTC", today: justAfterMidnight }).horizon.status).toBe("upcoming");
    expect(one([d(["2026-10-14T21:30:00Z"])], [], { ...IL, today: at("2026-10-20T12:00:00Z") }).horizon.status).toBe("satisfied");
    expect(one([d(["2026-10-14T20:30:00Z"])], [], { ...IL, today: at("2026-10-20T12:00:00Z") })).toMatchObject({ horizon: { status: "due" }, reasons: ["REVIEW_DUE"] });
  });
  it("PREDICTION_DUE: the deadline instant is placed on the investor's calendar too", () => {
    const d = decision({ ticker: "A", decisionDate: "2026-08-01T10:00:00Z", predictions: [{ id: "p", status: "pending", checkableByDate: at("2026-10-14T21:30:00Z") }] }); // 00:30 Oct 15 Jerusalem
    expect(one([d], [], { ...IL, today: at("2026-10-14T22:00:00Z") }).reasons).toEqual(["PREDICTION_DUE"]); // 01:00 Oct 15 Jerusalem
    expect(one([d], [], { ...IL, today: at("2026-10-14T20:00:00Z") }).reasons).toEqual([]); // 23:00 Oct 14 Jerusalem
  });
  it("an unknown zone is refused loudly; nothing is defaulted", () => {
    expect(() => derive([], [], { timeZone: "Not/AZone" })).toThrow(/Unknown time zone/);
    expect(() => derive([], [], { timeZone: "" })).toThrow(/Unknown time zone/);
  });
});

describe("novelty clock equality boundaries (final review)", () => {
  const D = "2026-09-08T07:10:00Z";
  const reviewAt = at("2026-09-15T12:00:00.000Z");
  const reviewed = () => decision({ ticker: "A", decisionDate: D, reviews: [{ id: "r", reviewDate: reviewAt }] });
  const after = (createdAt: string) => one([reviewed()], [{ ...txn("A", "buy", "2026-09-10", "2026-09-01T00:00:00Z"), createdAt: new Date(createdAt) }]);
  const before = (createdAt: string) => one([reviewed()], [{ ...txn("A", "sell", "2026-09-01", "2026-09-01T00:00:00Z"), createdAt: new Date(createdAt) }]);
  it("created_at == baseline is absorbed; one millisecond later is novel; one earlier is absorbed", () => {
    expect(after("2026-09-15T12:00:00.000Z").reasons).toEqual([]);
    expect(after("2026-09-15T12:00:00.001Z").reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(after("2026-09-15T11:59:59.999Z").reasons).toEqual([]);
    expect(before("2026-09-15T12:00:00.000Z")).toMatchObject({ reasons: [], execution: { backfilledBefore: [expect.anything()] } });
    expect(before("2026-09-15T12:00:00.001Z").reasons).toEqual(["HISTORY_BACKFILLED"]);
  });
  it("a fact can never be in two execution groups, so the two execution reasons never fire for the same row", () => {
    const rows = [txn("A", "buy", "2026-09-01", "2026-09-20T00:00:00Z", "x"), txn("A", "buy", "2026-09-08", "2026-09-20T00:00:00Z", "y"), txn("A", "buy", "2026-09-09", "2026-09-20T00:00:00Z", "z")];
    const item = one([decision({ ticker: "A", decisionDate: D })], rows);
    const all = [...item.execution.knownBefore, ...item.execution.backfilledBefore, ...item.execution.sameDay, ...item.execution.after].map((f) => f.transactionId).sort();
    expect(all).toEqual(["x", "y", "z"]);
    expect(item.backfilled.map((f) => f.transactionId)).toEqual(["x"]);
    expect(item.newExecutionAfterDecision.map((f) => f.transactionId)).toEqual(["z"]);
    expect(item.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION", "HISTORY_BACKFILLED"]);
  });
  it("a backfilled row inserted after the snapshot but before a later review is absorbed by that review", () => {
    const d = decision({ ticker: "A", decisionDate: D, reviews: [{ id: "r", reviewDate: at("2026-09-21T00:00:00Z") }] });
    const item = one([d], [txn("A", "sell", "2026-09-01", "2026-09-20T00:00:00Z")]);
    expect(item.execution.backfilledBefore).toHaveLength(1);
    expect(item.reasons).toEqual([]);
    expect(item.state).toBe("settled");
  });
});

describe("properties", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  const dayStr = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  function scenario(rand: () => number) {
    const decisions: AttentionDecisionInput[] = [];
    const transactions: AttentionTransactionInput[] = [];
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const dDay = 100 + Math.floor(rand() * 120);
      const ticker = ["A", "B", "C"][Math.floor(rand() * 3)]!;
      const preds = Array.from({ length: Math.floor(rand() * 3) }, (_, k) => ({ id: `p${i}-${k}`, status: rand() < 0.6 ? "pending" : "confirmed", checkableByDate: rand() < 0.5 ? null : at(dayStr(dDay + Math.floor(rand() * 200))) }));
      const reviews = rand() < 0.4 ? [{ id: `r${i}`, reviewDate: at(`${dayStr(dDay + Math.floor(rand() * 60))}T12:00:00Z`) }] : [];
      decisions.push(decision({ id: `d${i}`, ticker, decisionDate: `${dayStr(dDay)}T09:00:00Z`, reviewByDate: rand() < 0.4 ? at(dayStr(dDay + Math.floor(rand() * 200))) : null, predictions: preds, reviews }));
      for (let k = 0; k < Math.floor(rand() * 5); k++) {
        transactions.push(txn(ticker, rand() < 0.5 ? "buy" : "sell", dayStr(dDay - 30 + Math.floor(rand() * 60)), `${dayStr(dDay - 10 + Math.floor(rand() * 80))}T10:00:00Z`, `t${i}-${k}`));
      }
    }
    return { decisions, transactions };
  }
  const shuffle = <T,>(arr: T[], rand: () => number) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const serial = (r: ReturnType<typeof derive>) => JSON.stringify(r, (_, v) => (v instanceof Map ? [...v] : v));

  it("derivation is idempotent and invariant under input permutation (200 scenarios)", () => {
    const rand = rng(7);
    for (let i = 0; i < 200; i++) {
      const s = scenario(rand);
      const a = derive(s.decisions, s.transactions);
      const b = derive(shuffle(s.decisions, rand), shuffle(s.transactions, rand));
      expect(serial(b)).toBe(serial(a));
      expect(serial(derive(s.decisions, s.transactions))).toBe(serial(a));
    }
  });
  it("a later review absorbs every fact already known by it (200 scenarios)", () => {
    const rand = rng(11);
    for (let i = 0; i < 200; i++) {
      const s = scenario(rand);
      const noHorizon = s.decisions.map((d) => ({ ...d, reviewByDate: null, predictions: [] as AttentionDecisionInput["predictions"] }));
      const latestFact = Math.max(TODAY.getTime() - 1, ...s.transactions.map((t) => t.createdAt.getTime()));
      const reviewed = noHorizon.map((d) => ({ ...d, reviews: [...d.reviews, { id: "late", reviewDate: new Date(latestFact + 1) }] }));
      for (const item of derive(reviewed, s.transactions).items) {
        expect(item.reasons).toEqual([]);
        expect(item.state).toBe("settled");
      }
      // and without that review, every reason present is one of the four, each backed by at least one novel fact or due date
      for (const item of derive(noHorizon, s.transactions).items) {
        for (const reason of item.reasons) {
          if (reason === "NEW_EXECUTION_AFTER_DECISION") expect(item.newExecutionAfterDecision.length).toBeGreaterThan(0);
          if (reason === "HISTORY_BACKFILLED") expect(item.backfilled.length).toBeGreaterThan(0);
          expect(["NEW_EXECUTION_AFTER_DECISION", "HISTORY_BACKFILLED"]).toContain(reason);
        }
        for (const f of item.newExecutionAfterDecision) expect(f.persistedAt.getTime()).toBeGreaterThan(item.baseline.at.getTime());
        for (const f of item.execution.sameDay) expect(utcDay(f.transactionDate)).toBe(utcDay(item.decisionDate));
      }
    }
  });
});
