// Grouping decisions into families — code, deterministic
// (docs/architecture.md §2.8: "קיבוץ החלטות — קוד"). Groups by sector at
// decision time (from the frozen investment_case_snapshot_json), a real
// fact already on file — not an invented taxonomy, and matches one of
// the concrete example families in the product concept doc ("סקטורים
// מסוימים"). A decision with no recorded sector is skipped rather than
// lumped into a fake "Unknown" family — that's not a real shared trait.
//
// MIN_FAMILY_SIZE is the code-side minimal-evidence gate on even
// *attempting* a synthesis (architecture.md §2.8: "סף ראיות מינימלי —
// קוד") — separate from, and in addition to, the Evidence Strength
// threshold table (data-model.md §2) that labels the resulting insight's
// confidence once evidence exists. Two decisions is the floor for "worth
// asking whether there's a pattern at all"; the shared threshold table
// (total<3 -> insufficient_evidence) still applies on top of this and
// will honestly label a 2-decision family's insight as thin.
export const MIN_FAMILY_SIZE = 2;

export interface ReviewedDecisionInput {
  decisionId: string;
  decisionReviewId: string;
  ticker: string;
  sector: string | null;
}

export interface DecisionFamily<T extends ReviewedDecisionInput> {
  family: string;
  decisions: T[];
}

export function groupReviewedDecisionsBySector<T extends ReviewedDecisionInput>(
  decisions: readonly T[]
): DecisionFamily<T>[] {
  const byFamily = new Map<string, T[]>();

  for (const d of decisions) {
    const sector = d.sector?.trim();
    if (!sector) continue;
    const list = byFamily.get(sector) ?? [];
    list.push(d);
    byFamily.set(sector, list);
  }

  return [...byFamily.entries()]
    .filter(([, list]) => list.length >= MIN_FAMILY_SIZE)
    .map(([family, familyDecisions]) => ({ family, decisions: familyDecisions }));
}
