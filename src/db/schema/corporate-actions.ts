import { pgTable, uuid, text, timestamp, integer, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import { corporateActionKindEnum, corporateActionSourceEnum } from "./enums";

// Import Blockers V1 (docs/data-model.md §6 "CorporateAction") — an
// immutable, investor-scoped, RATIO-based record of a stock split (or
// reverse split: numerator < denominator). It is a separate layer over the
// transaction history: the original BUY/SELL rows are never rewritten;
// computePositions() applies the ratio at the effective date (the first
// trading date on which the broker expresses quantities in post-split
// units). Insert-only: the repository exposes no update/delete
// (docs/data-model.md §10). Not a corporate-actions platform — one kind.
export const corporateActions = pgTable(
  "corporate_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    ticker: text("ticker").notNull(),
    kind: corporateActionKindEnum("kind").notNull(),
    // Date-only, stored at 00:00Z exactly like transactions.transaction_date,
    // so "same day" ordering (action → opening state → transactions) is exact.
    effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
    ratioNumerator: integer("ratio_numerator").notNull(),
    ratioDenominator: integer("ratio_denominator").notNull(),
    source: corporateActionSourceEnum("source").notNull(),
    // The concrete factual source (e.g. the issuer disclosure and the broker
    // statement lines) — required, so the row is never a bare assertion.
    evidence: text("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The same split recorded twice would double-adjust holdings.
    uniqueIndex("corporate_actions_investor_ticker_effective_date_unique").on(
      table.investorId,
      table.ticker,
      table.effectiveDate
    ),
    check("corporate_actions_ratio_positive", sql`${table.ratioNumerator} > 0 AND ${table.ratioDenominator} > 0`),
  ]
);
