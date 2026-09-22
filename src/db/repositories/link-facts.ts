import { eq, inArray, sql } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { transactionLinkFacts, transactionLinkFactMembers, transactions } from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import {
  findLinkFactConflicts,
  selectEffectiveLinkFacts,
  validateLinkFactShape,
  type LinkFactRow,
} from "@/lib/evidence/link-facts";
import type { EffectiveLinkFact } from "@/lib/evidence/resolve-independence";

// Decision Independence V1 — authoritative LinkFacts. INSERT-ONLY by
// construction: this module exports no update or delete, and history is
// changed only by inserting a new fact that supersedes the old one (one
// successor per fact — partial unique index; the effective fact is the
// chain head). Nothing in src/lib/ai may reach this module, and NO
// user-facing mutation procedure calls it yet: writing historical truth
// waits for the investor-confirmation workflow.

export class LinkFactValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`Invalid link fact: ${problems.join(" ")}`);
    this.name = "LinkFactValidationError";
  }
}

export interface NewLinkFactInput {
  investorId: string;
  verdict: "linked" | "independent";
  transactionIds: readonly string[];
  /** Must be an EFFECTIVE fact of the same investor. */
  supersedesFactId?: string | null;
  /** Audit only — what the investor was shown; never read by the resolver. */
  shownBasisJson?: unknown;
  note?: string | null;
}

async function loadFactRows(db: DbOrTx, investorId: string): Promise<LinkFactRow[]> {
  const facts = await db.select().from(transactionLinkFacts).where(eq(transactionLinkFacts.investorId, investorId));
  if (facts.length === 0) return [];
  const members = await db
    .select()
    .from(transactionLinkFactMembers)
    .where(inArray(transactionLinkFactMembers.factId, facts.map((f) => f.id)));
  const byFact = new Map<string, string[]>();
  for (const m of members) byFact.set(m.factId, [...(byFact.get(m.factId) ?? []), m.transactionId]);
  return facts.map((f) => ({
    id: f.id,
    verdict: f.verdict,
    supersedesFactId: f.supersedesFactId,
    transactionIds: (byFact.get(f.id) ?? []).sort(),
  }));
}

// EFFECTIVE (chain-head) facts only — the resolver's sole source of
// KNOWN_LINKED / KNOWN_INDEPENDENT.
export async function loadEffectiveLinkFacts(db: DbOrTx, investorId: string): Promise<EffectiveLinkFact[]> {
  const effective = selectEffectiveLinkFacts(await loadFactRows(db, investorId));
  return effective.map((f) => ({ id: f.id, verdict: f.verdict, transactionIds: f.transactionIds }));
}

export async function insertTransactionLinkFact(db: typeof Db, input: NewLinkFactInput) {
  try {
    return await db.transaction(async (tx) => {
      // Serializes concurrent assertions for one investor, so the conflict
      // check below cannot race a sibling insert (same convention as the
      // transaction-import advisory lock in repositories/portfolio.ts).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"transaction_link_facts:" + input.investorId}))`);

      const foundTransactions =
        input.transactionIds.length === 0
          ? []
          : await tx
              .select({
                id: transactions.id,
                investorId: transactions.investorId,
                ticker: transactions.ticker,
                transactionType: transactions.transactionType,
              })
              .from(transactions)
              .where(inArray(transactions.id, [...input.transactionIds]));

      const problems = validateLinkFactShape({
        investorId: input.investorId,
        verdict: input.verdict,
        requestedTransactionIds: input.transactionIds,
        foundTransactions,
      });

      const all = await loadFactRows(tx, input.investorId);
      const effective = selectEffectiveLinkFacts(all);
      const supersedesId = input.supersedesFactId ?? null;
      if (supersedesId !== null) {
        if (!all.some((f) => f.id === supersedesId)) problems.push("supersedesFactId is not a fact of this investor.");
        else if (!effective.some((f) => f.id === supersedesId)) {
          problems.push("The fact being superseded already has a successor.");
        }
      }

      const conflicts = findLinkFactConflicts(
        input,
        effective.filter((f) => f.id !== supersedesId)
      );
      if (conflicts.length > 0) {
        problems.push(
          `Conflicts with effective fact(s) ${conflicts.map((c) => c.id).join(", ")} of the opposite verdict; supersede them instead.`
        );
      }
      if (problems.length > 0) throw new LinkFactValidationError(problems);

      const [fact] = await tx
        .insert(transactionLinkFacts)
        .values({
          investorId: input.investorId,
          verdict: input.verdict,
          shownBasisJson: input.shownBasisJson ?? null,
          note: input.note ?? null,
          supersedesFactId: supersedesId,
        })
        .returning();
      await tx
        .insert(transactionLinkFactMembers)
        .values(input.transactionIds.map((transactionId) => ({ factId: fact!.id, transactionId })));
      return fact!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "transaction_link_facts_supersedes_unique")) {
      throw new LinkFactValidationError(["The fact being superseded already has a successor."]);
    }
    throw err;
  }
}
