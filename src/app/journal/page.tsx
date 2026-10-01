"use client";

import { trpc } from "@/trpc/react";
import { JournalView } from "@/components/journal/journal-view";
import type { RationaleActions } from "@/components/journal/rationale-writer";

// /journal — Frontend V1, unit 7A. This file only runs the existing
// procedures; the Journal lives in src/components/journal. interview.journal
// is the hindsight-safe projection (later facts withheld server-side until a
// rationale exists). Writing is the existing "Tell me why" contract,
// unchanged: startTellMeWhy, answer, complete.
export default function JournalPage() {
  const utils = trpc.useUtils();
  const journal = trpc.interview.journal.useQuery();
  const start = trpc.interview.startTellMeWhy.useMutation();
  const answer = trpc.interview.answer.useMutation();
  const complete = trpc.interview.complete.useMutation();

  const refetch = () => Promise.all([utils.interview.journal.invalidate(), utils.interview.journalCoverage.invalidate()]);

  const actions: RationaleActions = {
    start: async (transactionId) => {
      const r = await start.mutateAsync({ transactionId });
      return { sessionId: r.sessionId, transactionId: r.transactionId, questionText: r.questionText, anchorContextHash: r.anchorContextHash };
    },
    save: async ({ session, answerText, supersedesAnswerId }) => {
      try {
        await answer.mutateAsync({
          sessionId: session.sessionId,
          transactionId: session.transactionId,
          questionText: session.questionText,
          answerText,
          supersedesAnswerId,
          anchorContextHash: session.anchorContextHash,
        });
      } catch (e) {
        // A failed answer may still have been written (a lost response), so
        // the Journal is refetched to show what the server actually holds.
        await refetch();
        throw e;
      }
      // The answer is saved. Marking the session complete is bookkeeping no
      // reader depends on; a failure here must not send the answer again.
      await complete.mutateAsync({ sessionId: session.sessionId }).catch(() => undefined);
      await refetch();
    },
  };

  return (
    <main>
      <JournalView journal={journal} actions={actions} />
    </main>
  );
}
