import { pgTable, uuid, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import {
  importBatchStatusEnum,
  transactionTypeEnum,
  transactionSourceEnum,
  costBasisConfidenceEnum,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
