import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { dnaHypothesisVersions } from "./dna";
import { evidence } from "./evidence";
import { groundingVerdictEnum } from "./enums";

// DNA Grounding Remediation task. Persists the per-citation result of a
// checkEvidenceGrounding() call (src/lib/ai/dna-grounding.ts), scoped to
// the specific DNAHypothesisVersion it was evaluated for — never to the
// DNAHypothesis identity, since Evidence itself (src/db/schema/evidence.ts)
// belongs to the identity and has no version scoping at all: the same
// Evidence row can be "supported" for one version's claim and, in
// principle, judged again for a later version with different wording.
//
// Why this table exists (not just recomputing counts on the version row):
// getEvidenceForDnaHypothesis() has always returned the FULL, unfiltered
// Evidence pool for an identity, with no version filter — fine as long as
// every version transition only ever ADDS evidence (true for every path
// before this task). Remediation is the first case where a version's
// valid evidence set can be SMALLER than the identity's full Evidence
// pool (a previously-accepted citation no longer grounds the claim under
// the current standard) — without this table, "View Evidence" would keep
// showing a citation a version's own supportingEvidenceCount no longer
// counts, with no way to tell why. This table is the structural record of
// exactly which citations were evaluated, for which version, with what
// verdict and reason — see docs/data-model.md §2.
//
// Append-only, like every other audit trail in this schema: a row is
// never updated or deleted once inserted, and there is no "current" flag
// here — "current" is still MAX(version_number) on dna_hypothesis_versions,
// unchanged. UNIQUE(dna_hypothesis_version_id, evidence_id) is
// defense-in-depth against double-logging the same check for the same
// version (the same shape as every other identity+version table's
// UNIQUE(parent_id, version_number) — see that migration).
export const dnaEvidenceGroundingChecks = pgTable(
  "dna_evidence_grounding_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dnaHypothesisVersionId: uuid("dna_hypothesis_version_id")
      .notNull()
      .references(() => dnaHypothesisVersions.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    verdict: groundingVerdictEnum("verdict").notNull(),
    // One sentence, grounded in the real answer text — the same audit
    // string checkEvidenceGrounding() already returns, simply persisted
    // here instead of discarded after the request (EvidenceGroundingResult.reason).
    reason: text("reason").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Explicit short name: Drizzle's auto-generated name for this pair
  // (dna_evidence_grounding_checks_dna_hypothesis_version_id_evidence_id_unique,
  // 74 chars) exceeds Postgres's 63-byte identifier limit and would be
  // silently truncated at runtime to a name nothing in the code could
  // predict or match against isUniqueViolation() — the exact footgun
  // already documented in docs/backlog.md for
  // strategy_principle_versions_strategy_principle_id_version_numbe.
  // Named explicitly here instead of hitting that a second time.
  (table) => [unique("dna_evidence_grounding_check_unique").on(table.dnaHypothesisVersionId, table.evidenceId)]
);
