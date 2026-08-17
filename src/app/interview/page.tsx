"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

interface Question {
  transactionId: string;
  ticker: string | null;
  category: string;
  facts: string;
  questionText: string;
}

export default function InterviewPage() {
  const guard = useSubmitGuard();
  const [session, setSession] = useState<{ sessionId: string; questions: Question[] } | null>(
    null
  );
  const [index, setIndex] = useState(0);
  const [answerDraft, setAnswerDraft] = useState("");
  const [answeredCount, setAnsweredCount] = useState(0);
  const [done, setDone] = useState(false);

  const start = trpc.interview.start.useMutation({
    onSuccess: (data) => {
      setSession(data);
      setIndex(0);
      setAnsweredCount(0);
      setDone(false);
    },
  });
  const answer = trpc.interview.answer.useMutation();
  const complete = trpc.interview.complete.useMutation({
    onSuccess: () => setDone(true),
  });

  const currentQuestion = session?.questions[index];

  async function submitAnswer(skip: boolean) {
    if (!session || !currentQuestion) return;

    // Shared key across Next/Skip on purpose — both advance the same
    // session state, so a rapid click on one while the other is still
    // in flight needs to be blocked too, not just a repeat of the same
    // button.
    await guard(async () => {
      if (!skip && answerDraft.trim() !== "") {
        await answer.mutateAsync({
          sessionId: session.sessionId,
          transactionId: currentQuestion.transactionId,
          questionText: currentQuestion.questionText,
          answerText: answerDraft.trim(),
        });
        setAnsweredCount((c) => c + 1);
      }

      setAnswerDraft("");
      if (index + 1 < session.questions.length) {
        setIndex(index + 1);
      } else {
        await complete.mutateAsync({ sessionId: session.sessionId });
      }
    }, "submitAnswer");
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Onboarding Interview</h1>
        <p className="text-sm text-neutral-500">
          A few questions about specific trades from your history — free-form answers, skip
          anything you don&apos;t want to go into. This is how the system starts learning how you
          actually think, not just what you traded.
        </p>
      </div>

      {!session && !start.isPending && (
        <button
          onClick={() => guard(() => start.mutateAsync())}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white"
        >
          Start interview
        </button>
      )}

      {start.isPending && <p className="text-sm">Preparing questions...</p>}
      {start.isError && <p className="text-sm text-red-600">{start.error.message}</p>}

      {session && !done && currentQuestion && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-neutral-500">
            Question {index + 1} of {session.questions.length}
            {currentQuestion.ticker ? ` — ${currentQuestion.ticker}` : ""}
          </p>
          <p className="text-lg font-medium">{currentQuestion.questionText}</p>
          <details className="text-xs text-neutral-500">
            <summary>Why you&apos;re being asked this</summary>
            <p className="mt-1">{currentQuestion.facts}</p>
          </details>
          <textarea
            className="min-h-32 rounded border border-neutral-300 p-2 text-sm"
            placeholder="Your answer..."
            value={answerDraft}
            onChange={(e) => setAnswerDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => submitAnswer(false)}
              disabled={answerDraft.trim() === "" || answer.isPending}
              className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {index + 1 < session.questions.length ? "Next" : "Finish"}
            </button>
            <button
              onClick={() => submitAnswer(true)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="text-sm">
          Interview complete — answered {answeredCount} of {session?.questions.length} question(s).
          These answers will feed into your Investor DNA hypotheses next.
        </p>
      )}
    </main>
  );
}
