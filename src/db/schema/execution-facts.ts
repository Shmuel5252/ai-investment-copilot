import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import { transactions } from "./portfolio";
import { decisions } from "./decisions";
import { executionFactVerdictEnum } from "./enums";

// Decision Follow-Through V1 — authoritative execution facts. A row is an
// INVESTOR-AUTHORED assertion about ONE (decision, transaction) pair: the
// trade "executed" that decision, or is "unrelated" to it. It is the only
// source of "this decision was executed by ..."; candidates (same-ticker
// BUY/SELL rows around the decision day — the monitoring's execution groups)
// are computed, never stored, and AI has no path into this table.
//
// Append-only, like transaction_link_facts: a change of mind is a NEW row
// whose supersedes_fact_id points at the row it replaces (one successor per
// fact — partial unique index; the EFFECTIVE fact for a pair is the chain
// head). Cross-row rules the schema cannot express (same investor and
// ticker on both sides, a trade, side and day rules for "executed", one
// effective fact per pair) live in src/lib/execution/execution-facts.ts and
// are enforced atomically by src/db/repositories/execution-facts.ts.
export const decisionExecutionFacts = pgTable(
  "decision_execution_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    verdict: executionFactVerdictEnum("verdict").notNull(),
    // Audit only — what the investor was shown when asserting (candidate
    // group, decision type, trade facts). Never read by any rule.
    shownBasisJson: jsonb("shown_basis_json"),
    note: text("note"),
    supersedesFactId: uuid("supersedes_fact_id").references((): AnyPgColumn => decisionExecutionFacts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One ROOT per (decision, transaction) pair. Together with "one successor per
    // fact" below this makes "exactly one chain, hence one effective fact, per
    // pair" a database invariant — not only an application rule under the
    // advisory lock.
    uniqueIndex("decision_execution_facts_root_pair_unique")
      .on(table.decisionId, table.transactionId)
      .where(sql`${table.supersedesFactId} IS NULL`),
    uniqueIndex("decision_execution_facts_supersedes_unique")
      .on(table.supersedesFactId)
      .where(sql`${table.supersedesFactId} IS NOT NULL`),
    index("decision_execution_facts_decision_id_idx").on(table.decisionId),
    index("decision_execution_facts_transaction_id_idx").on(table.transactionId),
    // A fact never supersedes itself (the one cycle a single INSERT could form;
    // longer cycles are impossible because supersedes_fact_id is set once at
    // insert and there is no UPDATE path).
    check("decision_execution_facts_no_self_supersession", sql`${table.supersedesFactId} IS NULL OR ${table.supersedesFactId} <> ${table.id}`),
  ]
);
