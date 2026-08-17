"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

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

export default function DnaPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const list = trpc.dna.list.useQuery();
  const generate = trpc.dna.generate.useMutation({
    onSuccess: () => utils.dna.list.invalidate(),
  });
  const reject = trpc.dna.reject.useMutation({
    onSuccess: () => utils.dna.list.invalidate(),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const evidence = trpc.dna.evidence.useQuery(
    { dnaHypothesisId: expandedId ?? "" },
    { enabled: expandedId !== null }
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Investor DNA</h1>
        <p className="text-sm text-neutral-500">
          Hypotheses about how you think and behave as an investor — proposed by AI from your
          onboarding interview, but only ever backed by evidence you can inspect. Nothing here is
          presented as proven; weak or thin patterns are labeled as such.
        </p>
      </div>

      <button
        onClick={() => guard(() => generate.mutateAsync())}
        disabled={generate.isPending}
        className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {generate.isPending ? "Analyzing interview answers..." : "Generate hypotheses from interview"}
      </button>
      {generate.isError && <p className="text-sm text-red-600">{generate.error.message}</p>}
      {generate.isSuccess && (
        <p className="text-xs text-neutral-500">
          {generate.data.createdCount} hypothesis(es) created
          {generate.data.droppedCount > 0
            ? ` (${generate.data.droppedCount} proposed but dropped for lacking valid evidence)`
            : ""}
          .
        </p>
      )}

      <div className="flex flex-col gap-4">
        {list.data?.map((h) => {
          const version = h.versions[0];
          if (!version) return null;
          return (
            <div key={h.id} className="rounded border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{version.statementText}</p>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs ${STRENGTH_COLOR[version.evidenceStrength]}`}
                >
                  {STRENGTH_LABEL[version.evidenceStrength]}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {version.supportingEvidenceCount} supporting · {version.contradictingEvidenceCount}{" "}
                contradicting
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="text-xs underline"
                >
                  {expandedId === h.id ? "Hide evidence" : "View evidence"}
                </button>
                <button
                  onClick={() => guard(() => reject.mutateAsync({ dnaHypothesisId: h.id }), h.id)}
                  className="text-xs text-red-600 underline"
                >
                  Disagree
                </button>
              </div>
              {expandedId === h.id && evidence.data && (
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
            </div>
          );
        })}
        {list.data?.length === 0 && (
          <p className="text-sm text-neutral-500">
            No hypotheses yet — complete the onboarding interview, then generate some.
          </p>
        )}
      </div>
    </main>
  );
}
