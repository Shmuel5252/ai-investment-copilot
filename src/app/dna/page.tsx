"use client";

import { useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { ReachLine } from "@/components/evidence-reach";
import { dnaPage as t, evidenceStrengthLabel, evidenceStanceLabel, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

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
  // Evidence Reach V1 — read-only transparency per hypothesis (no AI, no write).
  const reach = trpc.evidence.reach.useQuery();
  const reachById = new Map((reach.data?.claims ?? []).filter((c) => c.kind === "dna_hypothesis").map((c) => [c.id, c]));
  const generate = trpc.dna.generate.useMutation({
    onSuccess: () => {
      utils.dna.list.invalidate();
      utils.evidence.reach.invalidate();
    },
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
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 text-journal-ink`}
    >
      <BackLink href="/" label={nav.home} />

      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>{t.title}</h1>
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      <button
        onClick={() => guard(() => generate.mutateAsync())}
        disabled={generate.isPending}
        className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {generate.isPending ? t.analyzingButton : t.generateButton}
      </button>
      {generate.isError && <p className="text-sm text-red-600">{generate.error.message}</p>}
      {generate.isSuccess && (
        <p className="text-xs text-journal-muted">
          <Num>{generate.data.createdCount}</Num> {t.createdLabel}
          {generate.data.droppedCount > 0 ? (
            <>
              {" "}
              {t.droppedPrefix}
              <Num>{generate.data.droppedCount}</Num> {t.droppedSuffix}
            </>
          ) : null}
          .
        </p>
      )}

      <div className="flex flex-col gap-4">
        {list.data?.map((h) => {
          const version = h.versions[0];
          if (!version) return null;
          return (
            <div key={h.id} className="rounded border border-journal-rule bg-journal-surface p-4">
              <div className="flex items-start justify-between gap-2">
                {/* statementText is AI-proposed from the investor's own
                    interview answers — content, not UI chrome, so it's
                    never translated. */}
                <p className="font-medium">{version.statementText}</p>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs ${STRENGTH_COLOR[version.evidenceStrength]}`}
                >
                  {evidenceStrengthLabel[version.evidenceStrength] ?? version.evidenceStrength}
                </span>
              </div>
              <p className="mt-1 text-xs text-journal-muted">
                <Num>{version.supportingEvidenceCount}</Num> {t.supportingLabel} ·{" "}
                <Num>{version.contradictingEvidenceCount}</Num> {t.contradictingLabel}
              </p>
              <ReachLine reach={reachById.get(h.id)} />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  className="text-xs text-journal-accent underline"
                >
                  {expandedId === h.id ? t.hideEvidence : t.viewEvidence}
                </button>
                <button
                  onClick={() => guard(() => reject.mutateAsync({ dnaHypothesisId: h.id }), h.id)}
                  className="text-xs text-red-600 underline"
                >
                  {t.disagree}
                </button>
              </div>
              {expandedId === h.id && evidence.data && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-journal-rule pt-2 text-xs text-journal-muted">
                  {evidence.data.map((e) => (
                    <li key={e.id}>
                      <span className={e.stance === "supporting" ? "text-green-700" : "text-red-700"}>
                        [{evidenceStanceLabel[e.stance] ?? e.stance}]
                      </span>{" "}
                      {e.description}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {list.data?.length === 0 && <p className="text-sm text-journal-muted">{t.noHypothesesYet}</p>}
      </div>
    </main>
  );
}
