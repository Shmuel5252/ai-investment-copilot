import { pgTable, uuid, text, timestamp, integer, jsonb, unique } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { dnaHypothesisStatusEnum, dnaCreatedByEnum, evidenceStrengthEnum } from "./enums";

// Identity + Version split (docs/data-model.md §0): a stable row Evidence
// attaches to, independent of which version is "current".
export const dnaHypotheses = pgTable("dna_hypotheses", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  status: dnaHypothesisStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. "Current version" = MAX(version_number) per
// dna_hypothesis_id — never a mutable flag. evidence_strength is always
// computed in code from supporting/contradicting counts (docs/data-model.md
// §2 threshold table) — never an LLM-invented number.
export const dnaHypothesisVersions = pgTable(
  "dna_hypothesis_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dnaHypothesisId: uuid("dna_hypothesis_id")
      .notNull()
      .references(() => dnaHypotheses.id),
    versionNumber: integer("version_number").notNull(),
    statementText: text("statement_text").notNull(),
    evidenceStrength: evidenceStrengthEnum("evidence_strength").notNull(),
    supportingEvidenceCount: integer("supporting_evidence_count").notNull().default(0),
    contradictingEvidenceCount: integer("contradicting_evidence_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: dnaCreatedByEnum("created_by").notNull(),
    changeReason: text("change_reason"),
    // Decision Independence V1 — the deterministic record of WHY the counts
    // above are what they are (policy version, strong groups, weak edges,
    // S_lb/S_ub/C_ub, ...). supporting/contradicting_evidence_count store
    // S_lb and C_ub — the confidence inputs — so calculateEvidenceStrength
    // over the stored counts always reproduces the stored tier. NULL =
    // counted before this existed (episode-only, legacy); never backfilled.
    independenceBasisJson: jsonb("independence_basis_json"),
  },
  // Defense-in-depth, added after the same missing-constraint shape was
  // found causing a real duplicate elsewhere (strategy_principles.key —
  // see that migration) — swept across every identity+version table at
  // once rather than waiting to hit this one too. Two different version
  // rows for the same identity must never share a version_number; this
  // is what actually enforces it against true concurrent writes, not
  // application-level "compute next number, then insert".
  (table) => [unique().on(table.dnaHypothesisId, table.versionNumber)]
);
