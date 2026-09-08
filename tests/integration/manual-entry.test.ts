// Regression coverage for Manual Historical Entry + "Tell me why"
// (docs/backlog.md). Exercises the exact real functions
// src/server/routers/import.ts's confirmManualEntry and
// src/server/routers/interview.ts's startTellMeWhy call — not
// re-implementations of them — against a real local Postgres, the same
// convention every other integration test in this repo follows (no
// tRPC caller anywhere in this codebase's tests; the router layer here
// is thin argument-plumbing + ownership checks, verified by manual
// code-review of the diff, same conclusion already reached for
// validateDecisionSynthesis's call site).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { insertTransactions, getTransaction } from "@/db/repositories/portfolio";
import {
  insertInterviewSession,
  insertInterviewAnswer,
  getAllAnswersForInvestor,
} from "@/db/repositories/interview";
import { buildManualTransactionValues } from "@/lib/import/manual-entry";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `manual-entry-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Manual Entry Test",
    })
    .returning();
  investorId = investor!.id;
});

afterAll(async () => {
  const sessions = await db.query.interviewSessions.findMany({
    where: (s, { eq }) => eq(s.investorId, investorId),
  });
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    await db.delete(schema.interviewAnswers).where(inArray(schema.interviewAnswers.interviewSessionId, sessionIds));
    await db.delete(schema.interviewSessions).where(inArray(schema.interviewSessions.id, sessionIds));
  }
  await db.delete(schema.transactions).where(eq(schema.transactions.investorId, investorId));
  await db.delete(schema.investors).where(eq(schema.investors.id, investorId));
  await client.end();
});

describe("Manual Historical Entry — MP acceptance case", () => {
  it("BUY + partial SELL + final SELL: all three rows persist as source=manual_entry, historical dates preserved, position closes to 0 via the real computePositions", async () => {
    const values = buildManualTransactionValues(investorId, [
      {
        ticker: "MP",
        transactionType: "buy",
        quantity: 20.6521,
        price: 48.42,
        transactionDate: new Date("2026-08-05T00:00:00.000Z"),
      },
      {
        ticker: "MP",
        transactionType: "sell",
        quantity: 12.1317,
        price: 57.62,
        transactionDate: new Date("2026-08-24T00:00:00.000Z"),
      },
      {
        ticker: "MP",
        transactionType: "sell",
        quantity: 8.5204,
        price: 59.4,
        transactionDate: new Date("2026-08-28T00:00:00.000Z"),
      },
    ]);

    // Same call shape the real mutation uses (db.transaction wrapping
    // insertTransactions) — src/server/routers/import.ts confirmManualEntry.
    const inserted = await db.transaction(async (tx) => insertTransactions(tx, values));

    expect(inserted).toHaveLength(3);
    for (const row of inserted) {
      expect(row.source).toBe("manual_entry");
      expect(row.importBatchId).toBeNull();
    }

    const dates = inserted.map((r) => r.transactionDate.toISOString().slice(0, 10)).sort();
    expect(dates).toEqual(["2026-08-05", "2026-08-24", "2026-08-28"]);

    // The real computePositions, unmodified — via the same
    // computePositionsForInvestor wrapper the app itself uses.
    const state = await computePositionsForInvestor(db, investorId);
    const mpPosition = state.positions.find((p) => p.ticker === "MP");
    expect(mpPosition).toBeUndefined(); // fully exited, not a current holding

    const mpSells = state.sellTrace.filter((s) => s.ticker === "MP");
    expect(mpSells).toHaveLength(2);
    for (const sell of mpSells) {
      expect(sell.sufficientHoldings).toBe(true);
      expect(sell.realizedPnlPercent).toBeGreaterThan(0); // both were real gains
    }
  });
});

describe("Manual Historical Entry — atomicity", () => {
  it("a batch with one invalid row (bad investor FK) leaves zero rows from the whole batch", async () => {
    const nonExistentInvestorId = "00000000-0000-0000-0000-000000000000";
    const values = buildManualTransactionValues(investorId, [
      { ticker: "ATOMTEST", transactionType: "buy", quantity: 1, price: 10, transactionDate: new Date("2026-01-01") },
      { ticker: "ATOMTEST", transactionType: "sell", quantity: 1, price: 12, transactionDate: new Date("2026-01-03") },
    ]);
    // Deliberately break the FK on the middle-of-batch semantics by
    // substituting a non-existent investorId on one row, mixed with
    // otherwise-valid rows, all in the ONE insertTransactions call the
    // real mutation makes (single multi-row INSERT — this is exactly
    // what confirmManualEntry does).
    values[0]!.investorId = nonExistentInvestorId;

    await expect(db.transaction(async (tx) => insertTransactions(tx, values))).rejects.toThrow();

    const rows = await db.query.transactions.findMany({
      where: (t, { eq }) => eq(t.ticker, "ATOMTEST"),
    });
    expect(rows).toHaveLength(0);
  });
});

// Proves the answer reaches getAllAnswersForInvestor correctly — the
// exact reader function dna.generate (src/server/routers/dna.ts) and
// strategy.ts's observed-principles mutation both call to build their
// Evidence input. Does NOT run dna.generate itself (that needs a real
// Anthropic call) — this is "provenance + the DNA/Strategy reader
// function," not "the DNA pipeline end-to-end" (docs/backlog.md).
describe("\"Tell me why\" — provenance and the DNA/Strategy reader function", () => {
  it("a user-initiated answer is saved with its anchor transaction, carries origin=user_initiated, and comes back correctly through getAllAnswersForInvestor", async () => {
    const [txn] = await insertTransactions(db, [
      {
        investorId,
        ticker: "MP",
        transactionType: "buy",
        quantity: "20.6521",
        price: "48.42",
        amount: "-999.97",
        transactionDate: new Date("2026-08-05T00:00:00.000Z"),
        source: "manual_entry",
        importBatchId: null,
        notes: null,
      },
    ]);

    // Mirrors src/server/routers/interview.ts's startTellMeWhy exactly —
    // real insertInterviewSession + real buildTellMeWhyQuestion, not a
    // re-implementation.
    const session = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
    const questionText = buildTellMeWhyQuestion(txn!.ticker!);
    const fullStory =
      "נחשפתי לנושא metals/critical minerals, נכנסתי ל-MP, מימשתי חלק ברווח ב-24/8, " +
      "סגרתי את היתרה ברווח ב-28/8, ושחררתי את ההון להזדמנויות אחרות.";

    await insertInterviewAnswer(db, {
      interviewSessionId: session.id,
      transactionId: txn!.id,
      questionText,
      answerText: fullStory,
    });

    // A guided-interview-origin session too, to prove both origins are
    // distinguishable in the same result set, not just that
    // user_initiated exists in isolation.
    const guidedSession = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
    await insertInterviewAnswer(db, {
      interviewSessionId: guidedSession.id,
      transactionId: txn!.id,
      questionText: "What made you buy MP?",
      answerText: "Some guided-interview answer.",
    });

    // getAllAnswersForInvestor is the exact reader function dna.generate
    // and strategy.ts's observed-principles mutation call — calling it
    // directly here (not dna.generate itself, which would need a real
    // Anthropic call) proves this answer reaches it correctly.
    const allAnswers = await getAllAnswersForInvestor(db, investorId);
    const tellMeWhyAnswer = allAnswers.find((a) => a.answerText === fullStory);
    const guidedAnswer = allAnswers.find((a) => a.answerText === "Some guided-interview answer.");

    expect(tellMeWhyAnswer).toBeDefined();
    expect(tellMeWhyAnswer!.transactionId).toBe(txn!.id);
    expect(tellMeWhyAnswer!.origin).toBe("user_initiated");

    expect(guidedAnswer).toBeDefined();
    expect(guidedAnswer!.origin).toBe("guided_interview");

    // The whole free-text lifecycle story is present, unconstrained —
    // no validation anywhere truncates it or checks it only discusses
    // the one anchor transaction (docs/backlog.md investigation). The
    // story covers entry, the catalyst, both the partial and final
    // exit, and capital rotation — all in this one answer, linked to
    // only the one BUY anchor transaction.
    expect(tellMeWhyAnswer!.answerText).toContain("critical minerals");
    expect(tellMeWhyAnswer!.answerText).toContain("מימשתי חלק"); // partial profit-taking
    expect(tellMeWhyAnswer!.answerText).toContain("סגרתי את היתרה"); // closed the remainder
    expect(tellMeWhyAnswer!.answerText).toContain("שחררתי את ההון"); // freed the capital (rotation)
  });
});

describe("getTransaction", () => {
  it("returns the transaction with its real source and investor", async () => {
    const [txn] = await insertTransactions(db, [
      {
        investorId,
        ticker: "GETX",
        transactionType: "buy",
        quantity: "1",
        price: "1",
        amount: "-1",
        transactionDate: new Date("2026-01-01"),
        source: "manual_entry",
        importBatchId: null,
        notes: null,
      },
    ]);

    const fetched = await getTransaction(db, txn!.id);
    expect(fetched?.investorId).toBe(investorId);
    expect(fetched?.source).toBe("manual_entry");
  });
});
