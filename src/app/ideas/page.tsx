"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { IdeasView } from "@/components/ideas/ideas-view";

// /ideas — Frontend V1, unit 5. This file only runs the existing queries and
// mutations; the notebook lives in src/components/ideas. ideas.create and
// ideas.promote are called with their existing inputs, unchanged.
export default function IdeasPage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const ideas = trpc.ideas.list.useQuery();
  const cases = trpc.cases.list.useQuery();

  const create = trpc.ideas.create.useMutation({
    onSuccess: () => utils.ideas.list.invalidate(),
  });
  const promote = trpc.ideas.promote.useMutation({
    // Both lists are refetched before leaving, so going back shows the idea
    // as promoted and the new case in place.
    onSuccess: async (investmentCase) => {
      await Promise.all([utils.ideas.list.invalidate(), utils.cases.list.invalidate()]);
      router.push(`/cases/${investmentCase.id}`);
    },
  });

  return (
    <main>
      <IdeasView
        ideas={ideas}
        cases={cases}
        actions={{
          create: {
            run: async (ticker, noteText) => {
              try {
                return (await guard(() => create.mutateAsync({ ticker, noteText }), "create-idea")) !== undefined;
              } catch {
                return false;
              }
            },
            pending: create.isPending,
            error: create.error?.message ?? null,
          },
          promote: {
            run: (ideaId) => void guard(() => promote.mutateAsync({ ideaId }), `promote-${ideaId}`).catch(() => undefined),
            pendingIdeaId: promote.isPending ? (promote.variables?.ideaId ?? null) : null,
            error: promote.error && promote.variables ? { ideaId: promote.variables.ideaId, message: promote.error.message } : null,
          },
        }}
      />
    </main>
  );
}
