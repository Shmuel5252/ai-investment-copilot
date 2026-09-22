import { describe, expect, it } from "vitest";
import { computePositions, type TransactionInput, type OpeningStateInput } from "@/lib/portfolio/positions";
import {
  deriveEpisodeJournal,
  findEpisodeByTransaction,
  sortJournalEpisodes,
  type EpisodeAnswerInput,
  type EpisodeTransactionInput,
} from "@/lib/portfolio/episodes";
import { resolveTellMeWhyAnchor, toHindsightSafeJournal, toHindsightSafeView } from "@/lib/interview/journal";
import { buildTellMeWhyQuestion, describeEpisodeEntry, formatQuestionDate } from "@/lib/interview/tell-me-why-question";
import { rng } from "../helpers/independence";

// Episode Journal V1 — DB-free coverage of the derivation, the coverage
// rule, the anchor, the hindsight-safe projection and the deterministic
// question. Every episode key and every P&L number comes from the REAL
// computePositions(); nothing here re-derives position math.

const DAY = 86_400_000;
type Spec = { id: string; ticker: string | null; type: TransactionInput["transactionType"]; date: string; qty?: number; price?: number; order?: number | null };
// One row shape that satisfies BOTH the real computePositions() and the journal derivation.
const txn = (s: Spec): TransactionInput & EpisodeTransactionInput => ({
  id: s.id,
  ticker: s.ticker,
  transactionType: s.type,
  quantity: s.qty ?? null,
  price: s.price ?? null,
  amount: s.type === "buy" ? -(s.qty ?? 0) * (s.price ?? 0) : s.type === "sell" ? (s.qty ?? 0) * (s.price ?? 0) : 1,
  transactionDate: new Date(s.date),
  intraDayOrder: s.order ?? null,
});
const answer = (id: string, transactionId: string | null, createdAt = "2026-09-01T00:00:00.000Z"): EpisodeAnswerInput => ({
  id,
  transactionId,
  questionText: "q",
  answerText: `answer ${id}`,
  createdAt: new Date(createdAt),
});
function journalOf(specs: Spec[], answers: EpisodeAnswerInput[] = [], openingStates: OpeningStateInput[] = []) {
  const inputs = specs.map(txn);
  const portfolio = computePositions(inputs, openingStates);
  return { journal: deriveEpisodeJournal(inputs, portfolio, answers), portfolio };
}

// The real MP -> MRVL shape (manual-entry precedent) plus a second X lifecycle.
const HISTORY: Spec[] = [
  { id: "mp-buy", ticker: "MP", type: "buy", date: "2026-08-05", qty: 10, price: 48 },
  { id: "mp-s1", ticker: "MP", type: "sell", date: "2026-08-24", qty: 6, price: 60 },
  { id: "mp-s2", ticker: "MP", type: "sell", date: "2026-08-28", qty: 4, price: 72 },
  { id: "mrvl-buy", ticker: "MRVL", type: "buy", date: "2026-08-28", qty: 5, price: 80 },
  { id: "x-b1", ticker: "X", type: "buy", date: "2026-01-05", qty: 3, price: 10 },
  { id: "x-s1", ticker: "X", type: "sell", date: "2026-01-10", qty: 3, price: 9 },
  { id: "x-b2", ticker: "X", type: "buy", date: "2026-02-01", qty: 2, price: 11 },
  { id: "x-s2", ticker: "X", type: "sell", date: "2026-02-10", qty: 2, price: 13 },
  { id: "div", ticker: "MP", type: "dividend", date: "2026-08-10" },
  { id: "fee", ticker: null, type: "fee", date: "2026-08-11" },
];

describe("A. episode derivation — over the real computePositions() episode map", () => {
  const { journal, portfolio } = journalOf(HISTORY);
  const byKey = new Map(journal.episodes.map((e) => [e.key, e]));

  it("every buy/sell the position math keyed appears in exactly one episode; non-trades never do", () => {
    const seen = journal.episodes.flatMap((e) => e.transactions.map((t) => t.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(portfolio.episodeKeyByTransactionId.keys()));
    expect(seen).not.toContain("div");
    expect(seen).not.toContain("fee");
    expect(journal.coverage.total).toBe(4); // MP#1, MRVL#1, X#1, X#2
  });

  it("MP: buy + partial sell + final sell are ONE closed episode, anchored to the buy, with both sells' real trace facts", () => {
    const mp = byKey.get("MP#1")!;
    expect(mp.status).toBe("closed");
    expect(mp.transactions.map((t) => t.id)).toEqual(["mp-buy", "mp-s1", "mp-s2"]);
    expect(mp.buyCount).toBe(1);
    expect(mp.sellCount).toBe(2);
    expect(mp.entry?.transactionId).toBe("mp-buy");
    expect(mp.entry?.quantity).toBe(10);
    expect(mp.entry?.price).toBe(48);
    expect(mp.later.exitDate?.toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(mp.later.holdingDays).toBe(23);
    const trace = portfolio.sellTrace.filter((s) => s.ticker === "MP");
    expect(mp.later.sells.map((s) => [s.transactionId, s.realizedPnlPercent, s.holdingPeriodDays])).toEqual(
      trace.map((s) => [s.transactionId, s.realizedPnlPercent, s.holdingPeriodDays])
    );
    expect(mp.later.sells[0]!.realizedPnlPercent).toBeCloseTo(25, 6); // 48 -> 60
    expect(mp.later.sells[1]!.realizedPnlPercent).toBeCloseTo(50, 6); // 48 -> 72
  });

  it("MRVL: a position still held is an OPEN episode with no exit and no sells", () => {
    const mrvl = byKey.get("MRVL#1")!;
    expect(mrvl.status).toBe("open");
    expect(mrvl.later).toEqual({ exitDate: null, holdingDays: null, sells: [] });
    expect(mrvl.entry?.transactionId).toBe("mrvl-buy");
  });

  it("two lifecycles of one ticker are two episodes, both closed, each anchored to its own buy", () => {
    expect(byKey.get("X#1")!.transactions.map((t) => t.id)).toEqual(["x-b1", "x-s1"]);
    expect(byKey.get("X#2")!.transactions.map((t) => t.id)).toEqual(["x-b2", "x-s2"]);
    expect(byKey.get("X#1")!.status).toBe("closed");
    expect(byKey.get("X#2")!.status).toBe("closed");
    expect(byKey.get("X#1")!.entry?.transactionId).toBe("x-b1");
    expect(byKey.get("X#2")!.entry?.transactionId).toBe("x-b2");
    expect(byKey.get("X#1")!.later.exitDate?.toISOString().slice(0, 10)).toBe("2026-01-10");
  });

  it("the entry anchor is deterministic on a same-day tie: declared intra-day order first, then id", () => {
    const { journal: j } = journalOf([
      { id: "b-z", ticker: "T", type: "buy", date: "2026-03-01", qty: 1, price: 1, order: 2 },
      { id: "b-a", ticker: "T", type: "buy", date: "2026-03-01", qty: 1, price: 1, order: 1 },
    ]);
    expect(j.episodes[0]!.entry?.transactionId).toBe("b-a");
    const { journal: j2 } = journalOf([
      { id: "b-z", ticker: "T", type: "buy", date: "2026-03-01", qty: 1, price: 1 },
      { id: "b-a", ticker: "T", type: "buy", date: "2026-03-01", qty: 1, price: 1 },
    ]);
    expect(j2.episodes[0]!.entry?.transactionId).toBe("b-a");
  });

  it("an episode with NO buy (opened before the imported window) has no anchor: entry null, fails closed", () => {
    const { journal: j } = journalOf(
      [{ id: "y-sell", ticker: "Y", type: "sell", date: "2026-04-01", qty: 5, price: 20 }],
      [],
      [{ ticker: "Y", quantity: 5, costBasisPerShare: 10, costBasisConfidence: "known", asOfDate: new Date("2026-01-01") }]
    );
    const y = j.episodes[0]!;
    expect(y.entry).toBeNull();
    expect(y.status).toBe("closed");
    expect(y.later.sells).toHaveLength(1);
    expect(resolveTellMeWhyAnchor(j, "y-sell")).toEqual({ ok: false, reason: "no_entry_anchor" });
    expect(toHindsightSafeView(y).anchorable).toBe(false);
  });

  it("fails closed on inconsistent inputs (an episode key for a transaction that was not passed)", () => {
    const inputs = HISTORY.map(txn);
    const portfolio = computePositions(inputs, []);
    expect(() => deriveEpisodeJournal(inputs.filter((t) => t.id !== "mp-buy"), portfolio, [])).toThrow(/mp-buy/);
  });
});

describe("B. rationale coverage", () => {
  it("no answer -> uncovered; one answer on the anchor -> covered", () => {
    expect(journalOf(HISTORY).journal.coverage).toEqual({ covered: 0, total: 4 });
    const { journal } = journalOf(HISTORY, [answer("a1", "mp-buy")]);
    expect(journal.coverage).toEqual({ covered: 1, total: 4 });
    const mp = journal.episodes.find((e) => e.key === "MP#1")!;
    expect(mp.rationale).toMatchObject({ status: "answered", latestAnswerId: "a1" });
  });

  it("several answers on the SAME episode (anchored to different transactions of it) are ONE covered episode, latest last", () => {
    const { journal } = journalOf(HISTORY, [answer("a1", "mp-buy", "2026-09-01T00:00:00Z"), answer("a2", "mp-s2", "2026-09-02T00:00:00Z")]);
    expect(journal.coverage).toEqual({ covered: 1, total: 4 });
    const mp = journal.episodes.find((e) => e.key === "MP#1")!;
    expect(mp.rationale.answers.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(mp.rationale.latestAnswerId).toBe("a2");
  });

  it("different episodes count separately, including two lifecycles of one ticker", () => {
    const { journal } = journalOf(HISTORY, [answer("a1", "x-s1"), answer("a2", "x-b2")]);
    expect(journal.coverage).toEqual({ covered: 2, total: 4 });
    expect(journal.episodes.find((e) => e.key === "X#1")!.rationale.latestAnswerId).toBe("a1");
    expect(journal.episodes.find((e) => e.key === "X#2")!.rationale.latestAnswerId).toBe("a2");
  });

  it("an answer with no transaction, or anchored to a non-trade, covers nothing", () => {
    const { journal } = journalOf(HISTORY, [answer("a1", null), answer("a2", "div"), answer("a3", "fee")]);
    expect(journal.coverage).toEqual({ covered: 0, total: 4 });
  });

  it("supersession cannot inflate coverage: the caller passes EFFECTIVE answers (getAllAnswersForInvestor drops superseded rows), so a chain of updates is still one covered episode with the latest as current", () => {
    // What getAllAnswersForInvestor returns after a1 was superseded by a2: only a2.
    const { journal } = journalOf(HISTORY, [answer("a2", "mp-buy", "2026-09-05T00:00:00Z")]);
    expect(journal.coverage).toEqual({ covered: 1, total: 4 });
    expect(journal.episodes.find((e) => e.key === "MP#1")!.rationale.answers.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("C. ordering — unanswered first, newest entry first, then ticker, then episode number", () => {
  it("is deterministic and puts what still needs a rationale on top", () => {
    const { journal } = journalOf(HISTORY, [answer("a1", "mrvl-buy")]);
    expect(journal.episodes.map((e) => e.key)).toEqual(["MP#1", "X#2", "X#1", "MRVL#1"]);
    expect(sortJournalEpisodes([...journal.episodes].reverse()).map((e) => e.key)).toEqual(["MP#1", "X#2", "X#1", "MRVL#1"]);
  });
});

describe("D. hindsight protection — the projection and the question", () => {
  const { journal } = journalOf(HISTORY, [answer("a1", "x-b1")]);
  const view = toHindsightSafeJournal(journal);

  it("an UNANSWERED episode carries no later/outcome facts at all — not even for a closed episode with real sells", () => {
    const mp = view.episodes.find((e) => e.key === "MP#1")!;
    expect(mp.rationale.status).toBe("unanswered");
    expect(mp.later).toBeNull();
    expect(JSON.stringify(mp)).not.toMatch(/realizedPnl|holdingPeriodDays|holdingDays|exitDate|sells/);
    // ...while it still identifies the decision
    expect(mp.entry).toMatchObject({ transactionId: "mp-buy", quantity: 10, price: 48 });
    expect(mp.status).toBe("closed");
    expect(mp.anchorable).toBe(true);
  });

  it("an ANSWERED episode exposes the deterministic later facts", () => {
    const x1 = view.episodes.find((e) => e.key === "X#1")!;
    expect(x1.later).not.toBeNull();
    expect(x1.later!.exitDate?.toISOString().slice(0, 10)).toBe("2026-01-10");
    expect(x1.later!.sells[0]!.realizedPnlPercent).toBeCloseTo(-10, 6);
  });

  it("the question identifies the decision (ticker, episode, entry date, quantity, price) and nothing outcome-loaded", () => {
    const mp = journal.episodes.find((e) => e.key === "MP#1")!;
    const q = buildTellMeWhyQuestion({ ticker: mp.ticker, episodeNumber: mp.episodeNumber, status: mp.status, entry: mp.entry });
    expect(q).toContain("MP#1");
    expect(q).toContain("05/08/2026");
    expect(q).toContain("10 מניות");
    expect(q).toContain("$48.00");
    expect(q).not.toMatch(/%|רווח|הפסד|תשואה|עלה|ירד|מוקדם|מאוחר|\+25|\+50|60|72/);
  });

  it("open vs closed phrasing: an open episode is not asked why it exited", () => {
    const mrvl = journal.episodes.find((e) => e.key === "MRVL#1")!;
    const q = buildTellMeWhyQuestion({ ticker: "MRVL", episodeNumber: 1, status: "open", entry: mrvl.entry });
    expect(q).toContain("MRVL#1");
    expect(q).not.toMatch(/לצאת|לממש/);
    expect(q).toMatch(/מנהל/);
    expect(buildTellMeWhyQuestion({ ticker: "MP", episodeNumber: 1, status: "closed", entry: null })).toMatch(/לצאת|לממש/);
  });

  it("the question builder has no input for outcome: entry facts only, and a missing entry yields the bare question", () => {
    expect(describeEpisodeEntry({ ticker: "MP", entry: null })).toBeNull();
    expect(buildTellMeWhyQuestion({ ticker: "MP", status: "closed", entry: null })).toBe(buildTellMeWhyQuestion("MP"));
    expect(describeEpisodeEntry({ ticker: "MP", episodeNumber: 2, entry: { date: new Date("2026-08-05T00:00:00Z"), quantity: null, price: null } })).toBe(
      "פוזיציה MP#2 — כניסה ב-05/08/2026."
    );
    expect(formatQuestionDate(new Date("2026-01-09T23:30:00Z"))).toBe("09/01/2026");
  });

  it("the legacy string form is unchanged (post-manual-entry button on /import)", () => {
    expect(buildTellMeWhyQuestion("MP")).toContain("MP");
    expect(buildTellMeWhyQuestion("MP")).toBe(buildTellMeWhyQuestion("MP"));
  });
});

describe("E. anchor resolution and lookup", () => {
  const { journal } = journalOf(HISTORY);
  it("a SELL resolves to its episode's entry BUY; a BUY to itself; an unkeyed transaction to no episode", () => {
    expect(resolveTellMeWhyAnchor(journal, "mp-s2")).toMatchObject({ ok: true, anchorTransactionId: "mp-buy" });
    expect(resolveTellMeWhyAnchor(journal, "x-s2")).toMatchObject({ ok: true, anchorTransactionId: "x-b2" });
    expect(resolveTellMeWhyAnchor(journal, "mrvl-buy")).toMatchObject({ ok: true, anchorTransactionId: "mrvl-buy" });
    expect(resolveTellMeWhyAnchor(journal, "div")).toEqual({ ok: false, reason: "no_episode" });
    expect(resolveTellMeWhyAnchor(journal, "nope")).toEqual({ ok: false, reason: "no_episode" });
    expect(findEpisodeByTransaction(journal, "x-s1")?.key).toBe("X#1");
  });
});

describe("F. property suite — random histories through the real computePositions()", () => {
  it("every keyed trade is in exactly one episode, each episode is chronological with its earliest buy as anchor, and coverage is consistent", () => {
    const rand = rng(77);
    for (let trial = 0; trial < 300; trial++) {
      const specs: Spec[] = [];
      const tickers = ["A", "B", "C"].slice(0, 1 + Math.floor(rand() * 3));
      let day = Date.parse("2026-01-01T00:00:00Z");
      for (let i = 0; i < 2 + Math.floor(rand() * 10); i++) {
        day += Math.floor(rand() * 3) * DAY;
        const ticker = tickers[Math.floor(rand() * tickers.length)]!;
        const type = rand() < 0.55 ? "buy" : "sell";
        specs.push({ id: `t${i}`, ticker, type, date: new Date(day).toISOString(), qty: 1 + Math.floor(rand() * 4), price: 10 + Math.floor(rand() * 5) });
      }
      const inputs = specs.map(txn);
      const portfolio = computePositions(inputs, []);
      const answers: EpisodeAnswerInput[] = specs.filter(() => rand() < 0.25).map((s, i) => answer(`a${i}`, s.id));
      const journal = deriveEpisodeJournal(inputs, portfolio, answers);

      const seen = journal.episodes.flatMap((e) => e.transactions.map((t) => t.id));
      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(seen)).toEqual(new Set(portfolio.episodeKeyByTransactionId.keys()));
      for (const e of journal.episodes) {
        for (const t of e.transactions) expect(portfolio.episodeKeyByTransactionId.get(t.id)).toBe(e.key);
        for (let i = 1; i < e.transactions.length; i++) expect(e.transactions[i]!.date.getTime()).toBeGreaterThanOrEqual(e.transactions[i - 1]!.date.getTime());
        // Independent anchor oracle from the RAW specs (not the episode's own
        // sorted list): the earliest-dated BUY keyed to this episode, ties by
        // id — no intraDayOrder in this suite, so (date, id) is the whole rule.
        const oracle = specs
          .filter((s) => s.type === "buy" && portfolio.episodeKeyByTransactionId.get(s.id) === e.key)
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || (a.id < b.id ? -1 : 1))[0];
        expect(e.entry?.transactionId ?? null).toBe(oracle?.id ?? null);
        if (oracle) {
          expect(e.entry).toMatchObject({ quantity: oracle.qty, price: oracle.price });
          expect(e.entry!.date.getTime()).toBe(Date.parse(oracle.date));
        }
        expect(e.buyCount + e.sellCount).toBe(e.transactions.length);
        const answeredIds = new Set(answers.map((a) => a.transactionId));
        expect(e.rationale.status).toBe(e.transactions.some((t) => answeredIds.has(t.id)) ? "answered" : "unanswered");
        for (const s of e.later.sells) expect(e.transactions.some((t) => t.id === s.transactionId)).toBe(true);
        if (e.status === "open") expect(portfolio.positions.some((p) => p.ticker === e.ticker)).toBe(true);
      }
      const openEpisodesPerTicker = new Map<string, number>();
      for (const e of journal.episodes) if (e.status === "open") openEpisodesPerTicker.set(e.ticker, (openEpisodesPerTicker.get(e.ticker) ?? 0) + 1);
      for (const n of openEpisodesPerTicker.values()) expect(n).toBe(1);
      expect(journal.coverage.total).toBe(journal.episodes.length);
      expect(journal.coverage.covered).toBe(journal.episodes.filter((e) => e.rationale.status === "answered").length);
      for (let i = 1; i < journal.episodes.length; i++) {
        const a = journal.episodes[i - 1]!, b = journal.episodes[i]!;
        if (a.rationale.status === "answered") expect(b.rationale.status).toBe("answered");
      }
    }
  });
});
