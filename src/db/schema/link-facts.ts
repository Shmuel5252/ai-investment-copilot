import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import { transactions } from "./portfolio";
import { linkFactVerdictEnum } from "./enums";

// Decision Independence V1 — authoritative link facts. A row here is an
// INVESTOR-AUTHORED assertion that a set of transactions were (verdict
// "linked") or were not ("independent") one capital-reallocation decision.
// It is the ONLY source of KNOWN_LINKED / KNOWN_INDEPENDENT; deterministic
// candidates (weak edges, review-only pairs) are computed, never stored,
// and AI has no path into this table (no origin / ai_* column by design).
//
// Append-only, like every other historical table: history is never
// updated or deleted. A change of mind is a NEW row whose
// supersedes_fact_id points at the row it replaces; each row can be
// superseded at most once (partial unique index below), and the EFFECTIVE
// fact is the chain head. Cross-row rules the schema cannot express (>=2
// members, members belong to this investor, a linked fact needs a sell, a
// buy and two tickers, no conflicting opposite-verdict fact) are enforced
// in src/db/repositories/link-facts.ts.
export const transactionLinkFacts = pgTable(
  "transaction_link_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    verdict: linkFactVerdictEnum("verdict").notNull(),
    // Audit only — what the investor was shown when they asserted this
    // (candidate reasons, quoted answer ids). The resolver never reads it.
    shownBasisJson: jsonb("shown_basis_json"),
    note: text("note"),
    supersedesFactId: uuid("supersedes_fact_id").references((): AnyPgColumn => transactionLinkFacts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One successor per superseded fact — a chain, never a fork.
    uniqueIndex("transaction_link_facts_supersedes_unique")
      .on(table.supersedesFactId)
      .where(sql`${table.supersedesFactId} IS NOT NULL`),
    index("transaction_link_facts_investor_id_idx").on(table.investorId),
  ]
);

export const transactionLinkFactMembers = pgTable(
  "transaction_link_fact_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    factId: uuid("fact_id")
      .notNull()
      .references(() => transactionLinkFacts.id),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
  },
  (table) => [
    uniqueIndex("transaction_link_fact_members_fact_transaction_unique").on(table.factId, table.transactionId),
    index("transaction_link_fact_members_transaction_id_idx").on(table.transactionId),
  ]
);
