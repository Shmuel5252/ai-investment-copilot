// Investment Episode Independence design — the ONE shared function
// src/server/routers/dna.ts (generate) and src/server/routers/strategy.ts
// (generateObserved) both call to build the case-key map that feeds
// validateProposedHypotheses()/validateProposedObservedPrinciples() and,
// through them, countIndependentCases(). This replaces the old
// `new Map(answers.map(a => [a.id, a.transactionId ?? a.id]))` that keyed
// by raw transactionId — the real gap this whole design fixes: several
// InterviewAnswers anchored to different transactions of ONE continuous
// investment episode (e.g. MP's BUY, partial SELL, final SELL) must
// collapse to one independent case, not several.
//
// Two rules, both load-bearing, neither touched by this design:
//   1. transactionId === null (a general/onboarding answer not anchored
//      to any specific transaction) -> case key = the answer's own id,
//      exactly as before this design existed. Never routed through
//      episode lookup at all.
//   2. transactionId set, but not found in episodeKeyByTransactionId
//      (the transaction wasn't resolvable to a real episode — shouldn't
//      normally happen for a real, persisted transaction, but conservative
//      either way) -> a single, fixed, GLOBAL sentinel key, never the raw
//      transactionId. Every such unmapped citation across one call
//      collapses to ONE shared case, contributing at most 1 to any count
//      — never silently reverts to the old, one-case-per-transaction
//      behavior this design exists to fix.
export const UNMAPPED_EPISODE_SENTINEL = "__unmapped__";

export interface CaseKeyableAnswer {
  id: string;
  transactionId: string | null;
}

export function buildAnswerCaseKeys(
  answers: readonly CaseKeyableAnswer[],
  episodeKeyByTransactionId: ReadonlyMap<string, string>
): Map<string, string> {
  const result = new Map<string, string>();

  for (const answer of answers) {
    if (answer.transactionId === null) {
      result.set(answer.id, answer.id);
      continue;
    }
    result.set(
      answer.id,
      episodeKeyByTransactionId.get(answer.transactionId) ?? UNMAPPED_EPISODE_SENTINEL
    );
  }

  return result;
}
