"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";

const STRENGTH_LABEL: Record<string, string> = {
  insufficient_evidence: "Insufficient Evidence",
  weak: "Weak",
  moderate: "Moderate",
  strong: "Strong",
};

const STRENGTH_COLOR: Record<string, string> = {
  insufficient_evidence: "bg-neutral-200 text-neutral-600",
  weak: "bg-amber-100 text-amber-800",
  moderate: "bg-blue-100 text-blue-800",
  strong: "bg-green-100 text-green-800",
};

interface QualityPattern {
  insufficient_evidence: number;
  weak: number;
  reasonable: number;
  strong: number;
}

interface AccuracyPattern {
  confirmed: number;
  partially_confirmed: number;
  refuted: number;
  inconclusive: number;
  insufficient_evidence: number;
}

export default function LearningPage() {
  const utils = trpc.useUtils();
  const list = trpc.learning.list.useQuery();
  const generate = trpc.learning.generate.useMutation({
    onSuccess: () => utils.learning.list.invalidate(),
  });
  const agree = trpc.learning.agree.useMutation({
    onSuccess: () => {
      utils.learning.list.invalidate();
      setRespondingId(null);
    },
  });
  const disagree = trpc.learning.disagree.useMutation({
    onSuccess: () => {
      utils.learning.list.invalidate();
      setRespondingId(null);
    },
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const evidence = trpc.learning.evidence.useQuery(
    { learningInsightId: expandedId ?? "" },
    { enabled: expandedId !== null }
  );
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Learning Insights</h1>
        <p className="text-sm text-neutral-500">
          Patterns synthesized from your own reviewed decisions, grouped by sector — never from a
          single decision, always backed by evidence you can inspect. Agreeing feeds a new,
          honestly-thin DNA hypothesis; nothing here is presented as more certain than its evidence.
        </p>
      </div>

      <button
        onClick={() => generate.mutate()}
        disabled={generate.isPending}
        className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {generate.isPending ? "Analyzing reviewed decisions..." : "Generate insights from reviewed decisions"}
      </button>
      {generate.isError && <p className="text-sm text-red-600">{generate.error.message}</p>}
      {generate.isSuccess && (
        <p className="text-xs text-neutral-500">
          {generate.data.familiesConsidered} sector famil{generate.data.familiesConsidered === 1 ? "y" : "ies"}{" "}
          considered, {generate.data.createdCount} insight(s) created
          {generate.data.droppedCount > 0
            ? ` (${generate.data.droppedCount} proposed but dropped for lacking valid evidence)`
            : ""}
          .
        </p>
      )}

      <div className="flex flex-col gap-4">
        {list.data?.map((insight) => {
          const version = insight.versions[0];
          if (!version) return null;
          const qualityPattern = version.decisionQualityPatternJson as QualityPattern | null;
          const accuracyPattern = version.thesisAccuracyPatternJson as AccuracyPattern | null;

          return (
            <div key={insight.id} className="rounded border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {insight.family}
                  </span>
                  <p className="mt-1 font-medium">{version.statementText}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STRENGTH_COLOR[version.evidenceStrength]}`}>
                  {STRENGTH_LABEL[version.evidenceStrength]}
                </span>
              </div>

              {qualityPattern && (
                <p className="mt-2 text-xs text-neutral-500">
                  Decision quality across this family: {qualityPattern.strong} strong ·{" "}
                  {qualityPattern.reasonable} reasonable · {qualityPattern.weak} weak ·{" "}
                  {qualityPattern.insufficient_evidence} insufficient evidence
                </p>
              )}
              {accuracyPattern && (
                <p className="mt-1 text-xs text-neutral-500">
                  Thesis accuracy: {accuracyPattern.confirmed} confirmed · {accuracyPattern.partially_confirmed}{" "}
                  partial · {accuracyPattern.refuted} refuted · {accuracyPattern.inconclusive} inconclusive ·{" "}
                  {accuracyPattern.insufficient_evidence} insufficient evidence
                </p>
              )}

              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
                  className="text-xs underline"
                >
                  {expandedId === insight.id ? "Hide evidence" : "View evidence"}
                </button>
                <button
                  onClick={() => {
                    setRespondingId(insight.id);
                    setNote("");
                  }}
                  className="text-xs underline"
                >
                  Respond
                </button>
              </div>

              {expandedId === insight.id && evidence.data && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                  {evidence.data.map((e) => (
                    <li key={e.id}>
                      <span className={e.stance === "supporting" ? "text-green-700" : "text-red-700"}>
                        [{e.stance}]
                      </span>{" "}
                      {e.description}
                    </li>
                  ))}
                </ul>
              )}

              {respondingId === insight.id && (
                <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why do you agree or disagree?"
                    className="min-h-16 rounded border border-neutral-300 p-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => agree.mutate({ learningInsightId: insight.id, note })}
                      disabled={note.trim() === "" || agree.isPending}
                      className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Agree — add to my DNA
                    </button>
                    <button
                      onClick={() => disagree.mutate({ learningInsightId: insight.id, note })}
                      disabled={note.trim() === "" || disagree.isPending}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Disagree
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {list.data?.length === 0 && (
          <p className="text-sm text-neutral-500">
            No insights yet — review at least two decisions in the same sector, then generate.
          </p>
        )}
      </div>
    </main>
  );
}
