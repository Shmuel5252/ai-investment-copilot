// Frontend V1 unit 2 — the one presentation join on Home (Owner decision).
//
// A next action that names a decision already shown in "דורש את תשומת לבך"
// is rendered inside that decision's row instead of a second time under
// "הצעד הבא". This is grouping by decision id and nothing else:
//   - the attention list keeps the monitoring engine's order (untouched);
//   - each decision's joined actions keep the catalogue order they arrived in;
//   - the remaining actions keep the catalogue order they arrived in;
//   - no action is created, dropped, re-ranked or re-derived here. Which
//     actions exist, and why, stays with deriveNextActions()
//     (src/lib/next-actions/next-actions.ts).
// Pure and generic so it is tested on the production function directly.

export interface JoinableAction {
  key: string;
  decision?: { id: string } | null;
}

export interface JoinedNextActions<A extends JoinableAction> {
  /** decision id -> the actions that now render in that decision's attention row, in their original order. */
  byDecision: Map<string, A[]>;
  /** Every other action, in its original order. */
  remaining: A[];
}

export function joinNextActionsToAttention<A extends JoinableAction>(
  attentionDecisionIds: readonly string[],
  actions: readonly A[]
): JoinedNextActions<A> {
  const shown = new Set(attentionDecisionIds);
  const byDecision = new Map<string, A[]>();
  const remaining: A[] = [];
  for (const action of actions) {
    const id = action.decision?.id;
    if (id !== undefined && shown.has(id)) {
      const list = byDecision.get(id) ?? [];
      list.push(action);
      byDecision.set(id, list);
    } else {
      remaining.push(action);
    }
  }
  return { byDecision, remaining };
}
