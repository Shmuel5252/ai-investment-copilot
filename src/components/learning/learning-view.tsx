"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/status";
import { EmptyState, HelpText } from "@/components/ui/states";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { citedReviewsOfVersion } from "@/lib/learning/carry-to-dna";
import {
  dnaCreatedByLabel,
  evidenceStanceLabel,
  evidenceStrengthLabel,
  learningPage as t,
  reviewQualityLabel,
  thesisAccuracyLabel,
} from "@/lib/i18n/strings";

// /learning — Frontend V1 unit 8. A Learning insight is an AI-written
// CANDIDATE pattern over the investor's reviewed decisions in one sector:
// descriptive and evidence-bearing, never advice, a ranking, a verdict on the
// investor or a DNA claim by itself. Every judgment shown here comes from the
// backend unchanged:
//   - the statement and evidence descriptions are AI text, kept English as
//     generated (dir="ltr" lang="en", like the Review narrative);
//   - Evidence Strength is the code-computed tier, on a NEUTRAL badge;
//   - evidence is the CURRENT version's citations only, read from that
//     version's own provenance (citedReviewsOfVersion); a legacy version
//     without it shows every stored row, and says so;
//   - the two tallies count every reviewed decision of the sector, not the
//     insight's citations, and sit apart from the evidence.
// Agree / disagree results are shown for this visit only: the read contract
// does not say what was answered before, so nothing here claims it.

export interface LearningVersion {
  versionNumber: number;
  statementText: string;
  evidenceStrength: string;
  decisionQualityPatternJson?: unknown;
  thesisAccuracyPatternJson?: unknown;
  createdAt: string | Date;
  createdBy: string;
  provenanceJson?: unknown;
}

export interface LearningInsightRow {
  id: string;
  family: string;
  createdAt: string | Date;
  versions: LearningVersion[];
}

export interface LearningEvidenceRow {
  id: string;
  stance: "supporting" | "contradicting";
  decisionReviewId: string | null;
  description: string;
  createdAt: string | Date;
}

export interface LearningGenerateResult {
  familiesConsidered: number;
  createdCount: number;
  versionedCount: number;
  unchangedCount: number;
  droppedCount: number;
}

export interface LearningAgreeResult {
  replayed: boolean;
  carried: { cases: number; groundedCitations: number } | null;
}

export interface LearningActions {
  generate: { run: () => void; pending: boolean; error: string | null; result: LearningGenerateResult | null };
  /** Reject with the server error (its data.code is read). */
  agree: (input: { learningInsightId: string; note: string }) => Promise<LearningAgreeResult>;
  disagree: (input: { learningInsightId: string; note: string }) => Promise<void>;
}

const codeOf = (e: unknown) => (e as { data?: { code?: string } | null })?.data?.code;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One current insight per family. The list arrives newest first, and the
 * repository treats the newest identity of a family as the canonical one;
 * older identities of the same family are history, not parallel insights.
 * Server order is kept; nothing is re-ranked.
 */
export function currentInsights<T extends { family: string; versions: unknown[] }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (r.versions.length === 0 || seen.has(r.family)) return false;
    seen.add(r.family);
    return true;
  });
}

/**
 * The evidence rows the CURRENT version cites, by (review, stance), from the
 * version's own provenance. `legacy` = the version has no usable provenance,
 * so the rows cannot be split by version and are all returned as stored.
 */
export function currentVersionEvidence(version: Pick<LearningVersion, "provenanceJson">, rows: readonly LearningEvidenceRow[]): { legacy: boolean; rows: LearningEvidenceRow[] } {
  const cited = citedReviewsOfVersion({ provenanceJson: version.provenanceJson ?? null }, []);
  if (cited.length === 0) return { legacy: true, rows: [...rows] };
  const keys = new Set(cited.map((c) => `${c.decisionReviewId}::${c.stance}`));
  return { legacy: false, rows: rows.filter((r) => r.decisionReviewId !== null && keys.has(`${r.decisionReviewId}::${r.stance}`)) };
}

/** A tally object as written by the deterministic aggregation, or null if it is not one. */
function tally(json: unknown, keys: readonly string[]): Record<string, number> | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  return keys.every((k) => typeof o[k] === "number") ? (o as Record<string, number>) : null;
}
const QUALITY_KEYS = ["strong", "reasonable", "weak", "insufficient_evidence"] as const;
const ACCURACY_KEYS = ["confirmed", "partially_confirmed", "refuted", "inconclusive", "insufficient_evidence"] as const;

export function LearningView({
  insights,
  actions,
  renderEvidence,
}: {
  insights: Loadable<LearningInsightRow[]>;
  actions: LearningActions;
  /** Mounted only when an insight's evidence is opened, so the read happens then. */
  renderEvidence: (insightId: string, version: LearningVersion) => React.ReactNode;
}) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <GeneratePanel generate={actions.generate} />
      <section aria-labelledby="learning-list-title" className="flex flex-col gap-3">
        <h2 id="learning-list-title" className="text-base font-semibold text-ink">
          {t.listTitle}
        </h2>
        <RegionBody q={insights} lines={5}>
          {(rows) => {
            const current = currentInsights(rows);
            if (current.length === 0) {
              return (
                <EmptyState
                  title={t.emptyTitle}
                  action={
                    <ButtonLink href="/decisions" size="sm" variant="secondary">
                      {t.emptyLink}
                    </ButtonLink>
                  }
                >
                  {t.emptyBody}
                </EmptyState>
              );
            }
            return (
              <List label={t.listLabel}>
                {current.map((insight) => (
                  <InsightRow key={insight.id} insight={insight} version={insight.versions[0]!} actions={actions} renderEvidence={renderEvidence} />
                ))}
              </List>
            );
          }}
        </RegionBody>
      </section>
    </PageShell>
  );
}

function GeneratePanel({ generate }: { generate: LearningActions["generate"] }) {
  const r = generate.result;
  const nothingNew = r !== null && r.createdCount === 0 && r.versionedCount === 0;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">{t.generateTitle}</h2>
        <HelpText>{t.generateHint}</HelpText>
        <Button variant="secondary" className="w-fit" onClick={generate.run} loading={generate.pending} loadingLabel={t.generatingButton}>
          {t.generateButton}
        </Button>
        {r && (
          <p role="status" className="text-sm text-ink-2">
            {nothingNew && <span className="block">{t.resultNothingNew}</span>}
            <Num>{r.familiesConsidered}</Num> {t.resultConsidered} · <Num>{r.createdCount}</Num> {t.resultCreated} · <Num>{r.versionedCount}</Num> {t.resultVersioned} ·{" "}
            <Num>{r.unchangedCount}</Num> {t.resultUnchanged} · <Num>{r.droppedCount}</Num> {t.resultDropped}
          </p>
        )}
        <ActionError message={generate.error} />
      </div>
    </Card>
  );
}

function InsightRow({
  insight,
  version,
  actions,
  renderEvidence,
}: {
  insight: LearningInsightRow;
  version: LearningVersion;
  actions: LearningActions;
  renderEvidence: (insightId: string, version: LearningVersion) => React.ReactNode;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  return (
    <ListRow actionsBelow>
      <article className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {t.sectorLabel} <Num>{insight.family}</Num>
          </p>
          <Badge tone="neutral" title={t.strengthTitle}>
            <span className="text-muted">Evidence Strength:</span> {evidenceStrengthLabel[version.evidenceStrength] ?? version.evidenceStrength}
          </Badge>
        </div>

        <div className="flex flex-col gap-1.5">
          <p dir="ltr" lang="en" className="text-start text-sm leading-relaxed text-ink">
            {version.statementText}
          </p>
          <HelpText>{t.statementNote}</HelpText>
        </div>

        <p className="text-xs text-muted">
          {t.versionPrefix} <Num>{version.versionNumber}</Num> · <Num>{day(version.createdAt)}</Num> · {version.createdBy === "ai_generated" ? t.aiAuthored : (dnaCreatedByLabel[version.createdBy] ?? version.createdBy)}
        </p>

        <Disclosure summary={t.evidenceSummary} className="border-t border-rule pt-2" onToggle={(open) => open && setEvidenceOpen(true)}>
          {evidenceOpen && renderEvidence(insight.id, version)}
        </Disclosure>

        <SectorTallies version={version} />

        <Respond insightId={insight.id} actions={actions} />
      </article>
    </ListRow>
  );
}

/** The evidence of one insight's CURRENT version; the page passes the loaded rows. */
export function LearningEvidence({ version, evidence }: { version: Pick<LearningVersion, "provenanceJson">; evidence: Loadable<LearningEvidenceRow[]> }) {
  return (
    <RegionBody q={evidence} lines={2}>
      {(all) => {
        const { legacy, rows } = currentVersionEvidence(version, all);
        return (
          <div className="flex flex-col gap-3">
            <HelpText>{t.evidenceNote}</HelpText>
            {legacy && <Notice tone="neutral">{t.evidenceLegacy}</Notice>}
            {rows.length === 0 ? (
              <HelpText>{t.evidenceNone}</HelpText>
            ) : (
              <ul className="flex flex-col divide-y divide-rule">
                {rows.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{evidenceStanceLabel[e.stance] ?? e.stance}</Badge>
                      <span className="text-xs text-muted">
                        {t.evidenceSavedOn}
                        <Num>{day(e.createdAt)}</Num>
                      </span>
                    </div>
                    <p dir="ltr" lang="en" className="text-start text-sm leading-relaxed text-ink-2">
                      {e.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </RegionBody>
  );
}

// Sector-wide counts, closed by default and placed after the evidence, so they
// never read as the insight's support.
function SectorTallies({ version }: { version: LearningVersion }) {
  const quality = tally(version.decisionQualityPatternJson, QUALITY_KEYS);
  const accuracy = tally(version.thesisAccuracyPatternJson, ACCURACY_KEYS);
  if (!quality && !accuracy) return null;
  const line = (counts: Record<string, number>, keys: readonly string[], labels: Record<string, string>) =>
    keys.map((k, i) => (
      <span key={k}>
        {i > 0 && " · "}
        {labels[k] ?? k} <Num>{counts[k]}</Num>
      </span>
    ));
  return (
    <Disclosure summary={t.talliesSummary}>
      <HelpText>{t.talliesNote}</HelpText>
      {quality && (
        <p className="text-sm text-ink-2">
          <span className="font-semibold">{t.qualityLabel}:</span> {line(quality, QUALITY_KEYS, reviewQualityLabel)}
        </p>
      )}
      {accuracy && (
        <p className="text-sm text-ink-2">
          <span className="font-semibold">{t.accuracyLabel}:</span> {line(accuracy, ACCURACY_KEYS, thesisAccuracyLabel)}
        </p>
      )}
    </Disclosure>
  );
}

type Outcome =
  | { kind: "carried"; cases: number; statements: number }
  | { kind: "replayed" }
  | { kind: "disagreed" }
  | { kind: "refused"; message: string }
  | { kind: "uncheckable"; message: string }
  | { kind: "failed"; message: string };

function Respond({ insightId, actions }: { insightId: string; actions: LearningActions }) {
  const guard = useSubmitGuard();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<null | "agree" | "disagree">(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const blank = note.trim() === "";

  async function submit(kind: "agree" | "disagree") {
    if (blank || pending) return;
    await guard(async () => {
      setPending(kind);
      setOutcome(null);
      try {
        if (kind === "agree") {
          const r = await actions.agree({ learningInsightId: insightId, note });
          setOutcome(r.replayed ? { kind: "replayed" } : { kind: "carried", cases: r.carried?.cases ?? 0, statements: r.carried?.groundedCitations ?? 0 });
        } else {
          await actions.disagree({ learningInsightId: insightId, note });
          setOutcome({ kind: "disagreed" });
        }
        setNote("");
        setOpen(false);
      } catch (e) {
        // the typed note stays; the form stays open
        const code = kind === "agree" ? codeOf(e) : undefined;
        setOutcome(
          code === "BAD_REQUEST"
            ? { kind: "refused", message: messageOf(e) }
            : code === "SERVICE_UNAVAILABLE"
              ? { kind: "uncheckable", message: messageOf(e) }
              : { kind: "failed", message: messageOf(e) }
        );
      } finally {
        setPending(null);
      }
    }, `respond-${insightId}`);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      {!open && (
        <Button size="sm" variant="quiet" className="w-fit" onClick={() => setOpen(true)}>
          {t.respondButton}
        </Button>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <Field label={t.noteLabel} help={t.noteHelp} required>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <HelpText>{t.agreeExplain}</HelpText>
          <HelpText>{t.disagreeExplain}</HelpText>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="sm" variant="secondary" disabled={blank || pending !== null} loading={pending === "agree"} loadingLabel={t.agreeing} onClick={() => void submit("agree")}>
              {t.agreeButton}
            </Button>
            <Button size="sm" variant="secondary" disabled={blank || pending !== null} loading={pending === "disagree"} loadingLabel={t.disagreeing} onClick={() => void submit("disagree")}>
              {t.disagreeButton}
            </Button>
            <Button size="sm" variant="quiet" disabled={pending !== null} onClick={() => setOpen(false)}>
              {t.respondCancel}
            </Button>
          </div>
        </div>
      )}
      {outcome && <OutcomeNotice outcome={outcome} />}
    </div>
  );
}

function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case "carried":
      return (
        <Notice tone="info" title={t.carriedTitle}>
          <span className="flex flex-col items-start gap-2">
            <span>
              {t.carriedBodyPrefix} <Num>{outcome.cases}</Num> {t.carriedBodyCases} <Num>{outcome.statements}</Num> {t.carriedBodyStatements}
            </span>
            <ButtonLink href="/dna" size="sm" variant="quiet">
              {t.toDna}
            </ButtonLink>
          </span>
        </Notice>
      );
    case "replayed":
      return (
        <Notice tone="neutral" title={t.replayedTitle}>
          {t.replayedBody}
        </Notice>
      );
    case "disagreed":
      return (
        <Notice tone="neutral" title={t.disagreedTitle}>
          {t.disagreedBody}
        </Notice>
      );
    case "refused":
      return (
        <Notice tone="caution" title={t.refusedTitle}>
          <span className="flex flex-col gap-1">
            <span>{t.refusedBody}</span>
            <bdi dir="ltr" className="text-xs">
              {outcome.message}
            </bdi>
          </span>
        </Notice>
      );
    case "uncheckable":
      return (
        <Notice tone="caution" title={t.uncheckableTitle}>
          <span className="flex flex-col gap-1">
            <span>{t.uncheckableBody}</span>
            <bdi dir="ltr" className="text-xs">
              {outcome.message}
            </bdi>
          </span>
        </Notice>
      );
    case "failed":
      return (
        <Notice tone="negative" title={t.failedTitle}>
          <span className="flex flex-col gap-1">
            <span>{t.failedBody}</span>
            {outcome.message && (
              <bdi dir="ltr" className="text-xs">
                {outcome.message}
              </bdi>
            )}
          </span>
        </Notice>
      );
  }
}
