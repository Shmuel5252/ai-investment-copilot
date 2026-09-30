import { loaded, type Loadable } from "@/components/home/types";
import type { ClaimReach, EvidenceRow } from "@/components/claims/types";
import type { ApprovedVersion, DeclaredCandidate, PrincipleRow, PrincipleVersion } from "@/components/strategy/strategy-view";

// SYNTHETIC data for the /styleguide Strategy preview and the Strategy render
// tests. Invented wording, ids and dates; nothing here comes from the
// investor's records. Every enum value is one the schema allows. Dates are
// ISO strings, in the order strategy.list returns principles (by creation).

export type StrategyPreviewState = "main" | "flow" | "sparse";
export const STRATEGY_PREVIEW_STATES: readonly StrategyPreviewState[] = ["main", "flow", "sparse"];

const V = (o: Partial<PrincipleVersion> & { statementText: string; principleType: string }): PrincipleVersion => ({
  versionNumber: 1,
  rationaleText: "",
  evidenceStrength: null,
  supportingEvidenceCount: null,
  contradictingEvidenceCount: null,
  createdAt: "2026-08-10T10:00:00.000Z",
  createdBy: "user_declared",
  changeReason: null,
  independenceBasisJson: null,
  provenanceJson: null,
  ...o,
});

export const APPROVED: ApprovedVersion = { versionNumber: 2, createdAt: "2026-08-17T12:00:00.000Z", changeSummary: "טקסט דוגמה: סיכום שכתבתי כשאישרתי את הגרסה." };

const PRINCIPLES: PrincipleRow[] = [
  { id: "p-v1", versions: [V({ principleType: "validated", createdBy: "system_default", statementText: "Sample guardrail: define exit conditions before entering a position.", rationaleText: "Sample fixed rationale supplied by the system." })] },
  { id: "p-d1", versions: [V({ principleType: "declared", statementText: "טקסט דוגמה: לא להוסיף לפוזיציה בלי לבדוק מחדש את התזה.", rationaleText: "טקסט דוגמה: הנימוק שנשמר עם העיקרון." })] },
  { id: "p-v2", versions: [V({ principleType: "validated", createdBy: "system_default", statementText: "Sample guardrail: avoid letting one position dominate the portfolio by accident." })] },
  {
    id: "p-o1",
    versions: [
      V({
        principleType: "observed",
        createdBy: "system_grounding_revalidation",
        versionNumber: 3,
        statementText: "טענת דוגמה: נוטה להשאיר מזומן לפני דוחות.",
        evidenceStrength: "insufficient_evidence",
        supportingEvidenceCount: 2,
        contradictingEvidenceCount: 1,
        createdAt: "2026-09-25T10:00:00.000Z",
        changeReason: "Sample stored change reason.",
        independenceBasisJson: { exact: true, supportingUpper: 2 },
        provenanceJson: { generatedAt: "2026-09-25T09:58:00.000Z" },
      }),
    ],
  },
  { id: "p-d2", versions: [V({ principleType: "declared", statementText: "Sample adopted rule in English, kept as written.", createdAt: "2026-09-20T10:00:00.000Z" })] },
  { id: "p-o2", versions: [V({ principleType: "observed", createdBy: "ai_observed", statementText: "Sample observation: sizes positions smaller in volatile sectors.", evidenceStrength: "insufficient_evidence", supportingEvidenceCount: 1, contradictingEvidenceCount: 0 })] },
];

const REACH = new Map<string, ClaimReach>([
  ["p-o1", { visibleToAi: false, sources: { interviewAnswers: 2, decisionStatements: 1 }, distance: { nextTier: "weak", additionalSupportingCases: 1 }, unresolvedDecisionIds: [], citedStatementKeys: ["answer:a1", "answer:a2", "decision:d1:risks"] }],
  ["p-o2", { visibleToAi: false, sources: { interviewAnswers: 1, decisionStatements: 0 }, distance: { nextTier: "weak", additionalSupportingCases: 2 }, unresolvedDecisionIds: [], citedStatementKeys: ["answer:a3"] }],
]);

const E = (o: Partial<EvidenceRow> & { id: string; description: string }): EvidenceRow => ({
  stance: "supporting",
  interviewAnswerId: null,
  decisionId: null,
  decisionStatementKind: null,
  decisionReviewId: null,
  transactionId: null,
  sourceLearningInsightId: null,
  manualNoteText: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  ...o,
});

export const STRATEGY_PREVIEW_EVIDENCE: Record<string, EvidenceRow[]> = {
  "p-o1": [
    E({ id: "se-1", interviewAnswerId: "a1", description: "סיכום דוגמה: תיאר השארת מזומן לפני דוח." }),
    E({ id: "se-2", decisionId: "d1", decisionStatementKind: "risks", description: "Sample AI summary of a decision-time text." }),
    E({ id: "se-3", stance: "contradicting", interviewAnswerId: "a2", description: "סיכום דוגמה: במקרה אחר נכנס לפני דוח בלי מזומן." }),
  ],
};

export const STRATEGY_PREVIEW_CANDIDATES: DeclaredCandidate[] = [
  { statementText: "טקסט דוגמה: ניסוח שה-AI הציע מתוך תשובת ראיון.", rationaleText: "טקסט דוגמה: הנימוק שה-AI הציע.", citedAnswerIds: ["a1"] },
  { statementText: "טקסט דוגמה: לא להוסיף לפוזיציה בלי לבדוק מחדש את התזה.", rationaleText: "טקסט דוגמה: ניסוח זהה לעיקרון קיים.", citedAnswerIds: ["a2"] },
];

export function strategyPreviewData(state: StrategyPreviewState): {
  strategy: Loadable<{ principles: PrincipleRow[]; latestVersion: ApprovedVersion | null }>;
  reach: Loadable<ReadonlyMap<string, ClaimReach>>;
  candidates: DeclaredCandidate[] | null;
} {
  if (state === "sparse") {
    return { strategy: loaded({ principles: PRINCIPLES.filter((p) => p.versions[0]!.principleType === "validated"), latestVersion: null }), reach: loaded(new Map()), candidates: null };
  }
  return { strategy: loaded({ principles: PRINCIPLES, latestVersion: APPROVED }), reach: loaded(REACH), candidates: state === "flow" ? STRATEGY_PREVIEW_CANDIDATES : null };
}
