import { loaded, type Loadable } from "@/components/home/types";
import type { ClaimReach, DecisionRef, EvidenceRow } from "@/components/claims/types";
import type { DnaStatementRow } from "@/components/dna/dna-view";

// SYNTHETIC data for the /styleguide DNA preview and the DNA render tests.
// Invented statements, ids and dates; nothing here comes from the investor's
// records. Every enum value is one the schema allows. Dates are ISO strings.

export type DnaPreviewState = "insufficient" | "mixed" | "empty";
export const DNA_PREVIEW_STATES: readonly DnaPreviewState[] = ["insufficient", "mixed", "empty"];

const V = (o: Partial<DnaStatementRow["versions"][number]> & { statementText: string }): DnaStatementRow["versions"][number] => ({
  versionNumber: 1,
  evidenceStrength: "insufficient_evidence",
  supportingEvidenceCount: 1,
  contradictingEvidenceCount: 0,
  createdAt: "2026-09-20T10:00:00.000Z",
  createdBy: "ai_generated",
  changeReason: null,
  independenceBasisJson: { exact: true, supportingUpper: 1 },
  provenanceJson: { generatedAt: "2026-09-20T09:58:00.000Z" },
  ...o,
});

const R = (o: Partial<ClaimReach> = {}): ClaimReach => ({
  visibleToAi: false,
  sources: { interviewAnswers: 2, decisionStatements: 1 },
  distance: { nextTier: "moderate", additionalSupportingCases: 2 },
  unresolvedDecisionIds: [],
  citedStatementKeys: ["answer:a1", "answer:a2", "decision:d1:reasoning"],
  ...o,
});

const INSUFFICIENT: DnaStatementRow[] = [
  { id: "h-1", versions: [V({ statementText: "טענת דוגמה: נוטה לבדוק מחדש את התזה לפני הוספה לפוזיציה קיימת.", supportingEvidenceCount: 2, versionNumber: 3, createdBy: "system_grounding_revalidation", changeReason: "Sample stored change reason, kept in its original language." })] },
  { id: "h-2", versions: [V({ statementText: "Sample statement: tends to write exit conditions only after entering a position.", supportingEvidenceCount: 1, contradictingEvidenceCount: 1 })] },
  { id: "h-3", versions: [V({ statementText: "טענת דוגמה: מעדיף לחכות לדוח לפני החלטה.", independenceBasisJson: null, provenanceJson: null, createdBy: "system_independence_recalculation", versionNumber: 2 })] },
];

const MIXED: DnaStatementRow[] = [
  INSUFFICIENT[0]!,
  { id: "h-4", versions: [V({ statementText: "טענת דוגמה: מגדיר גודל פוזיציה לפני הכניסה.", evidenceStrength: "moderate", supportingEvidenceCount: 3, independenceBasisJson: { exact: false, supportingUpper: 4 } })] },
  INSUFFICIENT[1]!,
  { id: "h-5", versions: [V({ statementText: "טענת דוגמה: חוזר לרעיונות שנפסלו כשמשהו מהותי משתנה.", evidenceStrength: "strong", supportingEvidenceCount: 5 })] },
];

const REACH = new Map<string, ClaimReach>([
  ["h-1", R()],
  ["h-2", R({ sources: { interviewAnswers: 2, decisionStatements: 0 }, citedStatementKeys: ["answer:a3", "answer:a4"], distance: { nextTier: "weak", additionalSupportingCases: 2 } })],
  ["h-3", R({ citedStatementKeys: ["answer:a5"], sources: { interviewAnswers: 1, decisionStatements: 0 }, unresolvedDecisionIds: ["d2"] })],
  ["h-4", R({ visibleToAi: true, distance: { nextTier: "strong", additionalSupportingCases: 2 } })],
  ["h-5", R({ visibleToAi: true, distance: null, citedStatementKeys: ["answer:a1", "answer:a2", "answer:a6", "decision:d1:risks", "decision:d3:reasoning"] })],
]);

export const DNA_PREVIEW_DECISIONS: DecisionRef[] = [{ id: "d1", ticker: "ABCD", decisionType: "BUY", decisionDate: "2026-09-12T09:25:00.000Z" }];

const E = (o: Partial<EvidenceRow> & { id: string; description: string }): EvidenceRow => ({
  stance: "supporting",
  interviewAnswerId: null,
  decisionId: null,
  decisionStatementKind: null,
  decisionReviewId: null,
  transactionId: null,
  sourceLearningInsightId: null,
  manualNoteText: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  ...o,
});

export const DNA_PREVIEW_EVIDENCE: Record<string, EvidenceRow[]> = {
  "h-1": [
    E({ id: "e-1", interviewAnswerId: "a1", description: "סיכום דוגמה: בתשובה לשאלה על הוספה לפוזיציה, תיאר בדיקה מחדש של התזה." }),
    E({ id: "e-2", decisionId: "d1", decisionStatementKind: "reasoning", description: "Sample AI summary of a citation from a decision-time text." }),
    E({ id: "e-3", stance: "contradicting", interviewAnswerId: "a2", description: "סיכום דוגמה: במקרה אחר הוסיף לפוזיציה בלי לבדוק מחדש." }),
  ],
};

export function dnaPreviewData(state: DnaPreviewState): { statements: Loadable<DnaStatementRow[]>; reach: Loadable<ReadonlyMap<string, ClaimReach>> } {
  if (state === "empty") return { statements: loaded([]), reach: loaded(new Map()) };
  return { statements: loaded(state === "mixed" ? MIXED : INSUFFICIENT), reach: loaded(REACH) };
}
