import { pgTable, uuid, text, timestamp, integer, jsonb, primaryKey, unique } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { principleTypeEnum, principleCreatedByEnum, evidenceStrengthEnum } from "./enums";

export const strategyPrinciples = pgTable(
  "strategy_principles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    key: text("key").notNull(), // stable slug, e.g. "position-sizing-cap"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Real bug caught live (not synthetic): ensureDefaultRiskPrinciples()
  // only guarded against re-creating a default via an application-level
  // "check existing keys, then insert" — a genuine TOCTOU race with no
  // DB-level backstop. React StrictMode's intentional double-invoke of
  // useEffect in dev (next.config.ts: reactStrictMode) fired two
  // near-simultaneous ensureDefaults calls; both saw zero existing rows
  // before either committed, both inserted, producing exact duplicates
  // of all 4 default principles. This constraint is the actual fix —
  // insertDefaultRiskPrinciples now relies on it via onConflictDoNothing
  // instead of a racy pre-check — the frontend guard (StrategyPage) is
  // only a courtesy to avoid a redundant network call, not what makes
  // this safe.
  (table) => [unique().on(table.investorId, table.key)]
);

export const strategyPrincipleVersions = pgTable(
  "strategy_principle_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyPrincipleId: uuid("strategy_principle_id")
      .notNull()
      .references(() => strategyPrinciples.id),
    versionNumber: integer("version_number").notNull(),
    principleType: principleTypeEnum("principle_type").notNull(),
    statementText: text("statement_text").notNull(),
    rationaleText: text("rationale_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: principleCreatedByEnum("created_by").notNull(),
    changeReason: text("change_reason"),
    // Nullable — only "observed" principles go through the same Evidence
    // Strength engine as DNA (docs/architecture.md §2.4 "Observed מאותו
    // מנוע Evidence כמו DNA"; docs/data-model.md §0 groups Strategy
    // Principle with DNA Hypothesis and Learning Insight as the three
    // evidence-accumulating identity+version entities that share this
    // scale). "declared" principles are the investor's own verbatim
    // statement and "validated" ones are fixed system defaults — neither
    // is a statistical pattern under evaluation, so these stay null for
    // them. Added during the Baseline Strategy task: docs/data-model.md §3
    // originally omitted these fields for StrategyPrincipleVersion even
    // though src/lib/dna/evidence-strength.ts already documented the scale
    // as shared by all three tables — an inconsistency within the already-
    // approved spec, corrected here per the Docs Sync Rule rather than
    // left as a TODO.
    evidenceStrength: evidenceStrengthEnum("evidence_strength"),
    supportingEvidenceCount: integer("supporting_evidence_count"),
    contradictingEvidenceCount: integer("contradicting_evidence_count"),
    // Decision Independence V1 — the deterministic record of WHY the counts
    // above are what they are (policy version, strong groups, weak edges,
    // S_lb/S_ub/C_ub, ...). supporting/contradicting_evidence_count store
    // S_lb and C_ub — the confidence inputs — so calculateEvidenceStrength
    // over the stored counts always reproduces the stored tier. NULL =
    // counted before this existed (episode-only, legacy); never backfilled.
    independenceBasisJson: jsonb("independence_basis_json"),
    // Evidence Reach V1 — see dna.ts's provenanceJson.
    provenanceJson: jsonb("provenance_json"),
  },
  // Defense-in-depth swept across every identity+version table after a
  // real duplicate was found on strategy_principles — see that migration.
  (table) => [unique().on(table.strategyPrincipleId, table.versionNumber)]
);

// Whole-bundle version (docs/data-model.md §0): "Strategy" as a concept =
// the latest row here. No separate `approved_by` column — this table is
// only ever written through the user-approval flow (application-layer
// invariant, per Product Principle "Strategy never changes silently");
// investor_id already records whose strategy it is.
export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    versionNumber: integer("version_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    changeSummary: text("change_summary").notNull(),
  },
  // Real bug caught live: a double-click on "Approve as new strategy
  // version" (~9.6s apart — not even a millisecond-scale race, just an
  // unguarded double-submit) produced v1 and v2 with byte-identical
  // bundled content. This constraint doesn't prevent *that* specific
  // shape (v1/v2 are legitimately different version_numbers even
  // duplicated) — that's fixed at the UI layer (useSubmitGuard) — but it
  // does close the true-concurrency version-number-collision variant of
  // the same underlying class, swept here alongside the other
  // identity+version tables.
  (table) => [unique().on(table.investorId, table.versionNumber)]
);

// Which principle-versions are bundled into a given whole-strategy
// version (including carried-over, unchanged ones).
export const strategyVersionPrinciples = pgTable(
  "strategy_version_principles",
  {
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id),
    strategyPrincipleVersionId: uuid("strategy_principle_version_id")
      .notNull()
      .references(() => strategyPrincipleVersions.id),
  },
  (table) => [primaryKey({ columns: [table.strategyVersionId, table.strategyPrincipleVersionId] })]
);
