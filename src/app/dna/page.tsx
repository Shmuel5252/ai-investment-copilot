"use client";

import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { DnaView } from "@/components/dna/dna-view";
import { EvidenceList } from "@/components/claims/evidence-disclosure";
import type { ClaimReach, DecisionRef } from "@/components/claims/types";
import type { Loadable } from "@/components/home/types";

// /dna — Frontend V1, unit 6A. This file only runs the existing queries and
// mutations; the page lives in src/components/dna and src/components/claims.
// dna.generate and dna.reject are called unchanged; dna.evidence is read per
// statement, only once its evidence is opened.
export default function DnaPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const statements = trpc.dna.list.useQuery();
  const reach = trpc.evidence.reach.useQuery();
  const decisions = trpc.decisions.list.useQuery();

  const refresh = () => Promise.all([utils.dna.list.invalidate(), utils.evidence.reach.invalidate()]);
  const generate = trpc.dna.generate.useMutation({ onSuccess: refresh });
  const reject = trpc.dna.reject.useMutation({ onSuccess: refresh });

  const reachById: Loadable<ReadonlyMap<string, ClaimReach>> = {
    ...reach,
    data: reach.data ? new Map(reach.data.claims.filter((c) => c.kind === "dna_hypothesis").map((c) => [c.id, c])) : undefined,
  };
  const decisionRefs: DecisionRef[] = decisions.data ?? [];

  return (
    <main>
      <DnaView
        statements={statements}
        reach={reachById}
        actions={{
          generate: {
            run: () => void guard(() => generate.mutateAsync(), "generate-dna").catch(() => undefined),
            pending: generate.isPending,
            error: generate.error?.message ?? null,
            result: generate.data ?? null,
          },
          reject: {
            run: async (dnaHypothesisId) => {
              try {
                return (await guard(() => reject.mutateAsync({ dnaHypothesisId }), `reject-${dnaHypothesisId}`)) !== undefined;
              } catch {
                return false;
              }
            },
            pendingId: reject.isPending ? (reject.variables?.dnaHypothesisId ?? null) : null,
            error: reject.error && reject.variables ? { id: reject.variables.dnaHypothesisId, message: reject.error.message } : null,
          },
        }}
        renderEvidence={(id) => <StatementEvidence id={id} decisions={decisionRefs} />}
      />
    </main>
  );
}

// Mounted only after a statement's evidence is opened, so the read happens then.
function StatementEvidence({ id, decisions }: { id: string; decisions: DecisionRef[] }) {
  const evidence = trpc.dna.evidence.useQuery({ dnaHypothesisId: id });
  return <EvidenceList evidence={evidence} decisions={decisions} />;
}
