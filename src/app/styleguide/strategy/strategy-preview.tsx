"use client";

import { StrategyView } from "@/components/strategy/strategy-view";
import { EvidenceList } from "@/components/claims/evidence-disclosure";
import { loaded } from "@/components/home/types";
import { DNA_PREVIEW_DECISIONS } from "../dna-preview-data";
import { strategyPreviewData, STRATEGY_PREVIEW_EVIDENCE, type StrategyPreviewState } from "../strategy-preview-data";

// The actions do nothing: the preview never calls a procedure or an AI.
export function StrategyPreview({ state }: { state: StrategyPreviewState }) {
  const data = strategyPreviewData(state);
  return (
    <StrategyView
      strategy={data.strategy}
      reach={data.reach}
      actions={{
        approve: { run: async () => false, pending: false, error: null, approvedVersionNumber: null },
        propose: { run: () => undefined, pending: false, error: null, candidates: data.candidates, runId: 0 },
        confirm: { run: async () => false, pendingIndex: null, error: null },
        generate: { run: () => undefined, pending: false, error: null, result: null },
      }}
      renderEvidence={(id) => <EvidenceList evidence={loaded(STRATEGY_PREVIEW_EVIDENCE[id] ?? [])} decisions={DNA_PREVIEW_DECISIONS} />}
    />
  );
}
