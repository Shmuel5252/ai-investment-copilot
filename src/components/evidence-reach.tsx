"use client";

import { Num } from "@/components/num";
import { evidenceReach as t, evidenceStrengthLabel } from "@/lib/i18n/strings";

// Evidence Reach V1 — the per-claim transparency line under a DNA
// hypothesis / observed Strategy principle. Every value is a deterministic
// fact from evidence.reach (src/lib/evidence/reach.ts): which sources the
// claim cites, whether the AI currently uses it, and — only when the
// threshold table says so exactly — how many more INDEPENDENT supporting
// cases the next tier needs. "The AI does not use this" is never "this is
// false": the two are separated in the wording on purpose.
export interface ReachLineData {
  visibleToAi: boolean;
  sources: { interviewAnswers: number; decisionStatements: number };
  unresolvedDecisionIds: string[];
  distance: { nextTier: string; additionalSupportingCases: number } | null;
}

export function ReachLine({ reach }: { reach: ReachLineData | undefined }) {
  if (!reach) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-xs text-journal-muted">
      <p>
        {t.sourcesPrefix} <Num>{reach.sources.interviewAnswers}</Num> {t.interviewAnswers} · <Num>{reach.sources.decisionStatements}</Num> {t.decisionStatements}
      </p>
      <p className={reach.visibleToAi ? "text-green-700" : ""}>{reach.visibleToAi ? t.usedByAi : t.notUsedByAi}</p>
      {reach.distance && (
        <p>
          {t.distancePrefix} <Num>{reach.distance.additionalSupportingCases}</Num> {t.distanceMiddle} {evidenceStrengthLabel[reach.distance.nextTier] ?? reach.distance.nextTier}
          {" — "}
          {t.distanceNote}
        </p>
      )}
      {reach.unresolvedDecisionIds.length > 0 && (
        <p>
          <Num>{reach.unresolvedDecisionIds.length}</Num> {t.unresolvedSuffix}
        </p>
      )}
    </div>
  );
}
