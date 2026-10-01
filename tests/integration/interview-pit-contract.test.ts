// Unit 7C-B — the Guided Interview point-in-time contract through the REAL
// interview, DNA and Strategy routers, repositories and Postgres (authorized
// test database only). Every AI boundary is mocked; no real AI call.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ai = vi.hoisted(() => ({
  generate: vi.fn(),
  dnaInputs: [] as unknown[],
  strategyInputs: [] as unknown[],
  declaredInputs: [] as unknown[],
}));
vi.mock("@/lib/ai/interview", () => ({ generatePitQuestion: ai.generate, PIT_QUESTION_MODEL: "claude-test", PIT_QUESTION_CONTRACT: "interview_question_pit_v1" }));
vi.mock("@/lib/ai/dna", () => ({ proposeDnaHypotheses: (s: unknown) => (ai.dnaInputs.push(structuredClone(s)), []) }));
vi.mock("@/lib/ai/strategy", () => ({
  proposeObservedPrinciples: (s: unknown) => (ai.strategyInputs.push(structuredClone(s)), []),
  extractDeclaredPrinciples: (a: unknown) => (ai.declaredInputs.push(structuredClone(a)), []),
}));

import { interviewRouter } from "@/server/routers/interview";
import { dnaRouter } from "@/server/routers/dna";
import { strategyRouter } from "@/server/routers/strategy";
import { insertInterviewAnswer, insertInterviewSession } from "@/db/repositories/interview";
import { anchorContextHash, buildAnchorContext, exposedFacts } from "@/lib/interview/anchor-context";
import { fallbackQuestion } from "@/lib/interview/question-safety";
import { loadAnchorHistory } from "@/lib/interview/load-anchor-history";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";
import { loadPriorRecordBrief } from "@/lib/prior-record/load-prior-record";
import { formatPriorRecordContext, projectPriorRecordForAi } from "@/lib/prior-record/ai-context";
import { LEGACY_QUESTION_WITHHELD } from "@/lib/ai/investor-statements";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });
const interview = (investorId: string) => interviewRouter.createCaller({ session: { investorId } } as never);
const ctx = (investorId: string) => ({ session: { investorId } }) as never;

async function trade(investorId: string, type: "buy" | "sell", date: string, qty: string, price: string, ticker = "QRST") {
  const [row] = await db
    .insert(schema.transactions)
    .values({ investorId, ticker, transactionType: type, quantity: qty, price, amount: String((type === "buy" ? -1 : 1) * Number(qty) * Number(price)), transactionDate: new Date(`${date}T00:00:00Z`), source: "csv_import" })
    .returning();
  return row!.id;
}
const sessionsOf = async (investorId: string) => (await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.investorId, investorId))).length;
const answersIn = async (sessionId: string) => db.select().from(schema.interviewAnswers).where(eq(schema.interviewAnswers.interviewSessionId, sessionId));
const SAFE_AI = "מה הוביל אותך לפעולה הזו באותו רגע?";
async function serverContext(investorId: string, transactionId: string) {
  const r = buildAnchorContext(await loadAnchorHistory(db, investorId), transactionId);
  if (!r.ok) throw new Error(r.reason);
  return r.context;
}
const LEAKY_AI = "מה גרם לך למכור אחרי הרווח הגדול?";

afterAll(async () => {
  await client.end();
});

beforeEach(() => {
  ai.generate.mockReset();
  ai.dnaInputs.length = 0;
  ai.strategyInputs.length = 0;
  ai.declaredInputs.length = 0;
});

describe("migration 0019 backfill — run in a transaction that is rolled back", () => {
  it("backfills provenance from the session origin, never touches question or answer text, then enforces NOT NULL and the CHECK", async () => {
    const statements = readFileSync("src/db/migrations/0019_interview_question_provenance.sql", "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.replace(/^--.*$/gm, "").trim())
      .filter(Boolean);
    const backfill = statements.filter((s) => /^UPDATE|SET NOT NULL|ADD CONSTRAINT/.test(s) || s.includes("SET NOT NULL"));
    expect(backfill).toHaveLength(3);
    const investorId = await mkInvestor(db, "pit-migration");

    const rolledBack = Symbol("rollback");
    const outcome = await client
      .begin(async (tx) => {
        await tx.unsafe(`ALTER TABLE "interview_answers" DROP CONSTRAINT "interview_answers_anchor_context_iff_pit"`);
        await tx.unsafe(`ALTER TABLE "interview_answers" ALTER COLUMN "question_provenance" DROP NOT NULL`);
        const [guided] = await tx`insert into interview_sessions (investor_id, origin) values (${investorId}, 'guided_interview') returning id`;
        const [tmw] = await tx`insert into interview_sessions (investor_id, origin) values (${investorId}, 'user_initiated') returning id`;
        await tx`insert into interview_answers (interview_session_id, question_text, answer_text) values (${guided!.id}, 'what made you sell after that 42% run?', 'g1'), (${guided!.id}, 'q2', 'g2'), (${tmw!.id}, 'ספר לי', 't1')`;
        const before = await tx`select count(*)::int as n from interview_answers`;
        for (const s of backfill) await tx.unsafe(s);
        const rows = await tx`select a.question_text, a.answer_text, a.question_provenance, a.anchor_context from interview_answers a join interview_sessions s on s.id = a.interview_session_id where s.investor_id = ${investorId} order by a.answer_text`;
        const after = await tx`select count(*)::int as n, count(*) filter (where question_provenance is null)::int as nulls from interview_answers`;
        const nullable = await tx`select is_nullable from information_schema.columns where table_name = 'interview_answers' and column_name = 'question_provenance'`;
        expect(rows).toEqual([
          { question_text: "what made you sell after that 42% run?", answer_text: "g1", question_provenance: "guided_legacy", anchor_context: null },
          { question_text: "q2", answer_text: "g2", question_provenance: "guided_legacy", anchor_context: null },
          { question_text: "ספר לי", answer_text: "t1", question_provenance: "tell_me_why_legacy", anchor_context: null },
        ]);
        expect(after[0]).toEqual({ n: before[0]!.n, nulls: 0 });
        expect(nullable[0]!.is_nullable).toBe("NO");
        throw rolledBack;
      })
      .catch((e) => e);
    expect(outcome).toBe(rolledBack);
  });
});

describe("the anchor_context / provenance CHECK", () => {
  it("a PIT row needs a snapshot and a legacy row may not have one", async () => {
    const investorId = await mkInvestor(db, "pit-check");
    const session = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
    const base = { interviewSessionId: session.id, questionText: "q", answerText: "a" };
    await expect(insertInterviewAnswer(db, { ...base, questionProvenance: "guided_pit_ai", anchorContext: null })).rejects.toThrow();
    await expect(insertInterviewAnswer(db, { ...base, questionProvenance: "guided_legacy", anchorContext: { version: 1 } })).rejects.toThrow();
    await expect(insertInterviewAnswer(db, { ...base, questionProvenance: "guided_legacy" })).resolves.toBeTruthy();
  });
});

describe("interview.start and interview.answer", () => {
  let investorId: string;
  let ids: { b1: string; s1: string; s2: string };

  beforeAll(async () => {
    investorId = await mkInvestor(db, "pit-router");
    ids = {
      b1: await trade(investorId, "buy", "2026-06-11", "200", "8.05"),
      s1: await trade(investorId, "sell", "2026-08-14", "120", "11.40"),
      s2: await trade(investorId, "sell", "2026-09-02", "80", "13.75"),
    };
  });

  it("start: structural anchors in chronological order; the model gets only facts lines; rejected wording falls back; the session is created after generation", async () => {
    ai.generate.mockImplementation(async (line: string) => (line.includes("מתוך") ? LEAKY_AI : SAFE_AI));
    const before = await sessionsOf(investorId);
    const r = await interview(investorId).start();
    expect(await sessionsOf(investorId)).toBe(before + 1);
    expect(r.questions.map((q) => q.anchor.transactionId)).toEqual([ids.b1, ids.s1, ids.s2]);
    expect(r.questions.map((q) => q.anchor.role)).toEqual(["initial_buy", "partial_sell", "full_sell"]);
    for (const call of ai.generate.mock.calls) {
      expect(call).toHaveLength(1);
      expect(String(call[0])).not.toMatch(/11\.4|13\.75|%/);
    }
    const partial = r.questions[1]!;
    expect(partial).toMatchObject({ questionSource: "deterministic", anchor: { price: null } });
    expect(partial.questionText).not.toBe(LEAKY_AI);
    expect(r.questions[0]).toMatchObject({ questionSource: "ai", questionText: SAFE_AI });
    for (const q of r.questions) expect(q.anchorContextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r.questions[0]!).sort()).toEqual(["anchor", "anchorContextHash", "factsLine", "questionSource", "questionText"]);
  });

  it("start: a failed AI call leaves no session behind", async () => {
    ai.generate.mockImplementation(async () => {
      throw new Error("network");
    });
    const before = await sessionsOf(investorId);
    await expect(interview(investorId).start()).rejects.toThrow();
    expect(await sessionsOf(investorId)).toBe(before);
  });

  it("answer: stores the server's snapshot with the derived provenance, never a client snapshot", async () => {
    ai.generate.mockImplementation(async () => SAFE_AI);
    const r = await interview(investorId).start();
    const ai1 = r.questions.find((q) => q.anchor.transactionId === ids.b1);
    const full = r.questions.find((q) => q.anchor.transactionId === ids.s2);
    const forged = { version: 1, factsLine: "forged 42%", anchor: { ticker: "QRST", date: "2026-06-11" } };
    const saved = await interview(investorId).answer({ sessionId: r.sessionId, transactionId: ai1!.anchor.transactionId, questionText: ai1!.questionText, answerText: "  my words  ", anchorContextHash: ai1!.anchorContextHash, anchorContext: forged } as never);
    expect(saved).toMatchObject({ questionProvenance: "guided_pit_ai", questionText: SAFE_AI, answerText: "  my words  " });
    expect(saved.anchorContext).toEqual({ ...(await serverContext(investorId, ids.b1)), generator: { contract: "interview_question_pit_v1", model: "claude-test", validated: true } });
    expect(JSON.stringify(saved.anchorContext)).not.toContain("forged");

    const fallback = fallbackQuestion(exposedFacts(await serverContext(investorId, ids.s2)));
    const fb = await interview(investorId).answer({ sessionId: r.sessionId, transactionId: full!.anchor.transactionId, questionText: fallback, answerText: "x", anchorContextHash: full!.anchorContextHash });
    expect(fb.questionProvenance).toBe("guided_pit_fallback");
    expect((fb.anchorContext as { generator: unknown }).generator).toBeNull();
    expect((fb.anchorContext as { anchor: { price: unknown } }).anchor.price).toBeNull();
  });

  it("answer refuses a wrong or missing hash, an unsafe question, and a history change after start — and writes nothing", async () => {
    ai.generate.mockImplementation(async () => SAFE_AI);
    const r = await interview(investorId).start();
    const q = r.questions.find((x) => x.anchor.transactionId === ids.s1)!;
    const attempt = (over: Record<string, unknown>) =>
      interview(investorId)
        .answer({ sessionId: r.sessionId, transactionId: q.anchor.transactionId, questionText: q.questionText, answerText: "x", anchorContextHash: q.anchorContextHash, ...over } as never)
        .catch((e: TRPCError) => e.code);
    expect(await attempt({ anchorContextHash: "0".repeat(64) })).toBe("BAD_REQUEST");
    expect(await attempt({ anchorContextHash: undefined })).toBe("BAD_REQUEST");
    expect(await attempt({ questionText: LEAKY_AI })).toBe("BAD_REQUEST");
    // the history before the anchor changes after start: an add-on buy before the sale
    const late = await trade(investorId, "buy", "2026-07-01", "10", "7");
    expect(await attempt({})).toBe("BAD_REQUEST");
    expect(await answersIn(r.sessionId)).toHaveLength(0);
    await db.delete(schema.transactions).where(eq(schema.transactions.id, late)); // a synthetic row created by this test, never answered
    expect(anchorContextHash(await serverContext(investorId, ids.s1))).toBe(q.anchorContextHash);
  });
});

describe("Tell me why under the contract", () => {
  const ENTRY_ONLY_FORBIDDEN = /לצאת|יצאת|יציאה|לממש|מימוש|מכרת|מכירה|למכור|מנהל|התנהלת|ניהול|החזקה|מאז|אחר כך|בהמשך|שינית/;
  const tmw = (investorId: string) => interview(investorId);
  const save = (investorId: string, start: { sessionId: string; transactionId: string; questionText: string; anchorContextHash: string }, over: Record<string, unknown> = {}) =>
    tmw(investorId).answer({ sessionId: start.sessionId, transactionId: start.transactionId, questionText: start.questionText, answerText: "why I entered", anchorContextHash: start.anchorContextHash, ...over } as never);
  const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: TRPCError) => e.code);

  it("entry rationale only: a CLOSED episode is asked about the entry, never about managing, selling or exiting; facts and hash come separately", async () => {
    const investorId = await mkInvestor(db, "pit-tmw");
    const buy = await trade(investorId, "buy", "2026-05-05", "40", "20");
    await trade(investorId, "sell", "2026-06-05", "40", "25");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: buy });
    expect(start.episodeStatus).toBe("closed");
    expect(start.questionText).toBe(buildTellMeWhyQuestion("QRST"));
    expect(start.questionText).not.toMatch(ENTRY_ONLY_FORBIDDEN);
    expect(start.factsLine).toContain("05/05/2026");
    expect(start.factsLine).not.toMatch(/25|%/);
    expect(start.anchorContextHash).toBe(anchorContextHash(await serverContext(investorId, buy)));
    const saved = await save(investorId, start);
    expect(saved.questionProvenance).toBe("tell_me_why_pit");
    expect(saved.questionText).toBe(start.questionText);
    expect(saved.anchorContext).toMatchObject({ version: 1, anchor: { role: "initial_buy", transactionId: buy }, factsLine: start.factsLine, generator: null });
  });

  it("A. unchanged exposed entry context: the start hash matches at answer time and the write is allowed", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-a");
    const buy = await trade(investorId, "buy", "2026-05-05", "40", "20");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: buy });
    expect(await codeOf(save(investorId, start))).toBe("ok");
  });

  it("B. earlier history that changes the exposed entry facts: hash mismatch, nothing inserted", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-b");
    await trade(investorId, "buy", "2026-03-01", "10", "15");
    const addOn = await trade(investorId, "buy", "2026-05-05", "40", "20");
    // the episode's entry is the March buy; answer about the add-on is not Tell me why, so anchor the entry
    const entry = (await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, investorId))).find((t) => t.id !== addOn)!.id;
    const start = await tmw(investorId).startTellMeWhy({ transactionId: entry });
    // an earlier trade appears in the history before the entry: the facts the investor saw are no longer true
    await trade(investorId, "buy", "2026-02-01", "5", "14");
    expect(await codeOf(save(investorId, start))).toBe("BAD_REQUEST");
    expect(await answersIn(start.sessionId)).toHaveLength(0);
  });

  it("C. a transaction after the entry does not change the frozen entry context: the hash stays valid", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-c");
    const buy = await trade(investorId, "buy", "2026-05-05", "40", "20");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: buy });
    await trade(investorId, "sell", "2026-06-05", "10", "25");
    expect(await codeOf(save(investorId, start))).toBe("ok");
  });

  it("D. audit-only change outside the exposed context: no false mismatch", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-d");
    await trade(investorId, "buy", "2026-03-01", "10", "15");
    const sell = await trade(investorId, "sell", "2026-04-01", "10", "18");
    const reentry = await trade(investorId, "buy", "2026-05-05", "40", "20");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: reentry });
    // the earlier, closed episode's sale date moves: it is not part of the new entry's exposed facts
    await db.update(schema.transactions).set({ transactionDate: new Date("2026-04-02T00:00:00Z") }).where(eq(schema.transactions.id, sell));
    expect(await codeOf(save(investorId, start))).toBe("ok");
  });

  it("E. a forged client anchor_context is ignored: the stored snapshot is the server's", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-e");
    const buy = await trade(investorId, "buy", "2026-05-05", "40", "20");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: buy });
    const saved = await save(investorId, start, { anchorContext: { version: 1, factsLine: "forged 42%", anchor: { ticker: "QRST", date: "2026-05-05" } } });
    expect(saved.anchorContext).toEqual(await serverContext(investorId, buy));
    expect(JSON.stringify(saved.anchorContext)).not.toContain("forged");
  });

  it("F. an altered deterministic question is refused independently of a valid hash, and a missing hash is refused", async () => {
    const investorId = await mkInvestor(db, "pit-tmw-f");
    const buy = await trade(investorId, "buy", "2026-05-05", "40", "20");
    const start = await tmw(investorId).startTellMeWhy({ transactionId: buy });
    expect(await codeOf(save(investorId, start, { questionText: `${start.questionText} 42%` }))).toBe("BAD_REQUEST");
    expect(await codeOf(save(investorId, start, { anchorContextHash: undefined }))).toBe("BAD_REQUEST");
    expect(await answersIn(start.sessionId)).toHaveLength(0);
  });
});

describe("Journal entry coverage", () => {
  it("a guided answer on a sell does not cover the entry; the entry answer does; action answers stay apart", async () => {
    const investorId = await mkInvestor(db, "pit-coverage");
    const buy = await trade(investorId, "buy", "2026-03-03", "10", "10");
    const sell = await trade(investorId, "sell", "2026-04-04", "4", "12");
    ai.generate.mockImplementation(async () => SAFE_AI);
    const r = await interview(investorId).start();
    const q = r.questions.find((x) => x.anchor.transactionId === sell)!;
    await interview(investorId).answer({ sessionId: r.sessionId, transactionId: sell, questionText: q.questionText, answerText: "sold part", anchorContextHash: q.anchorContextHash });
    let journal = await interview(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 0, total: 1 });
    // the action answer is visible before any entry rationale, yet never covers the entry
    expect(journal.episodes[0]).toMatchObject({ rationale: { status: "unanswered", answers: [] }, later: null });
    expect(journal.episodes[0]!.actionAnswers).toHaveLength(1);
    expect(journal.episodes[0]!.actionAnswers[0]).toMatchObject({ action: { transactionId: sell, ticker: "QRST", side: "sell", role: "partial_sell" }, answerText: "sold part", questionProvenance: "guided_pit_ai", questionText: q.questionText, factsLine: q.factsLine });

    const tmw = await interview(investorId).startTellMeWhy({ transactionId: buy });
    await interview(investorId).answer({ sessionId: tmw.sessionId, transactionId: buy, questionText: tmw.questionText, answerText: "entered because", anchorContextHash: tmw.anchorContextHash });
    journal = await interview(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 1, total: 1 });
    expect(journal.episodes[0]!.rationale.answers.map((a) => a.answerText)).toEqual(["entered because"]);
    expect(journal.episodes[0]!.actionAnswers.map((a) => a.answerText)).toEqual(["sold part"]);
  });

  it("a legacy action answer is returned with its provenance and stored wording, and no fabricated facts line or role", async () => {
    const investorId = await mkInvestor(db, "pit-legacy-action");
    await trade(investorId, "buy", "2026-03-03", "10", "10");
    const sell = await trade(investorId, "sell", "2026-04-04", "10", "12");
    const session = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
    await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: sell, questionText: "Sample legacy: after that 20% gain?", answerText: "legacy answer", questionProvenance: "guided_legacy" });
    const journal = await interview(investorId).journal();
    expect(journal.coverage).toEqual({ covered: 0, total: 1 });
    expect(journal.episodes[0]!.actionAnswers).toEqual([
      expect.objectContaining({ action: expect.objectContaining({ transactionId: sell, ticker: "QRST", side: "sell", role: null }), answerText: "legacy answer", questionProvenance: "guided_legacy", factsLine: null }),
    ]);
    expect(Object.keys(journal.episodes[0]!.actionAnswers[0]!).sort()).toEqual(["action", "answerId", "answerText", "answeredAt", "factsLine", "questionProvenance", "questionText"]);
    // the AI policy is unchanged: the legacy wording still never reaches the DNA proposer
    await dnaRouter.createCaller(ctx(investorId)).generate();
    expect(JSON.stringify(ai.dnaInputs)).not.toContain("20% gain");
    expect(JSON.stringify(ai.dnaInputs)).toContain("legacy answer");
  });

  it("start skips every already-answered action, whatever its role, by exact transaction", async () => {
    const investorId = await mkInvestor(db, "pit-skip-answered");
    const b1 = await trade(investorId, "buy", "2026-01-05", "10", "10");
    const b2 = await trade(investorId, "buy", "2026-02-05", "10", "11");
    const s1 = await trade(investorId, "sell", "2026-03-05", "5", "12");
    const s2 = await trade(investorId, "sell", "2026-04-05", "15", "13");
    ai.generate.mockImplementation(async () => SAFE_AI);
    const first = await interview(investorId).start();
    expect(first.questions.map((q) => q.anchor.transactionId).sort()).toEqual([b1, b2, s1, s2].sort());
    for (const q of first.questions) {
      await interview(investorId).answer({ sessionId: first.sessionId, transactionId: q.anchor.transactionId, questionText: q.questionText, answerText: "x", anchorContextHash: q.anchorContextHash });
    }
    await expect(interview(investorId).start()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("legacy guided questions never reach an AI consumer", () => {
  const LEAK = "what made you sell QRST after that 42% run in 70 days?";
  const ANSWER = "I sold because the thesis about margins had played out";
  let investorId: string;

  beforeAll(async () => {
    investorId = await mkInvestor(db, "pit-legacy");
    await trade(investorId, "buy", "2026-02-02", "10", "10");
    const sell = await trade(investorId, "sell", "2026-04-24", "10", "14.2");
    const session = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
    await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: sell, questionText: LEAK, answerText: ANSWER, questionProvenance: "guided_legacy" });
  });

  const leaked = (v: unknown) => JSON.stringify(v).includes("42%") || JSON.stringify(v).includes(LEAK);

  it("DNA proposer: the answer is there verbatim, the legacy wording is not", async () => {
    await dnaRouter.createCaller(ctx(investorId)).generate();
    expect(leaked(ai.dnaInputs)).toBe(false);
    expect(JSON.stringify(ai.dnaInputs)).toContain(ANSWER);
    expect(JSON.stringify(ai.dnaInputs)).toContain(LEGACY_QUESTION_WITHHELD);
  });

  it("Strategy observed and declared proposers: same", async () => {
    await strategyRouter.createCaller(ctx(investorId)).generateObserved();
    await strategyRouter.createCaller(ctx(investorId)).proposeDeclared();
    expect(leaked(ai.strategyInputs)).toBe(false);
    expect(leaked(ai.declaredInputs)).toBe(false);
    expect(JSON.stringify(ai.declaredInputs)).toContain(ANSWER);
  });

  it("Prior Record: the brief and its AI text withhold the legacy question and label the answer as the investor's", async () => {
    const brief = await loadPriorRecordBrief(db, { investorId, ticker: "QRST" });
    expect(brief.version).toBe(2);
    expect(leaked(brief)).toBe(false);
    const text = formatPriorRecordContext(projectPriorRecordForAi(brief));
    expect(text).not.toContain("42%");
    expect(text).toContain(`INVESTOR-AUTHORED HISTORICAL TEXT (verbatim) — answer recorded`);
    expect(text).toContain(ANSWER);
    expect(text).toContain("QUESTION CONTEXT (system-written, not the investor's words)");
    for (const line of text.split("\n").filter((l) => l.includes("INVESTOR-AUTHORED") && l.includes("answer recorded"))) expect(line).not.toContain(LEGACY_QUESTION_WITHHELD);
  });

  it("the stored legacy row itself is untouched", async () => {
    const [row] = await db.execute<{ question_text: string; answer_text: string; question_provenance: string }>(sql`select a.question_text, a.answer_text, a.question_provenance from interview_answers a join interview_sessions s on s.id = a.interview_session_id where s.investor_id = ${investorId}`);
    expect(row).toEqual({ question_text: LEAK, answer_text: ANSWER, question_provenance: "guided_legacy" });
  });
});
