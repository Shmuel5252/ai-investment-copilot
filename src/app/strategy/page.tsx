"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { StrategyView } from "@/components/strategy/strategy-view";
import { EvidenceList } from "@/components/claims/evidence-disclosure";
import type { ClaimReach, DecisionRef } from "@/components/claims/types";
import type { Loadable } from "@/components/home/types";

// /strategy — Frontend V1, unit 6B. This file only runs the existing queries
// and mutations; the page lives in src/components/strategy, and observed
// principles reuse the unit 6A claims layer. Every mutation is called with
// its existing input, unchanged.
export default function StrategyPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const strategy = trpc.strategy.list.useQuery();
  const reach = trpc.evidence.reach.useQuery();
  const decisions = trpc.decisions.list.useQuery();

  const ensureDefaults = trpc.strategy.ensureDefaults.useMutation({
    onSuccess: () => utils.strategy.list.invalidate(),
  });
  // Idempotent and free (no AI call) — safe to run once whenever the
  // page loads so "validated" baseline principles exist from the start.
  // Real idempotency is a DB-level unique constraint (see
  // ensureDefaultRiskPrinciples), so a duplicate call can never duplicate
  // data — this ref guard only avoids a pointless second request under
  // React StrictMode's dev-only double-invoke of mount effects.
  const ensureDefaultsRan = useRef(false);
  useEffect(() => {
    if (ensureDefaultsRan.current) return;
    ensureDefaultsRan.current = true;
    ensureDefaults.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => Promise.all([utils.strategy.list.invalidate(), utils.evidence.reach.invalidate()]);
  const approve = trpc.strategy.approveVersion.useMutation({ onSuccess: () => utils.strategy.list.invalidate() });
  // Each successful proposal run gets a new id, so its candidate edits start fresh.
  const [proposalRun, setProposalRun] = useState(0);
  const propose = trpc.strategy.proposeDeclared.useMutation({ onSuccess: () => setProposalRun((n) => n + 1) });
  const confirm = trpc.strategy.confirmDeclared.useMutation({ onSuccess: () => utils.strategy.list.invalidate() });
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState<{ index: number; message: string } | null>(null);
  const generate = trpc.strategy.generateObserved.useMutation({ onSuccess: refresh });

  const reachById: Loadable<ReadonlyMap<string, ClaimReach>> = {
    ...reach,
    data: reach.data ? new Map(reach.data.claims.filter((c) => c.kind === "strategy_principle").map((c) => [c.id, c])) : undefined,
  };
  const decisionRefs: DecisionRef[] = decisions.data ?? [];
  const saved = async (run: () => Promise<unknown>, key: string) => {
    try {
      return (await guard(run, key)) !== undefined;
    } catch {
      return false;
    }
  };

  return (
    <main>
      <StrategyView
        strategy={strategy}
        reach={reachById}
        actions={{
          approve: {
            run: (changeSummary) => saved(() => approve.mutateAsync({ changeSummary }), "approve-strategy"),
            pending: approve.isPending,
            error: approve.error?.message ?? null,
            approvedVersionNumber: approve.data?.versionNumber ?? null,
          },
          propose: {
            run: () => void guard(() => propose.mutateAsync(), "propose-declared").catch(() => undefined),
            pending: propose.isPending,
            error: propose.error?.message ?? null,
            candidates: propose.data?.candidates ?? null,
            runId: proposalRun,
          },
          confirm: {
            run: async (index, candidate) => {
              setConfirmingIndex(index);
              setConfirmError(null);
              try {
                const ok = (await guard(() => confirm.mutateAsync(candidate), `declared-${proposalRun}-${index}`)) !== undefined;
                return ok;
              } catch (err) {
                setConfirmError({ index, message: err instanceof Error ? err.message : String(err) });
                return false;
              } finally {
                setConfirmingIndex(null);
              }
            },
            pendingIndex: confirmingIndex,
            error: confirmError,
          },
          generate: {
            run: () => void guard(() => generate.mutateAsync(), "generate-observed").catch(() => undefined),
            pending: generate.isPending,
            error: generate.error?.message ?? null,
            result: generate.data ?? null,
          },
        }}
        renderEvidence={(id) => <PrincipleEvidence id={id} decisions={decisionRefs} />}
      />
    </main>
  );
}

// Mounted only after a principle's evidence is opened, so the read happens then.
function PrincipleEvidence({ id, decisions }: { id: string; decisions: DecisionRef[] }) {
  const evidence = trpc.strategy.evidence.useQuery({ strategyPrincipleId: id });
  return <EvidenceList evidence={evidence} decisions={decisions} />;
}
