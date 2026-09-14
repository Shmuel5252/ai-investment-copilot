import { pgTable, uuid, text, timestamp, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import {
  importBatchStatusEnum,
  transactionTypeEnum,
  transactionSourceEnum,
  costBasisConfidenceEnum,
  orderUnknownReasonEnum,
} from "./enums";

// Traceability support for CSV imports (docs/data-model.md §6).
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  filename: text("filename").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer("row_count").notNull(),
  status: importBatchStatusEnum("status").notNull().default("processing"),
});

// Raw factual data, not a judgment — mutable-for-correction (fixing a
// typo in your own trade history is not "rewriting interpretation").
// Cost basis method: Average Cost, not FIFO — see docs/data-model.md §6
// "פישוטים מכוונים" for the rationale (this product isn't for tax
// reporting; upgrading later doesn't break frozen DecisionSnapshots,
// which already hold their own computed portfolio_state_json copy).
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  ticker: text("ticker"),
  transactionType: transactionTypeEnum("transaction_type").notNull(),
  quantity: numeric("quantity"),
  price: numeric("price"),
  amount: numeric("amount").notNull(),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  source: transactionSourceEnum("source").notNull(),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id),
  notes: text("notes"),
  // Same-day ordering (Investment Episode Independence design's "ordering
  // contract") — both nullable, both null for the overwhelming majority
  // of rows (no same-day ticker collision at all: docs/data-model.md's
  // "no ambiguity" state). Never used by computePositions()'s existing
  // accounting walk (still pure chronological-by-date, unaffected) — read
  // only by the separate evidence-episode derivation
  // (deriveEpisodeKeys(), src/lib/portfolio/positions.ts — invoked
  // alongside the accounting walk, not merged into it). intraDayOrder: a
  // user-declared relative position within one same-day
  // (investor_id, ticker, transaction_date) group — enforced unique
  // within the group by the partial index below, but NOT globally
  // required (most rows never need one). orderUnknownReason: set instead
  // of intraDayOrder when a same-day group's relative order is genuinely
  // not known — see orderUnknownReasonEnum for the two reasons. A tied
  // group must be either fully declared (every member has a distinct
  // intraDayOrder) or fully unknown (every member has this set) — never
  // mixed; enforced at confirm time by the import/manual-entry atomic
  // contract, not by a DB constraint (a DB CHECK can't see sibling rows).
  intraDayOrder: integer("intra_day_order"),
  orderUnknownReason: orderUnknownReasonEnum("order_unknown_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Partial: only constrains rows that actually declare an order. Two
  // transactions for the same investor+ticker+date both declaring
  // intraDayOrder=1 is a genuine data error (or a lost concurrent-confirm
  // race — see import.ts's advisory-lock contract) and must fail loudly,
  // not silently coexist. Rows with intraDayOrder IS NULL (the
  // overwhelming majority) never participate in this index at all.
  uniqueIndex("transactions_investor_ticker_date_intraday_order_unique")
    .on(table.investorId, table.ticker, table.transactionDate, table.intraDayOrder)
    .where(sql`${table.intraDayOrder} IS NOT NULL`),
]);

// Holdings + cost basis as of the start of the imported window, entered
// manually. Self-reported — surfaced in the UI as lower-traceability than
// a real Transaction. Solves the "history is partial" gap from
// docs/architecture.md §2.1: we never assume the imported window equals
// the whole portfolio.
export const portfolioOpeningStates = pgTable("portfolio_opening_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  ticker: text("ticker").notNull(),
  quantity: numeric("quantity").notNull(),
  costBasisPerShare: numeric("cost_basis_per_share"),
  costBasisConfidence: costBasisConfidenceEnum("cost_basis_confidence").notNull(),
  asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
