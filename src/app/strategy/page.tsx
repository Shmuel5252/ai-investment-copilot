"use client";

import { useEffect, useRef, useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { ReachLine } from "@/components/evidence-reach";
import {
  strategyPage as t,
  evidenceStrengthLabel,
  evidenceStanceLabel,
  principleTypeLabel,
  principleTypeHint,
  nav,
} from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

const STRENGTH_COLOR: Record<string, string> = {
  insufficient_evidence: "bg-neutral-200 text-neutral-600",
  weak: "bg-amber-100 text-amber-800",
  moderate: "bg-blue-100 text-blue-800",
  strong: "bg-green-100 text-green-800",
};

export default function StrategyPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const list = trpc.strategy.list.useQuery();
  // Evidence Reach V1 — read-only transparency per observed principle.
  const reach = trpc.evidence.reach.useQuery();
  const reachById = new Map((reach.data?.claims ?? []).filter((c) => c.kind === "strategy_principle").map((c) => [c.id, c]));

  const ensureDefaults = trpc.strategy.ensureDefaults.useMutation({
    onSuccess: () => utils.strategy.list.invalidate(),
  });
  // Idempotent and free (no AI call) — safe to run once whenever the
  // page loads so "validated" baseline principles exist from the start.
  // Real idempotency is a DB-level unique constraint now (see
  // ensureDefaultRiskPrinciples), so a duplicate call here can no longer
  // duplicate data — this ref guard is only to avoid firing a pointless
  // second network request under React StrictMode's dev-only
  // double-invoke of mount effects, not a correctness requirement.
  const ensureDefaultsRan = useRef(false);
  useEffect(() => {
    if (ensureDefaultsRan.current) return;
    ensureDefaultsRan.current = true;
    ensureDefaults.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const proposeDeclared = trpc.strategy.proposeDeclared.useMutation();
  const confirmDeclared = trpc.strategy.confirmDeclared.useMutation({
    onSuccess: () => utils.strategy.list.invalidate(),
  });
  const generateObserved = trpc.strategy.generateObserved.useMutation({
    onSuccess: () => {
      utils.strategy.list.invalidate();
      utils.evidence.reach.invalidate();
    },
  });
  const approveVersion = trpc.strategy.approveVersion.useMutation({
    onSuccess: () => utils.strategy.list.invalidate(),
  });

  const [confirmedIds, setConfirmedIds] = useState<Set<number>>(new Set());
  const [changeSummary, setChangeSummary] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const evidence = trpc.strategy.evidence.useQuery(
    { strategyPrincipleId: expandedId ?? "" },
    { enabled: expandedId !== null }
  );

  type Principle = NonNullable<typeof list.data>["principles"][number];
  const principlesByType: Record<"declared" | "observed" | "validated", Principle[]> = {
    declared: [],
    observed: [],
    validated: [],
  };
  for (const p of list.data?.principles ?? []) {
    const version = p.versions[0];
    if (!version) continue;
    principlesByType[version.principleType].push(p);
  }

  return (
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 text-journal-ink`}
    >
      <BackLink href="/" label={nav.home} />

      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>{t.title}</h1>
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      {list.data?.latestVersion && (
        <p className="rounded border border-journal-rule bg-journal-bg p-3 text-xs text-journal-muted">
          {t.currentVersionLabel}
          <Num>{list.data.latestVersion.versionNumber}</Num> —{" "}
          {/* changeSummary is the investor's own free-text input, not UI
              chrome — never translated. */}
          {list.data.latestVersion.changeSummary} (
          <Num>{new Date(list.data.latestVersion.createdAt).toLocaleDateString("he-IL")}</Num>)
        </p>
      )}

      {/* Declared */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.declaredTitle}</h2>
        <button
          onClick={() => {
            setConfirmedIds(new Set());
            guard(() => proposeDeclared.mutateAsync());
          }}
          disabled={proposeDeclared.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {proposeDeclared.isPending ? t.readingAnswersButton : t.findDeclaredButton}
        </button>
        {proposeDeclared.isError && <p className="text-sm text-red-600">{proposeDeclared.error.message}</p>}
        {proposeDeclared.isSuccess && proposeDeclared.data.candidates.length === 0 && (
          <p className="text-xs text-journal-muted">{t.noExplicitRule}</p>
        )}
        {proposeDeclared.data?.candidates.map((c, i) => (
          <div key={i} className="rounded border border-journal-rule bg-journal-surface p-3">
            {/* statementText/rationaleText are AI-extracted from the
                investor's own interview answers — content, not chrome. */}
            <p className="text-sm">{c.statementText}</p>
            <p className="mt-1 text-xs text-journal-muted">{c.rationaleText}</p>
            {confirmedIds.has(i) ? (
              <p className="mt-2 text-xs text-green-700">{t.confirmedLabel}</p>
            ) : (
              <button
                onClick={async () => {
                  const result = await guard(() => confirmDeclared.mutateAsync(c), `declared-${i}`);
                  if (result) setConfirmedIds((s) => new Set(s).add(i));
                }}
                disabled={confirmDeclared.isPending}
                className="mt-2 rounded border border-journal-rule px-2 py-1 text-xs disabled:opacity-50"
              >
                {t.confirmButton}
              </button>
            )}
          </div>
        ))}
      </section>

      {/* Observed */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.observedTitle}</h2>
        <button
          onClick={() => guard(() => generateObserved.mutateAsync())}
          disabled={generateObserved.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generateObserved.isPending ? t.analyzingButton : t.generateObservedButton}
        </button>
        {generateObserved.isError && <p className="text-sm text-red-600">{generateObserved.error.message}</p>}
        {generateObserved.isSuccess && (
          <p className="text-xs text-journal-muted">
            <Num>{generateObserved.data.createdCount}</Num> {t.createdLabel}
            {generateObserved.data.droppedCount > 0 ? (
              <>
                {" "}
                {t.droppedPrefix}
                <Num>{generateObserved.data.droppedCount}</Num> {t.droppedSuffix}
              </>
            ) : null}
            .
          </p>
        )}
      </section>

      {/* All principles, grouped */}
      <section className="flex flex-col gap-6">
        {(["declared", "observed", "validated"] as const).map((type) => (
          <div key={type} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-journal-muted">
              {principleTypeLabel[type]} — {principleTypeHint[type]}
            </h3>
            {principlesByType[type]?.length === 0 && (
              <p className="text-xs text-journal-muted">{t.noneYet}</p>
            )}
            {principlesByType[type]?.map((p) => {
              const version = p.versions[0];
              if (!version) return null;
              return (
                <div key={p.id} className="rounded border border-journal-rule bg-journal-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    {/* statementText/rationaleText: AI-proposed or
                        user-declared content, not UI chrome. */}
                    <p className="font-medium">{version.statementText}</p>
                    {version.evidenceStrength && (
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-xs ${STRENGTH_COLOR[version.evidenceStrength]}`}
                      >
                        {evidenceStrengthLabel[version.evidenceStrength] ?? version.evidenceStrength}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-journal-muted">{version.rationaleText}</p>
                  {version.evidenceStrength && (
                    <p className="mt-1 text-xs text-journal-muted">
                      <Num>{version.supportingEvidenceCount}</Num> {t.supportingLabel} ·{" "}
                      <Num>{version.contradictingEvidenceCount}</Num> {t.contradictingLabel}
                    </p>
                  )}
                  {version.principleType === "observed" && <ReachLine reach={reachById.get(p.id)} />}
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="mt-2 text-xs text-journal-accent underline"
                  >
                    {expandedId === p.id ? t.hideEvidence : t.viewEvidence}
                  </button>
                  {expandedId === p.id && evidence.data && (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-journal-rule pt-2 text-xs text-journal-muted">
                      {evidence.data.length === 0 && <li>{t.noEvidenceRecorded}</li>}
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
          </div>
        ))}
      </section>

      {/* Approve whole-strategy version */}
      <section className="flex flex-col gap-3 border-t border-journal-rule pt-6">
        <h2 className="text-sm font-semibold">{t.approveTitle}</h2>
        <p className="text-xs text-journal-muted">{t.approveDescription}</p>
        <input
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          placeholder={t.changeSummaryPlaceholder}
          className="rounded border border-journal-rule bg-journal-surface p-2 text-sm"
        />
        <button
          onClick={() => guard(() => approveVersion.mutateAsync({ changeSummary }))}
          disabled={changeSummary.trim() === "" || approveVersion.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {approveVersion.isPending ? t.approvingButton : t.approveButton}
        </button>
        {approveVersion.isError && <p className="text-sm text-red-600">{approveVersion.error.message}</p>}
        {approveVersion.isSuccess && (
          <p className="text-xs text-green-700">
            {t.approvedAsLabel}
            <Num>{approveVersion.data.versionNumber}</Num>.
          </p>
        )}
      </section>
    </main>
  );
}
