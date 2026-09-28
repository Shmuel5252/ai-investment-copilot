import { pgTable, uuid, text, boolean, timestamp, unique, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dnaHypothesisVersions } from "./dna";
import { strategyPrincipleVersions } from "./strategy";
import { evidence } from "./evidence";
import { groundingVerdictEnum, groundingPlannerActionEnum } from "./enums";

// OD-R9 — the grounding judgment AUDIT LEDGER. One immutable row per
// technically valid grounding judgment made in an authorized, persisted
// remediation / revalidation run: "in run R, evidence E of version V was
// judged under contract C with verdict X" — whatever the planner then did
// with it (new_version, checked_no_change or no_op).
//
// Why the check tables cannot hold this: a check row is
// (version, evidence, verdict, reason, checked_at) with
// UNIQUE(version, evidence) and no contract. A re-judgment that changes
// nothing (no_op) has nowhere to go without a second row for the same pair
// or a fake version, and a checked_no_change row sits on a version whose
// provenance names an older contract. Found on the supervised V3.1
// revalidation: three identities were re-judged and left no trace.
//
// AUDIT ONLY — this table is NEVER a source of truth. Nothing reads it to
// decide effective evidence, S/C, confidence, visibility, generation, the
// Learning carry, Decision AI, Prior Record or a later remediation.
// Effective evidence stays with the version and check rows alone
// (src/lib/dna/effective-evidence.ts). tests/unit/grounding-judgments-isolation.test.ts
// pins which modules may even name it.
//
// What it deliberately does NOT hold: the investor's text, the interview
// question, the claim text or any prompt. It names the evidence row and the
// judged version; the text stays where it was written. `reason` is the
// gate's own one-sentence explanation — the same audit string the check
// tables already persist — and is never evidence, never investor-authored
// truth and never fed back into grounding. A technical failure is never
// written here (there is no verdict value for it).
//
// Prospective only: no row is ever inferred for a judgment made before this
// table existed (migration 0018).
export const groundingJudgments = pgTable(
  "grounding_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The authorized run this judgment belongs to — a uuid chosen ONCE by the
    // run and reused by a retry of the same run. Never derived from a
    // timestamp. A later revalidation, even under the same contract, is a
    // different run id.
    runId: uuid("run_id").notNull(),

    // The version that was judged — exactly one of the two. The artifact kind
    // and the identity (and through it the investor) follow from it; neither
    // is copied here.
    dnaHypothesisVersionId: uuid("dna_hypothesis_version_id"),
    strategyPrincipleVersionId: uuid("strategy_principle_version_id"),

    // The citation that was judged. Its stance and its source (interview
    // answer or decision statement) are immutable on the evidence row and are
    // not copied here.
    evidenceId: uuid("evidence_id").notNull(),

    verdict: groundingVerdictEnum("verdict").notNull(),
    reason: text("reason").notNull(),
    // Whether an interview question reached the gate as context (OD-V32-7).
    // The question text itself is not stored.
    contextSupplied: boolean("context_supplied").notNull(),

    contract: text("contract").notNull(),
    semanticRule: text("semantic_rule").notNull(),
    model: text("model").notNull(),
    codeVersion: text("code_version"),

    // What the planner decided for the identity, and — only for new_version —
    // the version that decision created, written in the same transaction.
    plannerAction: groundingPlannerActionEnum("planner_action").notNull(),
    resultingDnaHypothesisVersionId: uuid("resulting_dna_hypothesis_version_id"),
    resultingStrategyPrincipleVersionId: uuid("resulting_strategy_principle_version_id"),

    judgedAt: timestamp("judged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Explicit short names: the auto-generated FK names exceed Postgres's
    // 63-byte identifier limit and would be silently truncated.
    foreignKey({ name: "grounding_judgments_dna_version_fk", columns: [table.dnaHypothesisVersionId], foreignColumns: [dnaHypothesisVersions.id] }),
    foreignKey({ name: "grounding_judgments_strategy_version_fk", columns: [table.strategyPrincipleVersionId], foreignColumns: [strategyPrincipleVersions.id] }),
    foreignKey({ name: "grounding_judgments_evidence_fk", columns: [table.evidenceId], foreignColumns: [evidence.id] }),
    foreignKey({ name: "grounding_judgments_resulting_dna_version_fk", columns: [table.resultingDnaHypothesisVersionId], foreignColumns: [dnaHypothesisVersions.id] }),
    foreignKey({ name: "grounding_judgments_resulting_strategy_version_fk", columns: [table.resultingStrategyPrincipleVersionId], foreignColumns: [strategyPrincipleVersions.id] }),
    // In one run a citation is judged once. A later legitimate revalidation
    // is a different run id, so it is never blocked and never overwrites.
    unique("grounding_judgment_run_evidence_unique").on(table.runId, table.evidenceId),
    check("grounding_judgment_one_judged_version", sql`num_nonnulls(${table.dnaHypothesisVersionId}, ${table.strategyPrincipleVersionId}) = 1`),
    check(
      "grounding_judgment_resulting_iff_new_version",
      sql`(${table.plannerAction} = 'new_version') = (num_nonnulls(${table.resultingDnaHypothesisVersionId}, ${table.resultingStrategyPrincipleVersionId}) = 1)`
    ),
    check(
      "grounding_judgment_resulting_same_artifact",
      sql`(${table.resultingDnaHypothesisVersionId} IS NULL OR (${table.dnaHypothesisVersionId} IS NOT NULL AND ${table.resultingDnaHypothesisVersionId} <> ${table.dnaHypothesisVersionId})) AND (${table.resultingStrategyPrincipleVersionId} IS NULL OR (${table.strategyPrincipleVersionId} IS NOT NULL AND ${table.resultingStrategyPrincipleVersionId} <> ${table.strategyPrincipleVersionId}))`
    ),
    check("grounding_judgment_nonblank_run_metadata", sql`btrim(${table.contract}) <> '' AND btrim(${table.semanticRule}) <> '' AND btrim(${table.model}) <> '' AND btrim(${table.reason}) <> ''`),
  ]
);
