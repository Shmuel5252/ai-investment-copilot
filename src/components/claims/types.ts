// The shapes the claims layer reads: a claim's CURRENT version, its reach
// facts (evidence.reach) and its effective citations (dna.evidence). Narrow
// on purpose, so a synthetic preview builds the same props. Dates arrive as
// ISO strings.

export interface ClaimVersion {
  versionNumber: number;
  statementText: string;
  evidenceStrength: string | null;
  supportingEvidenceCount: number | null;
  contradictingEvidenceCount: number | null;
  createdAt: string | Date;
  createdBy: string;
  changeReason: string | null;
  /** Decision Independence V1 record; null = counted before it existed. */
  independenceBasisJson?: unknown;
  /** Evidence Reach V1 record; null = written before it existed. */
  provenanceJson?: unknown;
}

export interface ClaimReach {
  visibleToAi: boolean;
  sources: { interviewAnswers: number; decisionStatements: number };
  distance: { nextTier: string; additionalSupportingCases: number } | null;
  unresolvedDecisionIds: string[];
  citedStatementKeys: string[];
}

export interface EvidenceRow {
  id: string;
  stance: string;
  interviewAnswerId: string | null;
  decisionId: string | null;
  decisionStatementKind: string | null;
  decisionReviewId: string | null;
  transactionId: string | null;
  sourceLearningInsightId: string | null;
  manualNoteText: string | null;
  description: string;
  createdAt: string | Date;
}

export interface DecisionRef {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: string | Date;
}
