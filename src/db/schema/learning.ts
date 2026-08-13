import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { dnaCreatedByEnum, evidenceStrengthEnum } from "./enums";

export const learningInsights = pgTable("learning_insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  family: text("family").notNull(), // e.g. "quality-dip-buys", "momentum"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learningInsightVersions = pgTable("learning_insight_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  learningInsightId: uuid("learning_insight_id")
    .notNull()
    .references(() => learningInsights.id),
  versionNumber: integer("version_number").notNull(),
  statementText: text("statement_text").notNull(),
  decisionQualityPatternJson: jsonb("decision_quality_pattern_json"),
  thesisAccuracyPatternJson: jsonb("thesis_accuracy_pattern_json"),
  evidenceStrength: evidenceStrengthEnum("evidence_strength").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Reuses the DNA created_by scale (ai_generated | user_correction) —
  // same meaning here: who authored this version of the insight.
  createdBy: dnaCreatedByEnum("created_by").notNull(),
  changeReason: text("change_reason"),
});
