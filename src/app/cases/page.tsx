"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { CasesListView } from "@/components/case/cases-list-view";

// /cases — Frontend V1, unit 3. Existing queries only: the case list, and the
// next-actions engine for the stalled flag it already derives.
export default function CasesPage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const list = trpc.cases.list.useQuery();
  const nextActions = trpc.evidence.nextActions.useQuery();
  const create = trpc.cases.create.useMutation({
    onSuccess: (investmentCase) => {
      utils.cases.list.invalidate();
      router.push(`/cases/${investmentCase.id}`);
    },
  });

  const stalled = new Set((nextActions.data ?? []).filter((a) => a.kind === "CONTINUE_STALLED_CASE" && a.caseId).map((a) => a.caseId!));

  return (
    <main>
      <CasesListView
        cases={list}
        stalledCaseIds={stalled}
        create={{
          run: (ticker) => void guard(() => create.mutateAsync({ ticker })).catch(() => undefined),
          pending: create.isPending,
          error: create.error?.message ?? null,
        }}
      />
    </main>
  );
}
