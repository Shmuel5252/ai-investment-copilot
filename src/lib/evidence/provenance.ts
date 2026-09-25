import { EVIDENCE_SOURCE_CONTRACT_VERSION } from "./statement-ref";
import { INDEPENDENCE_POLICY_VERSION } from "./resolve-independence";

// Evidence Reach V1 — provenance of a regenerated, versioned AI artifact
// (DNA hypothesis version, observed Strategy principle version, Learning
// insight version), persisted as provenance_json. Answers, for that version:
// which source types/records it came from, which model, which prompt/contract
// version, when, and which code. Plain JSON; never rewritten; NULL on every
// row written before it existed (never backfilled — a provenance written
// later would be a guess).
export const PROVENANCE_SCHEMA_VERSION = 1 as const;

export type ProvenanceGenerator =
  | "dna.generate"
  | "strategy.generateObserved"
  | "learning.generate"
  | "learning.agree_carry";

export interface ArtifactProvenance {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  generator: ProvenanceGenerator;
  /** The model id the generating call used; null when no model was involved (a deterministic carry). */
  model: string | null;
  /** Ids of the prompt/tool contracts involved (src/lib/ai/contracts.ts). */
  promptContracts: string[];
  evidenceSourceContract: typeof EVIDENCE_SOURCE_CONTRACT_VERSION;
  independencePolicy: string;
  /** Source record types this version's evidence may cite. */
  sourceTypes: ("interview_answer" | "decision_statement" | "decision_review")[];
  generatedAt: string;
  /** Deploy/commit identifier when the runtime exposes one; null locally. */
  codeVersion: string | null;
  /** learning.agree_carry only: the agreed insight (OD-3) — the replay key. */
  carriedFromLearningInsightId?: string;
  carriedFromLearningInsightVersionId?: string;
  /**
   * learning.generate only: the reviews THIS version cited and the stance it
   * gave each. Evidence rows belong to the identity (append-only, all
   * versions); this is the per-version stance authority the OD-3 carry reads,
   * so a re-synthesised wording never inherits an earlier version's stances.
   */
  citedReviews?: { decisionReviewId: string; decisionId?: string; stance: "supporting" | "contradicting" }[];
  /** learning.generate only (OD-R1): the effective evidence-state fingerprint that justified THIS version (src/lib/learning/evidence-fingerprint.ts). */
  evidenceFingerprint?: string;
}

export function codeVersionFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? null;
}

export function buildProvenance(input: {
  generator: ProvenanceGenerator;
  model: string | null;
  promptContracts: string[];
  sourceTypes: ArtifactProvenance["sourceTypes"];
  now?: Date;
  carriedFromLearningInsightId?: string;
  carriedFromLearningInsightVersionId?: string;
  citedReviews?: { decisionReviewId: string; decisionId?: string; stance: "supporting" | "contradicting" }[];
  evidenceFingerprint?: string;
}): ArtifactProvenance {
  const p: ArtifactProvenance = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    generator: input.generator,
    model: input.model,
    promptContracts: [...input.promptContracts],
    evidenceSourceContract: EVIDENCE_SOURCE_CONTRACT_VERSION,
    independencePolicy: INDEPENDENCE_POLICY_VERSION,
    sourceTypes: [...input.sourceTypes],
    generatedAt: (input.now ?? new Date()).toISOString(),
    codeVersion: codeVersionFromEnv(),
  };
  if (input.carriedFromLearningInsightId !== undefined) p.carriedFromLearningInsightId = input.carriedFromLearningInsightId;
  if (input.carriedFromLearningInsightVersionId !== undefined) p.carriedFromLearningInsightVersionId = input.carriedFromLearningInsightVersionId;
  if (input.citedReviews !== undefined) p.citedReviews = input.citedReviews.map((c) => ({ decisionReviewId: c.decisionReviewId, ...(c.decisionId !== undefined ? { decisionId: c.decisionId } : {}), stance: c.stance }));
  if (input.evidenceFingerprint !== undefined) p.evidenceFingerprint = input.evidenceFingerprint;
  return p;
}
