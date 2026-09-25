import { and, asc, eq, sql } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { decisionExecutionFacts, decisions, transactions } from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import {
  classifyAssertion,
  selectEffectiveExecutionFacts,
  validateExecutionFactShape,
  type ExecutionFactRow,
  type ExecutionVerdict,
} from "@/lib/execution/execution-facts";

// Decision Follow-Through V1 — authoritative execution facts. INSERT-ONLY by
// construction: this module exports no update or delete; a change of mind is
// a new fact that supersedes the old one (one successor per fact — partial
// unique index; the effective fact of a pair is the chain head). Nothing in
// src/lib/ai may reach this module.

export class ExecutionFactValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`Invalid execution fact: ${problems.join(" ")}`);
    this.name = "ExecutionFactValidationError";
  }
}

export interface NewExecutionFactInput {
  investorId: string;
  decisionId: string;
  transactionId: string;
  verdict: ExecutionVerdict;
  /** IANA zone used for the "not before the decision day" rule (the investor's UI zone, validated by the caller). */
  timeZone: string;
  note?: string | null;
  /** Must be the EFFECTIVE fact of the same (decision, transaction) pair. */
  supersedesFactId?: string | null;
  /** Audit only — what the investor was shown. */
  shownBasisJson?: unknown;
}

/** The head of the chain a fact belongs to (the fact itself when nothing supersedes it). */
function chainHead(all: readonly ExecutionFactRow[], fact: ExecutionFactRow): ExecutionFactRow | null {
  let current = fact;
  for (let hops = 0; hops <= all.length; hops++) {
    const next = all.find((f) => f.supersedesFactId === current.id);
    if (!next) return current;
    current = next;
  }
  return null; // a cycle — impossible through this module and refused by the DB, never walked forever
}

async function loadFactRowsForDecision(db: DbOrTx, decisionId: string): Promise<ExecutionFactRow[]> {
  const rows = await db
    .select({
      id: decisionExecutionFacts.id,
      decisionId: decisionExecutionFacts.decisionId,
      transactionId: decisionExecutionFacts.transactionId,
      verdict: decisionExecutionFacts.verdict,
      note: decisionExecutionFacts.note,
      supersedesFactId: decisionExecutionFacts.supersedesFactId,
    })
    .from(decisionExecutionFacts)
    .where(eq(decisionExecutionFacts.decisionId, decisionId))
    .orderBy(asc(decisionExecutionFacts.createdAt), asc(decisionExecutionFacts.id));
  return rows;
}

/** EFFECTIVE (chain-head) facts of EVERY decision of one investor — the OD-2 case-resolution input (src/lib/evidence/decision-cases.ts). Read-only. */
export async function loadEffectiveExecutionFactsForInvestor(
  db: DbOrTx,
  investorId: string
): Promise<{ id: string; decisionId: string; transactionId: string; verdict: ExecutionVerdict }[]> {
  const rows = await db
    .select({
      id: decisionExecutionFacts.id,
      decisionId: decisionExecutionFacts.decisionId,
      transactionId: decisionExecutionFacts.transactionId,
      verdict: decisionExecutionFacts.verdict,
      supersedesFactId: decisionExecutionFacts.supersedesFactId,
    })
    .from(decisionExecutionFacts)
    .where(eq(decisionExecutionFacts.investorId, investorId))
    .orderBy(asc(decisionExecutionFacts.createdAt), asc(decisionExecutionFacts.id));
  return selectEffectiveExecutionFacts(rows).map((r) => ({ id: r.id, decisionId: r.decisionId, transactionId: r.transactionId, verdict: r.verdict }));
}

export interface EffectiveExecutionFact {
  id: string;
  verdict: ExecutionVerdict;
  note: string | null;
  createdAt: Date;
  transaction: {
    id: string;
    transactionType: string;
    transactionDate: Date;
    quantity: number | null;
    price: number | null;
    amount: number;
  };
}

/** EFFECTIVE (chain-head) facts of one decision, with the trade facts they are about. Deterministic order. */
export async function loadEffectiveExecutionFactsForDecision(db: DbOrTx, decisionId: string): Promise<EffectiveExecutionFact[]> {
  const rows = await db
    .select({
      id: decisionExecutionFacts.id,
      verdict: decisionExecutionFacts.verdict,
      note: decisionExecutionFacts.note,
      createdAt: decisionExecutionFacts.createdAt,
      supersedesFactId: decisionExecutionFacts.supersedesFactId,
      transactionId: transactions.id,
      transactionType: transactions.transactionType,
      transactionDate: transactions.transactionDate,
      quantity: transactions.quantity,
      price: transactions.price,
      amount: transactions.amount,
    })
    .from(decisionExecutionFacts)
    .innerJoin(transactions, eq(transactions.id, decisionExecutionFacts.transactionId))
    .where(eq(decisionExecutionFacts.decisionId, decisionId));
  return selectEffectiveExecutionFacts(rows)
    .map((r) => ({
      id: r.id,
      verdict: r.verdict,
      note: r.note,
      createdAt: r.createdAt,
      transaction: {
        id: r.transactionId,
        transactionType: r.transactionType,
        transactionDate: r.transactionDate,
        quantity: r.quantity === null ? null : Number(r.quantity),
        price: r.price === null ? null : Number(r.price),
        amount: Number(r.amount),
      },
    }))
    .sort(
      (a, b) =>
        a.transaction.transactionDate.getTime() - b.transaction.transactionDate.getTime() ||
        a.transaction.id.localeCompare(b.transaction.id)
    );
}

export async function insertDecisionExecutionFact(
  db: typeof Db,
  input: NewExecutionFactInput
): Promise<{ fact: typeof decisionExecutionFacts.$inferSelect; replayed: boolean }> {
  try {
    return await db.transaction(async (tx) => {
      // Serializes concurrent assertions for one investor, so the
      // replay/conflict classification below cannot race a sibling insert
      // (same convention as transaction_link_facts).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"decision_execution_facts:" + input.investorId}))`);

      const [decision] = await tx
        .select({ id: decisions.id, investorId: decisions.investorId, ticker: decisions.ticker, decisionType: decisions.decisionType, decisionDate: decisions.decisionDate })
        .from(decisions)
        .where(and(eq(decisions.id, input.decisionId), eq(decisions.investorId, input.investorId)));
      if (!decision) throw new ExecutionFactValidationError(["Decision not found."]);

      const [transaction] = await tx
        .select({ id: transactions.id, investorId: transactions.investorId, ticker: transactions.ticker, transactionType: transactions.transactionType, transactionDate: transactions.transactionDate })
        .from(transactions)
        .where(and(eq(transactions.id, input.transactionId), eq(transactions.investorId, input.investorId)));

      const problems = validateExecutionFactShape({
        investorId: input.investorId,
        verdict: input.verdict,
        decision,
        transaction: transaction ?? null,
        timeZone: input.timeZone,
      });

      const note = input.note?.trim() ? input.note.trim() : null;
      const sameContent = (f: ExecutionFactRow) => f.verdict === input.verdict && (f.note ?? null) === note;
      const replayOf = async (id: string) => {
        const [existing] = await tx.select().from(decisionExecutionFacts).where(eq(decisionExecutionFacts.id, id));
        return { fact: existing!, replayed: true };
      };

      const all = await loadFactRowsForDecision(tx, input.decisionId);
      const effective = selectEffectiveExecutionFacts(all);
      const supersedesId = input.supersedesFactId ?? null;
      if (supersedesId !== null) {
        const target = all.find((f) => f.id === supersedesId);
        if (!target) problems.push("supersedesFactId is not a fact of this decision.");
        else if (target.transactionId !== input.transactionId) problems.push("A fact can only be superseded by one about the same trade.");
        else if (!effective.some((f) => f.id === supersedesId)) {
          // The target was already superseded. An identical retry of THAT
          // supersession (same verdict and note as the chain head) replays the
          // head — a lost response must not turn into an error or a fork;
          // anything else must supersede the current head explicitly.
          const head = chainHead(all, target);
          if (head && sameContent(head)) return replayOf(head.id);
          problems.push("The fact being superseded already has a successor.");
        } else if (problems.length === 0 && sameContent(target)) {
          // Superseding the head with identical content changes nothing:
          // replay it rather than append a redundant row.
          return replayOf(target.id);
        }
      }
      if (problems.length > 0) throw new ExecutionFactValidationError(problems);

      const classified = classifyAssertion(
        { decisionId: input.decisionId, transactionId: input.transactionId, verdict: input.verdict, note },
        effective.filter((f) => f.id !== supersedesId)
      );
      if (classified.kind === "replay") return replayOf(classified.fact.id);
      if (classified.kind === "conflict") {
        throw new ExecutionFactValidationError([
          `This trade already has an effective "${classified.fact.verdict}" fact for this decision (${classified.fact.id}); supersede it instead.`,
        ]);
      }

      const [fact] = await tx
        .insert(decisionExecutionFacts)
        .values({
          investorId: input.investorId,
          decisionId: input.decisionId,
          transactionId: input.transactionId,
          verdict: input.verdict,
          note,
          supersedesFactId: supersedesId,
          shownBasisJson: input.shownBasisJson ?? null,
        })
        .returning();
      return { fact: fact!, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, "decision_execution_facts_supersedes_unique")) {
      throw new ExecutionFactValidationError(["The fact being superseded already has a successor."]);
    }
    if (isUniqueViolation(err, "decision_execution_facts_root_pair_unique")) {
      throw new ExecutionFactValidationError(["This trade already has a fact for this decision; supersede it instead."]);
    }
    throw err;
  }
}
