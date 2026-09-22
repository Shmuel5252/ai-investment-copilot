// Episode Journal V1 — production-path tests through the REAL
// interview router (createCaller), repositories and Postgres. No AI is
// involved anywhere in this flow, so nothing is mocked. Runs only against
// the authorized test database (tests/support).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { interviewRouter } from "@/server/routers/interview";
import { getAllAnswersForInvestor, insertInterviewAnswer, insertInterviewSession } from "@/db/repositories/interview";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { mkInvestor, mkTxn } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });
const caller = (investorId: string) => interviewRouter.createCaller({ session: { investorId } } as never);

async function insertRow(values: Omit<typeof schema.transactions.$inferInsert, "amount"> & { amount?: string }) {
  const [row] = await db
    .insert(schema.transactions)
    .values({ amount: "0", ...values })
    .returning();
  return row!;
}

let investorId: string;
let foreignInvestorId: string;
let ids: Record<string, string>;

beforeAll(async () => {
  investorId = await mkInvestor(db, "journal");
  foreignInvestorId = await mkInvestor(db, "journal-foreign");
  ids = {
    // The MP episode, sourced from a CSV import — proving the contract no longer depends on source.
    mpBuy: (await insertRow({ investorId, ticker: "MP", transactionType: "buy", quantity: "10", price: "48", amount: "-480", transactionDate: new Date("2026-08-05T00:00:00Z"), source: "csv_import" })).id,
    mpSell1: (await insertRow({ investorId, ticker: "MP", transactionType: "sell", quantity: "6", price: "60", amount: "360", transactionDate: new Date("2026-08-24T00:00:00Z"), source: "csv_import" })).id,
    mpSell2: (await insertRow({ investorId, ticker: "MP", transactionType: "sell", quantity: "4", price: "72", amount: "288", transactionDate: new Date("2026-08-28T00:00:00Z"), source: "csv_import" })).id,
    mrvlBuy: await mkTxn(db, investorId, "MRVL", "buy", "2026-08-28", "5"),
    dividend: (await insertRow({ investorId, ticker: "MP", transactionType: "dividend", amount: "3", transactionDate: new Date("2026-08-10T00:00:00Z"), source: "csv_import" })).id,
    fee: (await insertRow({ investorId, ticker: null, transactionType: "fee", amount: "-1", transactionDate: new Date("2026-08-11T00:00:00Z"), source: "csv_import" })).id,
    deposit: (await insertRow({ investorId, ticker: null, transactionType: "deposit", amount: "1000", transactionDate: new Date("2026-01-01T00:00:00Z"), source: "csv_import" })).id,
    tickerlessBuy: (await insertRow({ investorId, ticker: null, transactionType: "buy", quantity: "1", price: "1", amount: "-1", transactionDate: new Date("2026-03-03T00:00:00Z"), source: "csv_import" })).id,
    foreignBuy: await mkTxn(db, foreignInvestorId, "AAA", "buy", "2026-05-05", "1"),
  };
});

afterAll(async () => {
  await client.end();
});

describe("C. startTellMeWhy — the widened contract", () => {
  it("an owned BUY from a CSV import is accepted: user_initiated session, anchor = itself, deterministic question with entry facts only", async () => {
    const r = await caller(investorId).startTellMeWhy({ transactionId: ids.mpBuy! });
    expect(r.transactionId).toBe(ids.mpBuy);
    expect(r.requestedTransactionId).toBe(ids.mpBuy);
    expect(r.episodeKey).toBe("MP#1");
    expect(r.episodeStatus).toBe("closed");
    expect(r.questionText).toContain("MP#1");
    expect(r.questionText).toContain("05/08/2026");
    expect(r.questionText).not.toMatch(/%|רווח|הפסד|תשואה|60|72/); // the MP sells made +25% / +50%: never in the prompt
    const session = await db.query.interviewSessions.findFirst({ where: (s, { eq }) => eq(s.id, r.sessionId) });
    expect(session).toMatchObject({ investorId, origin: "user_initiated", status: "in_progress" });
  });

  it("an owned SELL resolves to its episode and is anchored to the episode's entry BUY", async () => {
    const r = await caller(investorId).startTellMeWhy({ transactionId: ids.mpSell2! });
    expect(r.requestedTransactionId).toBe(ids.mpSell2);
    expect(r.transactionId).toBe(ids.mpBuy);
    expect(r.episodeKey).toBe("MP#1");
  });

  it("an open position asks about entry and management, not exit", async () => {
    const r = await caller(investorId).startTellMeWhy({ transactionId: ids.mrvlBuy! });
    expect(r.episodeStatus).toBe("open");
    expect(r.questionText).toMatch(/מנהל/);
    expect(r.questionText).not.toMatch(/לצאת|לממש/);
  });

  it("refuses a foreign investor's transaction and a nonexistent one (NOT_FOUND — nothing leaks about existence)", async () => {
    for (const transactionId of [ids.foreignBuy!, "00000000-0000-4000-8000-000000000000"]) {
      const err = await caller(investorId).startTellMeWhy({ transactionId }).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("refuses non-investment transaction types and a buy with no ticker (BAD_REQUEST)", async () => {
    for (const [name, transactionId] of [["dividend", ids.dividend], ["fee", ids.fee], ["deposit", ids.deposit], ["tickerless buy", ids.tickerlessBuy]] as const) {
      const err = await caller(investorId).startTellMeWhy({ transactionId: transactionId! }).catch((e) => e);
      expect(err, name).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code, name).toBe("BAD_REQUEST");
    }
    const sessions = await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.investorId, investorId));
    expect(sessions.every((s) => s.origin === "user_initiated")).toBe(true);
  });

  it("fails closed for an episode with no BUY in the history (opened before the window): no session is created", async () => {
    const orphanInvestor = await mkInvestor(db, "journal-orphan");
    await db.insert(schema.portfolioOpeningStates).values({ investorId: orphanInvestor, ticker: "OLD", quantity: "5", costBasisPerShare: "10", costBasisConfidence: "known", asOfDate: new Date("2026-01-01T00:00:00Z") });
    const sell = await mkTxn(db, orphanInvestor, "OLD", "sell", "2026-04-01", "5");
    const err = await caller(orphanInvestor).startTellMeWhy({ transactionId: sell }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect((err as TRPCError).message).toMatch(/no buy/);
    expect(await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.investorId, orphanInvestor))).toHaveLength(0);
    const journal = await caller(orphanInvestor).journal();
    expect(journal.episodes[0]).toMatchObject({ key: "OLD#1", anchorable: false, entry: null });
  });
});

describe("D/B/E. the journal, hindsight protection, append-only answers, supersession and the downstream reader", () => {
  let firstAnswerId: string;

  it("before any rationale: coverage 0/N, every episode unanswered, and NO later facts are sent for any of them", async () => {
    const journal = await caller(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 0, total: 2 }); // MP#1 (closed), MRVL#1 (open); the tickerless buy is never keyed
    for (const e of journal.episodes) {
      expect(e.rationale.status).toBe("unanswered");
      expect(e.later).toBeNull();
      expect(e.entry).not.toBeNull();
    }
    expect(JSON.stringify(journal)).not.toMatch(/realizedPnl|exitDate|holdingDays|"sells"/);
    expect(await caller(investorId).journalCoverage()).toEqual({ covered: 0, total: 2 });
  });

  it("writing the rationale through the router creates an append-only answer on the anchor; the journal then covers MP#1 and reveals its later facts", async () => {
    const start = await caller(investorId).startTellMeWhy({ transactionId: ids.mpSell1! });
    const saved = await caller(investorId).answer({
      sessionId: start.sessionId,
      transactionId: start.transactionId,
      questionText: start.questionText,
      answerText: "נכנסתי ל-MP בגלל הסיפור של critical minerals, ומימשתי בשני שלבים.",
    });
    await caller(investorId).complete({ sessionId: start.sessionId });
    firstAnswerId = saved.id;
    expect(saved.transactionId).toBe(ids.mpBuy);
    expect(saved.supersedesAnswerId).toBeNull();

    const journal = await caller(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 1, total: 2 });
    const mp = journal.episodes.find((e) => e.key === "MP#1")!;
    expect(mp.rationale).toMatchObject({ status: "answered", latestAnswerId: firstAnswerId });
    expect(mp.later).not.toBeNull();
    expect(new Date(mp.later!.exitDate!).toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(mp.later!.holdingDays).toBe(23);
    expect(mp.later!.sells.map((s) => Math.round(s.realizedPnlPercent))).toEqual([25, 50]);
    const mrvl = journal.episodes.find((e) => e.key === "MRVL#1")!;
    expect(mrvl.later).toBeNull(); // still unanswered: still withheld
    expect(journal.episodes[0]!.key).toBe("MRVL#1"); // unanswered first
  });

  it("an update is a NEW row superseding the old one: the original text is untouched, only the latest is effective, coverage does not inflate", async () => {
    const start = await caller(investorId).startTellMeWhy({ transactionId: ids.mpBuy! });
    const updated = await caller(investorId).answer({
      sessionId: start.sessionId,
      transactionId: start.transactionId,
      questionText: start.questionText,
      answerText: "עדכון: בדיעבד הסיבה המרכזית הייתה הרוטציה ל-MRVL.",
      supersedesAnswerId: firstAnswerId,
    });
    await caller(investorId).complete({ sessionId: start.sessionId });
    expect(updated.id).not.toBe(firstAnswerId);
    expect(updated.supersedesAnswerId).toBe(firstAnswerId);

    const original = await db.query.interviewAnswers.findFirst({ where: (a, { eq }) => eq(a.id, firstAnswerId) });
    expect(original?.answerText).toContain("critical minerals"); // never edited
    const effective = await getAllAnswersForInvestor(db, investorId);
    expect(effective.map((a) => a.id)).toEqual([updated.id]);
    const journal = await caller(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 1, total: 2 });
    const mp = journal.episodes.find((e) => e.key === "MP#1")!;
    expect(mp.rationale.answers.map((a) => a.id)).toEqual([updated.id]);

    // a chain, never a fork
    const again = await caller(investorId).answer({ sessionId: start.sessionId, transactionId: start.transactionId, questionText: "q", answerText: "x", supersedesAnswerId: firstAnswerId }).catch((e) => e);
    expect((again as TRPCError).code).toBe("BAD_REQUEST");
  });

  it("concurrent updates of the SAME answer cannot fork the chain: exactly one succeeds, exactly one successor row exists", async () => {
    // A fresh, never-superseded answer on MRVL#1 (its own session, so the
    // MP chain above is untouched).
    const base = await caller(investorId).startTellMeWhy({ transactionId: ids.mrvlBuy! });
    const original = await caller(investorId).answer({ sessionId: base.sessionId, transactionId: base.transactionId, questionText: base.questionText, answerText: "first MRVL rationale" });

    // Six racing updates, each from its own started session, released together.
    const starts = await Promise.all(Array.from({ length: 6 }, () => caller(investorId).startTellMeWhy({ transactionId: ids.mrvlBuy! })));
    const results = await Promise.allSettled(
      starts.map((s, i) =>
        caller(investorId).answer({ sessionId: s.sessionId, transactionId: s.transactionId, questionText: s.questionText, answerText: `racing update ${i}`, supersedesAnswerId: original.id })
      )
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect((r.reason as TRPCError).code).toBe("BAD_REQUEST");

    const successors = await db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.supersedesAnswerId, original.id));
    expect(successors).toHaveLength(1);
    expect((await getAllAnswersForInvestor(db, investorId)).filter((a) => a.transactionId === ids.mrvlBuy).map((a) => a.id)).toEqual([successors[0]!.id]);
    // clean up the MRVL rationale so the later coverage/downstream tests keep their exact expectations
    await db.delete(schema.interviewAnswers).where(eq(schema.interviewAnswers.transactionId, ids.mrvlBuy!));
  });

  it("ownership boundaries: another investor cannot answer into, complete, read, or supersede this investor's data", async () => {
    const start = await caller(investorId).startTellMeWhy({ transactionId: ids.mpBuy! });
    const foreign = caller(foreignInvestorId);
    const a = await foreign.answer({ sessionId: start.sessionId, transactionId: start.transactionId, questionText: "q", answerText: "x" }).catch((e) => e);
    expect((a as TRPCError).code).toBe("NOT_FOUND");
    const c = await foreign.complete({ sessionId: start.sessionId }).catch((e) => e);
    expect((c as TRPCError).code).toBe("NOT_FOUND");
    const r = await foreign.answersForSession({ sessionId: start.sessionId }).catch((e) => e);
    expect((r as TRPCError).code).toBe("NOT_FOUND");
    const foreignStart = await foreign.startTellMeWhy({ transactionId: ids.foreignBuy! });
    const s = await foreign.answer({ sessionId: foreignStart.sessionId, transactionId: foreignStart.transactionId, questionText: "q", answerText: "x", supersedesAnswerId: firstAnswerId }).catch((e) => e);
    expect((s as TRPCError).code).toBe("NOT_FOUND");
    // ...and an answer can never be anchored to a transaction the investor does not own, or one that does not exist
    const mine = caller(investorId);
    const ownStart = await mine.startTellMeWhy({ transactionId: ids.mrvlBuy! });
    for (const transactionId of [ids.foreignBuy!, "00000000-0000-4000-8000-000000000000"]) {
      const bad = await mine.answer({ sessionId: ownStart.sessionId, transactionId, questionText: "q", answerText: "x" }).catch((e) => e);
      expect((bad as TRPCError).code).toBe("NOT_FOUND");
    }
    expect(await db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewSessionId, ownStart.sessionId))).toHaveLength(0);
    // ...and the journal itself is per-investor: neither side sees the other's episodes or coverage
    const foreignJournal = await foreign.journal();
    expect(foreignJournal.episodes.map((e) => e.key)).toEqual(["AAA#1"]);
    expect(foreignJournal.coverage).toEqual({ covered: 0, total: 1 });
    expect(await foreign.journalCoverage()).toEqual({ covered: 0, total: 1 });
    expect((await mine.journal()).episodes.some((e) => e.ticker === "AAA")).toBe(false);
  });

  it("downstream: the journal answer reaches the production reader, and the frozen resolver counts one episode as ONE case however many answers anchor to it", async () => {
    const effective = await getAllAnswersForInvestor(db, investorId);
    const mpAnswer = effective.find((a) => a.transactionId === ids.mpBuy)!;
    expect(mpAnswer).toMatchObject({ origin: "user_initiated" });

    // An older-style answer anchored to a different transaction of the SAME episode (the MP precedent).
    const session = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
    const sellAnswer = await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: ids.mpSell2!, questionText: "q", answerText: "second answer, same episode" });
    const mrvlStart = await caller(investorId).startTellMeWhy({ transactionId: ids.mrvlBuy! });
    const mrvlAnswer = await caller(investorId).answer({ sessionId: mrvlStart.sessionId, transactionId: mrvlStart.transactionId, questionText: mrvlStart.questionText, answerText: "MRVL: separate decision" });

    const resolver = await loadIndependenceResolver(db, investorId);
    const sameEpisode = resolver.resolve([
      { interviewAnswerId: mpAnswer.id, stance: "supporting" },
      { interviewAnswerId: sellAnswer.id, stance: "supporting" },
    ]);
    expect(sameEpisode.groups).toHaveLength(1);
    expect(sameEpisode.confidenceInputs).toEqual({ supporting: 1, contradicting: 0 });

    const twoEpisodes = resolver.resolve([
      { interviewAnswerId: mpAnswer.id, stance: "supporting" },
      { interviewAnswerId: mrvlAnswer.id, stance: "supporting" },
    ]);
    expect(twoEpisodes.groups).toHaveLength(2); // separate genuine episodes stay separate strong groups
    expect(twoEpisodes.supportingUpper).toBe(2);

    const journal = await caller(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 2, total: 2 }); // two answers on MP#1 are still one covered episode
    expect(journal.episodes.find((e) => e.key === "MP#1")!.rationale.answers).toHaveLength(2);
  });
});
