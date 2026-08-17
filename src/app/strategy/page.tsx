"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/trpc/react";

const TYPE_LABEL: Record<string, string> = {
  declared: "Declared",
  observed: "Observed",
  validated: "Validated",
};

const TYPE_HINT: Record<string, string> = {
  declared: "You said this yourself in the interview.",
  observed: "A pattern the system noticed — still being tested.",
  validated: "A fixed baseline risk guardrail, not learned from you.",
};

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

export default function StrategyPage() {
  const utils = trpc.useUtils();
  const list = trpc.strategy.list.useQuery();

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
    onSuccess: () => utils.strategy.list.invalidate(),
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
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Baseline Strategy</h1>
        <p className="text-sm text-neutral-500">
          Three kinds of principles, kept visibly separate: what you told us directly (Declared),
          patterns the system is still testing (Observed), and fixed baseline risk guardrails
          (Validated). Nothing here is presented as more certain than its source.
        </p>
      </div>

      {list.data?.latestVersion && (
        <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          Current strategy version: v{list.data.latestVersion.versionNumber} —{" "}
          {list.data.latestVersion.changeSummary} (
          {new Date(list.data.latestVersion.createdAt).toLocaleDateString()})
        </p>
      )}

      {/* Declared */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Declared principles</h2>
        <button
          onClick={() => {
            setConfirmedIds(new Set());
            proposeDeclared.mutate();
          }}
          disabled={proposeDeclared.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {proposeDeclared.isPending ? "Reading interview answers..." : "Find declared rules from interview"}
        </button>
        {proposeDeclared.isError && <p className="text-sm text-red-600">{proposeDeclared.error.message}</p>}
        {proposeDeclared.isSuccess && proposeDeclared.data.candidates.length === 0 && (
          <p className="text-xs text-neutral-500">
            No explicit rule found in your interview answers yet — that&apos;s a normal result, not
            an error.
          </p>
        )}
        {proposeDeclared.data?.candidates.map((c, i) => (
          <div key={i} className="rounded border border-neutral-200 p-3">
            <p className="text-sm">{c.statementText}</p>
            <p className="mt-1 text-xs text-neutral-500">{c.rationaleText}</p>
            {confirmedIds.has(i) ? (
              <p className="mt-2 text-xs text-green-700">Confirmed.</p>
            ) : (
              <button
                onClick={async () => {
                  await confirmDeclared.mutateAsync(c);
                  setConfirmedIds((s) => new Set(s).add(i));
                }}
                disabled={confirmDeclared.isPending}
                className="mt-2 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
              >
                Confirm — yes, this is my rule
              </button>
            )}
          </div>
        ))}
      </section>

      {/* Observed */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Observed principles</h2>
        <button
          onClick={() => generateObserved.mutate()}
          disabled={generateObserved.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {generateObserved.isPending ? "Analyzing interview answers..." : "Generate observed principles"}
        </button>
        {generateObserved.isError && <p className="text-sm text-red-600">{generateObserved.error.message}</p>}
        {generateObserved.isSuccess && (
          <p className="text-xs text-neutral-500">
            {generateObserved.data.createdCount} principle(s) created
            {generateObserved.data.droppedCount > 0
              ? ` (${generateObserved.data.droppedCount} proposed but dropped for lacking valid evidence)`
              : ""}
            .
          </p>
        )}
      </section>

      {/* All principles, grouped */}
      <section className="flex flex-col gap-6">
        {(["declared", "observed", "validated"] as const).map((type) => (
          <div key={type} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {TYPE_LABEL[type]} — {TYPE_HINT[type]}
            </h3>
            {principlesByType[type]?.length === 0 && (
              <p className="text-xs text-neutral-400">None yet.</p>
            )}
            {principlesByType[type]?.map((p) => {
              const version = p.versions[0];
              if (!version) return null;
              return (
                <div key={p.id} className="rounded border border-neutral-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{version.statementText}</p>
                    {version.evidenceStrength && (
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-xs ${STRENGTH_COLOR[version.evidenceStrength]}`}
                      >
                        {STRENGTH_LABEL[version.evidenceStrength]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{version.rationaleText}</p>
                  {version.evidenceStrength && (
                    <p className="mt-1 text-xs text-neutral-500">
                      {version.supportingEvidenceCount} supporting ·{" "}
                      {version.contradictingEvidenceCount} contradicting
                    </p>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="mt-2 text-xs underline"
                  >
                    {expandedId === p.id ? "Hide evidence" : "View evidence"}
                  </button>
                  {expandedId === p.id && evidence.data && (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                      {evidence.data.length === 0 && <li>No evidence recorded.</li>}
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
          </div>
        ))}
      </section>

      {/* Approve whole-strategy version */}
      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold">Approve baseline strategy</h2>
        <p className="text-xs text-neutral-500">
          Bundles every principle above (as it stands right now) into a new, versioned Strategy —
          nothing here is ever silently rewritten later, only superseded by a new approved version.
        </p>
        <input
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          placeholder="e.g. Initial baseline strategy"
          className="rounded border border-neutral-300 p-2 text-sm"
        />
        <button
          onClick={() => approveVersion.mutate({ changeSummary })}
          disabled={changeSummary.trim() === "" || approveVersion.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {approveVersion.isPending ? "Approving..." : "Approve as new strategy version"}
        </button>
        {approveVersion.isError && <p className="text-sm text-red-600">{approveVersion.error.message}</p>}
        {approveVersion.isSuccess && (
          <p className="text-xs text-green-700">
            Approved as v{approveVersion.data.versionNumber}.
          </p>
        )}
      </section>
    </main>
  );
}
