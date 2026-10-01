"use client";

import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { LearningEvidence, LearningView, type LearningVersion } from "@/components/learning/learning-view";

// /learning — Frontend V1, unit 8. This file only runs the existing
// procedures; the page lives in src/components/learning. learning.generate,
// learning.agree and learning.disagree are called with their existing inputs;
// learning.evidence is read per insight, only once its evidence is opened.
export default function LearningPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const insights = trpc.learning.list.useQuery();
  const generate = trpc.learning.generate.useMutation({ onSuccess: () => utils.learning.list.invalidate() });
  const agree = trpc.learning.agree.useMutation();
  const disagree = trpc.learning.disagree.useMutation();

  return (
    <main>
      <LearningView
        insights={insights}
        actions={{
          generate: {
            run: () => void guard(() => generate.mutateAsync(), "generate-learning").catch(() => undefined),
            pending: generate.isPending,
            error: generate.error?.message ?? null,
            result: generate.data ?? null,
          },
          agree: async (input) => {
            const r = await agree.mutateAsync(input);
            return { replayed: r.replayed, carried: r.carried };
          },
          disagree: async (input) => {
            await disagree.mutateAsync(input);
          },
        }}
        renderEvidence={(id, version) => <InsightEvidence id={id} version={version} />}
      />
    </main>
  );
}

// Mounted only after an insight's evidence is opened, so the read happens then.
function InsightEvidence({ id, version }: { id: string; version: LearningVersion }) {
  const evidence = trpc.learning.evidence.useQuery({ learningInsightId: id });
  return <LearningEvidence version={version} evidence={evidence} />;
}
