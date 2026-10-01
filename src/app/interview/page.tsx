"use client";

import { trpc } from "@/trpc/react";
import { InterviewView, type InterviewActions } from "@/components/interview/interview-view";

// /interview — Frontend V1, unit 7C-F. This file only runs the existing
// procedures; the guided interview lives in src/components/interview.
// interview.start, interview.answer (with the opaque anchorContextHash) and
// interview.complete are called with their existing inputs. import.history
// answers "is there any history at all" before anything is started.
export default function InterviewPage() {
  const history = trpc.import.history.useQuery();
  const start = trpc.interview.start.useMutation();
  const answer = trpc.interview.answer.useMutation();
  const complete = trpc.interview.complete.useMutation();

  const actions: InterviewActions = {
    start: async () => {
      const r = await start.mutateAsync();
      return {
        sessionId: r.sessionId,
        questions: r.questions.map((q) => ({
          anchor: { transactionId: q.anchor.transactionId, ticker: q.anchor.ticker, date: q.anchor.date, role: q.anchor.role },
          factsLine: q.factsLine,
          questionText: q.questionText,
          questionSource: q.questionSource,
          anchorContextHash: q.anchorContextHash,
        })),
      };
    },
    answer: async (input) => {
      await answer.mutateAsync(input);
    },
    complete: async (sessionId) => {
      await complete.mutateAsync({ sessionId });
    },
  };

  return (
    <main>
      <InterviewView history={history} actions={actions} />
    </main>
  );
}
