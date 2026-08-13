import { pgTable, uuid, text, timestamp, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { caseStatusEnum, ideaSourceEnum } from "./enums";

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
});
