import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { strategyPrincipleVersions } from "./strategy";
import { evidence } from "./evidence";
import { groundingVerdictEnum } from "./enums";

// Strategy Grounding + Identity Hardening task. The Strategy-specific
// mirror of src/db/schema/dna-grounding.ts's dnaEvidenceGroundingChecks —
// same shape, same reasoning, a SEPARATE table rather than a shared one:
// Evidence's subject is exactly one of {dnaHypothesisId, strategyPrincipleId,
// learningInsightId} (src/db/schema/evidence.ts), so a single shared
// grounding-check table would need its own polymorphic subject handling
// for no real benefit — two small, single-purpose tables are simpler than
// one polymorphic one, and keep each domain's cross-identity guard
// (src/db/repositories/strategy.ts) checking against exactly one FK
// target type.
//
// grounding_verdict IS reused as-is (not mirrored) — unlike dna_created_by/
// principle_created_by, this enum's two values ("supported"/"unsupported")
// carry no DNA-specific meaning at all; they're the generic output shape
// of checkEvidenceGrounding() (src/lib/ai/dna-grounding.ts), which this
// task reuses unmodified for Strategy too. Reusing the type is a real
// instance of "same semantics -> same table," the same judgment call this
// whole file's own comment above argues against for the *identity* FK.
//
// Why this table exists at all: evidence.strategyPrincipleId points to
// the STRATEGY PRINCIPLE IDENTITY (src/db/schema/strategy.ts), never to a
// specific StrategyPrincipleVersion — Evidence has no version scoping of
// its own, exactly the same structural fact that motivated the DNA table.
// Every version transition before this task only ever ADDED evidence, so
// "all raw evidence for the identity" and "everything the latest version
// counts" were always the same set; remediation is the first case where a
// version's valid evidence set can be a strict SUBSET of the identity's
// full pool. This table is the structural record of exactly which
// citations were evaluated, for which version, with what verdict and
// reason.
//
// Append-only: a row is never updated or deleted once inserted, and there
// is no "current" flag here — "current" stays MAX(version_number) on
// strategy_principle_versions, unchanged. UNIQUE(strategy_principle_version_id,
// evidence_id) is given an EXPLICIT short name — the auto-generated name
// for this pair would exceed Postgres's 63-byte identifier limit and be
// silently truncated to something nothing in the code could predict or
// match against isUniqueViolation(), the exact footgun already documented
// in docs/backlog.md and hit once for the DNA table before being named
// explicitly there too.
export const strategyEvidenceGroundingChecks = pgTable(
  "strategy_evidence_grounding_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyPrincipleVersionId: uuid("strategy_principle_version_id")
      .notNull()
      .references(() => strategyPrincipleVersions.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    verdict: groundingVerdictEnum("verdict").notNull(),
    // One sentence, grounded in the real answer text — the same audit
    // string checkEvidenceGrounding() already returns, simply persisted
    // here instead of discarded after the request.
    reason: text("reason").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("strategy_evidence_grounding_check_unique").on(
      table.strategyPrincipleVersionId,
      table.evidenceId
    ),
  ]
);
