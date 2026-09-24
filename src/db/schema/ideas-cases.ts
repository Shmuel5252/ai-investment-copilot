import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { investors } from "./identity";
import { caseStatusEnum, ideaSourceEnum } from "./enums";
import { predictions } from "./decisions";

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  ticker: text("ticker").notNull(),
  noteText: text("note_text").notNull(),
  source: ideaSourceEnum("source").notNull().default("user_manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  promotedToCaseId: uuid("promoted_to_case_id").references(
    (): AnyPgColumn => investmentCases.id
  ),
});

// Mutable while `researching` — a live working document, not a frozen
// judgment (docs/data-model.md §0 "Frozen deep-copy JSON" pattern: once a
// DecisionSnapshot is created it copies this content, it doesn't version
// InvestmentCase itself). No portfolioFitMetrics column: Portfolio Fit is
// always computed on read, never stored, while status=researching — built
// on computePositions() (src/lib/portfolio/positions.ts, Historical
// Memory Layer task); the actual computePortfolioFit() lands with the
// Investment Case task once there's a real caller for it.
export const investmentCases = pgTable("investment_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  ticker: text("ticker").notNull(),
  ideaId: uuid("idea_id").references(() => ideas.id),
  status: caseStatusEnum("status").notNull().default("researching"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  marketIntelligenceJson: jsonb("market_intelligence_json"),
  marketIntelligenceFetchedAt: timestamp("market_intelligence_fetched_at", {
    withTimezone: true,
  }),

  personalFitText: text("personal_fit_text"),
  personalFitEvidenceRefs: jsonb("personal_fit_evidence_refs"),

  // Narrative only — regenerated via an explicit "refresh analysis"
  // action, not on every read. The underlying metrics are always live
  // (computePortfolioFit()); only this narrative can lag behind them.
  portfolioFitText: text("portfolio_fit_text"),

  bullCaseText: text("bull_case_text"),
  bearCaseText: text("bear_case_text"),
  catalystsText: text("catalysts_text"),
  invalidationConditionsText: text("invalidation_conditions_text"),
  marketBlindspotText: text("market_blindspot_text"),
  devilsAdvocateText: text("devils_advocate_text"),
  synthesisText: text("synthesis_text"),

  // Decision Follow-Through V1 — set only by cases.createFromCondition: this
  // case was opened because the investor CONFIRMED that a re-entry condition
  // they had set on an earlier decision fired (predictions.kind =
  // reentry_condition, status = confirmed). An explicit, investor-initiated
  // link — never inferred. Frozen into the eventual DecisionSnapshot with the
  // rest of this row (investment_case_snapshot_json). One case per condition
  // (partial unique index): the condition resolves once, so does its
  // reconsideration. Lazy cross-file reference — decisions.ts already refers
  // to investmentCases the same way; both thunks resolve after load.
  originPredictionId: uuid("origin_prediction_id").references((): AnyPgColumn => predictions.id),
}, (table) => [
  uniqueIndex("investment_cases_origin_prediction_unique")
    .on(table.originPredictionId)
    .where(sql`${table.originPredictionId} IS NOT NULL`),
]);
