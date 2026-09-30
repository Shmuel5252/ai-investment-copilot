"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { KeyValues } from "@/components/ui/table";
import { Notice } from "@/components/ui/status";
import { EmptyState, HelpText } from "@/components/ui/states";
import {
  citedFieldLabel,
  decisionPage as t,
  predictionKindLabel,
  predictionStatusLabel,
  reentryCondition,
  reviewDimensionLabel,
  reviewQualityLabel,
  thesisAccuracyLabel,
} from "@/lib/i18n/strings";
import { ActionError, Disclosure, dateTime, day, labelOf, signedPct, usd } from "./parts";
import type { DecisionAction, PendingPrediction, Resolution, ReviewOutcome, ReviewRow } from "./types";

// H — the retrospective. Every stored Review keeps three separate things
// apart: the quality of the process (the deterministic rollup of the seven
// dimension verdicts), the accuracy of the thesis (from the investor's own
// resolutions) and the outcome (arithmetic frozen at that review's time).
// All verdicts are display labels in neutral badges: a verdict on a past
// decision is never colored as success or failure. The narrative and the
// rationales are shown in the language they were stored in.

type Status = Resolution["status"];

// The generic status words a forecast resolution uses; a condition is
// resolved in its own words.
const FORECAST_OPTIONS: [Status, string][] = [
  ["confirmed", predictionStatusLabel.confirmed!],
  ["refuted", predictionStatusLabel.refuted!],
  ["inconclusive", predictionStatusLabel.inconclusive!],
];
const CONDITION_OPTIONS: [Status, string][] = [
  ["confirmed", reentryCondition.fired],
  ["refuted", reentryCondition.notFired],
  ["inconclusive", reentryCondition.undetermined],
];

export function ReviewRegion({
  decisionType,
  reviews,
  pending,
  run,
  disagree,
}: {
  decisionType: string;
  reviews: ReviewRow[];
  pending: PendingPrediction[];
  run: DecisionAction<[resolutions: Resolution[]]>;
  disagree: DecisionAction<[dimensionId: string, text: string]>;
}) {
  const [resolutions, setResolutions] = useState<Record<string, { status: Status | null; note: string }>>({});
  const set = (id: string, patch: Partial<{ status: Status | null; note: string }>) =>
    setResolutions((r) => ({ ...r, [id]: { status: r[id]?.status ?? null, note: r[id]?.note ?? "", ...patch } }));
  // The same submit test the page always used: every pending prediction needs a status and a note.
  const ready = pending.every((p) => resolutions[p.id]?.status && resolutions[p.id]!.note.trim() !== "");
  const submit = async () => {
    const payload = Object.entries(resolutions)
      .filter(([, v]) => v.status && v.note.trim() !== "")
      .map(([predictionId, v]) => ({ predictionId, status: v.status!, note: v.note.trim() }));
    if (await run.run(payload)) setResolutions({});
  };
  const [latest, ...older] = reviews;

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <Card padding="sm">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">{t.resolveFirstTitle}</h3>
              <HelpText className="mt-1">{t.resolveFirstHint}</HelpText>
            </div>
            {pending.map((p) => {
              const options = p.kind === "reentry_condition" ? CONDITION_OPTIONS : FORECAST_OPTIONS;
              return (
                <div key={p.id} className="flex flex-col gap-2 border-t border-rule pt-3">
                  {p.kind && (
                    <Badge tone="neutral" className="w-fit">
                      {predictionKindLabel[p.kind] ?? "—"}
                    </Badge>
                  )}
                  <p className="text-sm text-ink">{p.claimText}</p>
                  <div role="radiogroup" aria-label={p.claimText} className="flex flex-wrap gap-2">
                    {options.map(([value, label]) => (
                      <Button key={value} size="sm" variant={resolutions[p.id]?.status === value ? "primary" : "secondary"} aria-pressed={resolutions[p.id]?.status === value} onClick={() => set(p.id, { status: value })}>
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Field label={t.resolutionNoteLabel}>
                    {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={resolutions[p.id]?.note ?? ""} onChange={(e) => set(p.id, { note: e.target.value })} />}
                  </Field>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="flex flex-col items-start gap-2">
        <Button variant="primary" onClick={() => void submit()} disabled={!ready} loading={run.pending} loadingLabel={t.runningReview}>
          {reviews.length > 0 ? t.runAnotherReview : t.runReview}
        </Button>
        <ActionError title={t.reviewFailed} message={run.error} />
      </div>

      {!latest ? (
        <EmptyState title={t.noReviewTitle}>{t.noReviewHint}</EmptyState>
      ) : (
        <>
          <ReviewCard review={latest} isLatest decisionType={decisionType} disagree={disagree} />
          {older.length > 0 && (
            <Disclosure summary={t.olderReviewsTitle}>
              {older.map((r) => (
                <ReviewCard key={r.id} review={r} decisionType={decisionType} disagree={disagree} />
              ))}
            </Disclosure>
          )}
        </>
      )}
    </div>
  );
}

export function ReviewCard({
  review,
  isLatest = false,
  decisionType,
  disagree,
}: {
  review: ReviewRow;
  isLatest?: boolean;
  decisionType: string;
  disagree: DecisionAction<[dimensionId: string, text: string]>;
}) {
  const outcome = review.outcomeJson as ReviewOutcome;
  const isPass = decisionType === "PASS";
  // A PASS's outcome is exactly the counterfactual: shown only on request.
  const [revealed, setRevealed] = useState(false);
  const showOutcome = !isPass || revealed;

  return (
    <Card as="article">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {t.reviewOfPrefix}
            <Num>{dateTime(review.reviewDate)}</Num>
          </h3>
          {isLatest && <Badge tone="neutral">{t.latestReview}</Badge>}
        </div>

        <KeyValues
          items={[
            { label: t.axisQuality, value: <Badge tone="neutral">{labelOf(reviewQualityLabel, review.decisionQualityOverall)}</Badge> },
            { label: t.axisAccuracy, value: <Badge tone="neutral">{labelOf(thesisAccuracyLabel, review.thesisAccuracy)}</Badge> },
            {
              label: (
                <>
                  {t.axisOutcomePrefix}
                  <Num>{day(outcome.asOfDate)}</Num>
                </>
              ),
              value: showOutcome ? (
                <OutcomeFacts outcome={outcome} />
              ) : (
                <Button size="sm" variant="quiet" onClick={() => setRevealed(true)}>
                  {t.passRevealShow}
                </Button>
              ),
            },
          ]}
        />
        {isPass && revealed && (
          <div className="flex flex-wrap items-center gap-2">
            <HelpText>{t.passRevealNote}</HelpText>
            <Button size="sm" variant="quiet" onClick={() => setRevealed(false)}>
              {t.passRevealHide}
            </Button>
          </div>
        )}
        <HelpText>{t.axesNote}</HelpText>

        <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
          <p dir="ltr" lang="en" className="text-start text-sm leading-relaxed text-ink">
            {review.narrativeSummaryText}
          </p>
          <HelpText>{t.reviewLanguageNote}</HelpText>
        </div>

        <div className="border-t border-rule pt-2">
          <Disclosure summary={t.dimensionsTitle}>
            <ul className="flex flex-col divide-y divide-rule">
              {review.dimensions.map((d) => (
                <DimensionRow key={d.id} dimension={d} disagree={disagree} />
              ))}
            </ul>
          </Disclosure>
        </div>
      </div>
    </Card>
  );
}

function OutcomeFacts({ outcome }: { outcome: ReviewOutcome }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        {t.outcomePriceThen} <Num>{usd(outcome.priceAtDecision)}</Num> · {t.outcomePriceAtReview}{" "}
        {outcome.currentPrice !== null ? <Num>{usd(outcome.currentPrice)}</Num> : t.outcomeUnavailable}
        {outcome.priceChangePercent !== null && (
          <>
            {" · "}
            {t.outcomeChange} <Num>{signedPct(outcome.priceChangePercent)}</Num>
          </>
        )}
      </span>
      {outcome.sizeDollars !== null && outcome.pnlUsd !== null && (
        <span>
          {t.outcomePnl} <Num>{usd(outcome.pnlUsd)}</Num>
          {outcome.pnlPercent !== null && (
            <>
              {" "}
              (<Num>{signedPct(outcome.pnlPercent)}</Num>)
            </>
          )}
        </span>
      )}
      <span className="text-xs text-muted">{outcome.stillHeld ? t.outcomeStillHeld : t.outcomeNotHeld}</span>
    </span>
  );
}

function DimensionRow({ dimension, disagree }: { dimension: ReviewRow["dimensions"][number]; disagree: DecisionAction<[dimensionId: string, text: string]> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const cited = Array.isArray(dimension.citedSnapshotFields) ? (dimension.citedSnapshotFields as unknown[]).filter((f): f is string => typeof f === "string") : [];

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{labelOf(reviewDimensionLabel, dimension.dimension)}</span>
        <Badge tone="neutral">{labelOf(reviewQualityLabel, dimension.verdict)}</Badge>
      </div>
      <p dir="ltr" lang="en" className="text-start text-sm leading-relaxed text-ink-2">
        {dimension.rationaleText}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">{t.citedTitle}:</span>
        {cited.length === 0 ? (
          <span className="text-muted">{t.noCitations}</span>
        ) : (
          cited.map((f) => (
            <Badge key={f} tone="neutral">
              {labelOf(citedFieldLabel, f)}
            </Badge>
          ))
        )}
      </div>
      {saved ? (
        <Notice tone="info">{t.disagreeSaved}</Notice>
      ) : open ? (
        <div className="flex flex-col gap-2">
          <Field label={t.disagreeLabel}>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} className="min-h-20" value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (await disagree.run(dimension.id, text)) setSaved(true);
              }}
              disabled={text.trim() === ""}
              loading={disagree.pending}
              loadingLabel={t.disagreeSubmitting}
            >
              {t.disagreeSubmit}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
              {t.disagreeCancel}
            </Button>
          </div>
          <ActionError title={t.actionFailed} message={disagree.error} />
        </div>
      ) : (
        <Button size="sm" variant="quiet" className="w-fit" onClick={() => setOpen(true)}>
          {t.disagreeButton}
        </Button>
      )}
    </li>
  );
}
