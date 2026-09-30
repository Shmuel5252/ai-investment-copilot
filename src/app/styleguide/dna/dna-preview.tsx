"use client";

import { DnaView } from "@/components/dna/dna-view";
import { EvidenceList } from "@/components/claims/evidence-disclosure";
import { loaded } from "@/components/home/types";
import { dnaPreviewData, DNA_PREVIEW_DECISIONS, DNA_PREVIEW_EVIDENCE, type DnaPreviewState } from "../dna-preview-data";

// The actions do nothing: the preview never calls a procedure or an AI.
export function DnaPreview({ state }: { state: DnaPreviewState }) {
  const data = dnaPreviewData(state);
  return (
    <DnaView
      statements={data.statements}
      reach={data.reach}
      actions={{
        generate: { run: () => undefined, pending: false, error: null, result: null },
        reject: { run: async () => false, pendingId: null, error: null },
      }}
      renderEvidence={(id) => <EvidenceList evidence={loaded(DNA_PREVIEW_EVIDENCE[id] ?? [])} decisions={DNA_PREVIEW_DECISIONS} />}
    />
  );
}
