// Decision Independence V1 — the authoritative LinkFact repository against
// real Postgres: insert-only history, cross-row invariants, supersession /
// effective head, and the DB-level backstops behind them.
//
// Migration rule (same as the other migration-dependent suites): these need
// migration 0011 (transaction_link_facts). On a database that hasn't had it
// applied they SKIP with an explicit reason instead of failing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import { LinkFactValidationError, insertTransactionLinkFact, loadEffectiveLinkFacts } from "@/db/repositories/link-facts";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });

let migrationApplied = false;
const SKIP_REASON = "migration 0011 (transaction_link_facts) not applied to this database yet";

let investorId: string;
let otherInvestorId: string;
const t: Record<string, string> = {};

async function insertTxn(owner: string, ticker: string, type: "buy" | "sell" | "dividend", date: string) {
  const [row] = await db
    .insert(schema.transactions)
    .values({
      investorId: owner,
      ticker,
      transactionType: type,
      quantity: type === "dividend" ? null : "1",
      price: type === "dividend" ? null : "10",
      amount: type === "buy" ? "-10" : "10",
      transactionDate: new Date(date),
      source: "manual_entry",
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  const probe = await client`select to_regclass('public.transaction_link_facts') as t`;
  migrationApplied = probe[0]?.t !== null;
  if (!migrationApplied) return;

  const mk = async (label: string) =>
    (await db.insert(schema.investors).values({ email: `link-facts-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: "x", displayName: label }).returning())[0]!.id;
  investorId = await mk("main");
  otherInvestorId = await mk("other");

  t.sellMp = await insertTxn(investorId, "MP", "sell", "2026-08-28");
  t.buyMrvl = await insertTxn(investorId, "MRVL", "buy", "2026-08-28");
  t.sellZs = await insertTxn(investorId, "ZS", "sell", "2026-06-26");
  t.buySpcx = await insertTxn(investorId, "SPCX", "buy", "2026-06-26");
  t.buyMp = await insertTxn(investorId, "MP", "buy", "2026-08-05");
  t.dividend = await insertTxn(investorId, "MP", "dividend", "2026-08-30");
  t.foreignBuy = await insertTxn(otherInvestorId, "MRVL", "buy", "2026-08-28");
});

afterAll(async () => {
  await client.end();
});

const rowCounts = async () => ({
  facts: (await client`select count(*)::int c from transaction_link_facts where investor_id = ${investorId}`)[0]!.c as number,
  members: (await client`select count(*)::int c from transaction_link_fact_members m join transaction_link_facts f on f.id = m.fact_id where f.investor_id = ${investorId}`)[0]!.c as number,
});
const rejects = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LinkFactValidationError);
  return (err as LinkFactValidationError).problems.join(" ");
};

describe("insertTransactionLinkFact — invariants", () => {
  it("14. inserts a linked fact with its members and loads it as an EFFECTIVE fact", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const fact = await insertTransactionLinkFact(db, {
      investorId,
      verdict: "linked",
      transactionIds: [t.sellMp!, t.buyMrvl!],
      shownBasisJson: { note: "audit only" },
      note: "MP sold to fund MRVL",
    });
    expect(fact.verdict).toBe("linked");
    expect(fact.supersedesFactId).toBeNull();

    const effective = await loadEffectiveLinkFacts(db, investorId);
    const mine = effective.find((f) => f.id === fact.id);
    expect(mine).toEqual({ id: fact.id, verdict: "linked", transactionIds: [t.sellMp, t.buyMrvl].sort() });
  });

  it("rejects every malformed fact and writes NOTHING", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const before = await rowCounts();

    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!] }))).toMatch(/at least 2/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!, t.sellZs!] }))).toMatch(/Duplicate/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!, crypto.randomUUID()] }))).toMatch(/Unknown/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!, t.foreignBuy!] }))).toMatch(/belong to the investor/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!, t.dividend!] }))).toMatch(/buy or sell trade/);
    // a linked fact needs a sell, a buy and two tickers
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "linked", transactionIds: [t.buyMp!, t.buySpcx!] }))).toMatch(/at least one sell/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "linked", transactionIds: [t.sellZs!, t.sellMp!] }))).toMatch(/at least one buy/);
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "linked", transactionIds: [t.sellMp!, t.buyMp!] }))).toMatch(/2 distinct tickers/);

    expect(await rowCounts()).toEqual(before);
  });

  it("an independent fact may cover any two trades", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const fact = await insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.buyMp!, t.buySpcx!] });
    expect((await loadEffectiveLinkFacts(db, investorId)).some((f) => f.id === fact.id && f.verdict === "independent")).toBe(true);
  });

  it("effective facts are scoped to their investor", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    expect(await loadEffectiveLinkFacts(db, otherInvestorId)).toEqual([]);
  });
});

describe("supersession and the effective head", () => {
  it("15. an opposite-verdict fact over a covered pair is rejected — unless it supersedes; then ONLY the chain head is effective and history is untouched", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const linked = await insertTransactionLinkFact(db, { investorId, verdict: "linked", transactionIds: [t.sellZs!, t.buySpcx!] });

    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellZs!, t.buySpcx!] }))).toMatch(/Conflicts with effective fact/);

    const [linkedRowBefore] = await db.select().from(schema.transactionLinkFacts).where(eq(schema.transactionLinkFacts.id, linked.id));
    const independent = await insertTransactionLinkFact(db, {
      investorId,
      verdict: "independent",
      transactionIds: [t.sellZs!, t.buySpcx!],
      supersedesFactId: linked.id,
    });
    expect(independent.supersedesFactId).toBe(linked.id);

    const effectiveIds = (await loadEffectiveLinkFacts(db, investorId)).map((f) => f.id);
    expect(effectiveIds).toContain(independent.id);
    expect(effectiveIds).not.toContain(linked.id);

    // Insert-only: the superseded row and its members are exactly as they were.
    const [linkedRowAfter] = await db.select().from(schema.transactionLinkFacts).where(eq(schema.transactionLinkFacts.id, linked.id));
    expect(linkedRowAfter).toEqual(linkedRowBefore);
    const linkedMembers = await db.select().from(schema.transactionLinkFactMembers).where(eq(schema.transactionLinkFactMembers.factId, linked.id));
    expect(linkedMembers.map((m) => m.transactionId).sort()).toEqual([t.sellZs, t.buySpcx].sort());
  });

  it("each fact can be superseded exactly once (application check AND partial unique index)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const base = await insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellMp!, t.buyMp!] });
    await insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellMp!, t.buyMp!], supersedesFactId: base.id });

    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellMp!, t.buyMp!], supersedesFactId: base.id }))).toMatch(/already has a successor/);

    // Bypassing the repository: the DB itself refuses a second successor.
    const err = await db.insert(schema.transactionLinkFacts).values({ investorId, verdict: "independent", supersedesFactId: base.id }).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(err, "transaction_link_facts_supersedes_unique")).toBe(true);
  });

  it("supersedesFactId must be a fact of the same investor", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const foreign = await db.insert(schema.transactionLinkFacts).values({ investorId: otherInvestorId, verdict: "independent" }).returning();
    expect(await rejects(insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.sellMp!, t.buyMp!], supersedesFactId: foreign[0]!.id }))).toMatch(/not a fact of this investor/);
  });

  it("the same transaction cannot appear twice in one fact (unique index)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const [fact] = await db.insert(schema.transactionLinkFacts).values({ investorId, verdict: "independent" }).returning();
    await db.insert(schema.transactionLinkFactMembers).values({ factId: fact!.id, transactionId: t.sellMp! });
    const err = await db.insert(schema.transactionLinkFactMembers).values({ factId: fact!.id, transactionId: t.sellMp! }).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(err, "transaction_link_fact_members_fact_transaction_unique")).toBe(true);
  });
});

describe("concurrency", () => {
  it("two concurrent supersessions of the same fact: exactly one wins", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const base = await insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.buyMrvl!, t.buySpcx!] });
    const results = await Promise.allSettled([
      insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.buyMrvl!, t.buySpcx!], supersedesFactId: base.id, note: "A" }),
      insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [t.buyMrvl!, t.buySpcx!], supersedesFactId: base.id, note: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(LinkFactValidationError);
  });

  it("two concurrent OPPOSITE-verdict facts over one fresh pair: exactly one wins (the investor advisory lock serializes the conflict check)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const a = await insertTxn(investorId, "RACEA", "sell", "2026-07-01");
    const b = await insertTxn(investorId, "RACEB", "buy", "2026-07-01");
    const results = await Promise.allSettled([
      insertTransactionLinkFact(db, { investorId, verdict: "linked", transactionIds: [a, b] }),
      insertTransactionLinkFact(db, { investorId, verdict: "independent", transactionIds: [a, b] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const effective = (await loadEffectiveLinkFacts(db, investorId)).filter((f) => f.transactionIds.includes(a) && f.transactionIds.includes(b));
    expect(effective).toHaveLength(1);
  });
});

describe("the fact tables are never rewritten by any other code path", () => {
  it("member rows reference real transactions (FK) — a linked transaction cannot be deleted out from under a fact", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const err = await db.delete(schema.transactions).where(inArray(schema.transactions.id, [t.sellMp!])).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull(); // FK from transaction_link_fact_members and interview answers
  });
});
