"use client";

// Prior Record Brief V1 — renders a PriorRecordBrief (live on the research
// page, frozen on a Decision Snapshot). Facts only: the investor's own past
// decisions (verbatim frozen text, predictions as they stand, the Review's
// own verdict labels), past episodes with realized outcomes backed by known
// holdings, and the investor's own rationale answers. No price move since a
// past decision is shown (for a PASS that is the counterfactual, shown only
// on explicit request elsewhere), no score, no tally, no inferred intent.
//
// Frontend V1 unit 3: restyled on the shared primitives. The brief itself,
// its selection and its point-in-time cutoff are the derivation's
// (src/lib/prior-record); this file only lays it out. Review labels sit in
// neutral badges: a historical record label, never a success color.
import Link from "next/link";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { Num, shares } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import { priorRecord as t, decisionTypeLabel, predictionStatusLabel, predictionKindLabel, reviewQualityLabel, thesisAccuracyLabel } from "@/lib/i18n/strings";

const day = (iso: string) => new Date(iso).toLocaleDateString("he-IL");
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
// Quantities are computed sums (float): show at most 6 decimals, never an artifact like 0.38589999999999997.

export function PriorRecordBriefView({ brief, frozen = false }: { brief: PriorRecordBrief; frozen?: boolean }) {
  const s = brief.summary;
  const empty = s.decisionCount === 0 && s.episodeCount === 0;
  const anyReview = brief.decisions.some((d) => d.latestReview);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <HelpText>
        {frozen ? t.frozenNote : t.liveNote} · {t.generatedAtPrefix}{" "}
        <Num>{new Date(brief.asOf).toLocaleString("he-IL")}</Num>
        {" · "}
        {brief.historyThrough ? (
          <>
            {t.historyThroughPrefix} <Num>{day(brief.historyThrough)}</Num>
          </>
        ) : (
          t.noHistory
        )}
      </HelpText>

      <div className="flex flex-col gap-1">
        <p className="text-ink">
          {brief.position.status === "held" ? (
            <>
              {frozen ? t.heldAtDecisionPrefix : t.heldPrefix}{" "}
              <Num>
                {shares(brief.position.quantity)} @ {brief.position.costBasisPerShare !== null ? "$" + brief.position.costBasisPerShare.toFixed(2) : "?"}
              </Num>
            </>
          ) : brief.position.status === "not_held" ? (
            frozen ? t.notHeldAtDecision : t.notHeld
          ) : (
            <span className="text-muted">{t.positionUnavailable}</span>
          )}
        </p>
        {empty ? (
          <p className="text-ink-2">{t.empty}</p>
        ) : (
          <p className="text-xs text-muted">
            <Num>{s.decisionCount}</Num> {t.decisionsCountSuffix} (<Num>{s.reviewedDecisionCount}</Num> {t.reviewedSuffix}) · <Num>{s.episodeCount}</Num> {t.episodesCountSuffix} (
            <Num>{s.openEpisodeCount}</Num> {t.openSuffix}) · <Num>{s.rationaleAnswerCount}</Num> {t.rationaleCountSuffix}
          </p>
        )}
      </div>

      {s.pendingReentryConditions.length > 0 && (
        <Notice tone="info" title={t.reentryTitle}>
          <ul className="flex flex-col gap-1">
            {s.pendingReentryConditions.map((c) => (
              <li key={c.predictionId}>
                {c.claimText}{" "}
                <span className="text-xs text-muted">
                  ({decisionTypeLabel[c.decisionType] ?? c.decisionType} · <Num>{day(c.decisionDate)}</Num>)
                </span>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {brief.decisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">{t.decisionsTitle}</h3>
          <List label={t.decisionsTitle}>
            {brief.decisions.map((d) => (
              <ListRow key={d.decisionId}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="text-xs text-muted transition-transform group-open:-rotate-90">
                      ‹
                    </span>
                    <span className="font-semibold text-ink">{decisionTypeLabel[d.decisionType] ?? d.decisionType}</span>
                    <span className="text-xs text-muted">
                      <Num>{day(d.decisionDate)}</Num>
                    </span>
                    {d.priceAtDecision !== null && (
                      <span className="text-xs text-muted">
                        {t.priceAtDecisionLabel} <Num>${Number(d.priceAtDecision).toFixed(2)}</Num>
                      </span>
                    )}
                    {d.latestReview ? (
                      <Badge tone="neutral">
                        Review · {t.reviewQualityPrefix} {reviewQualityLabel[d.latestReview.decisionQualityOverall] ?? "—"} · {t.thesisAccuracyPrefix}{" "}
                        {thesisAccuracyLabel[d.latestReview.thesisAccuracy] ?? "—"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted">{t.notReviewed}</span>
                    )}
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {d.reasoningText && <Block label={t.reasoningLabel} text={d.reasoningText} />}
                    {d.risksConsideredText && <Block label={t.risksLabel} text={d.risksConsideredText} />}
                    {d.exitConditionsText && <Block label={t.exitConditionsLabel} text={d.exitConditionsText} />}
                    {d.predictions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted">{t.predictionsLabel}</p>
                        <ul className="mt-1 flex flex-col gap-1.5">
                          {d.predictions.map((p) => (
                            <li key={p.id}>
                              {p.claimText}{" "}
                              <span className="text-xs text-muted">
                                ({p.kind ? `${predictionKindLabel[p.kind] ?? p.kind} · ` : ""}
                                {predictionStatusLabel[p.status] ?? p.status})
                              </span>
                              {p.resolutionNote && <p className="text-xs text-muted">{p.resolutionNote}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {d.laterContexts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted">{t.laterContextLabel}</p>
                        {d.laterContexts.map((lc, i) => (
                          <p key={i} className="mt-1 whitespace-pre-wrap text-sm">
                            <span className="text-xs text-muted">
                              <Num>{day(lc.addedAt)}</Num>
                            </span>{" "}
                            {lc.text}
                          </p>
                        ))}
                      </div>
                    )}
                    <Link href={`/decisions/${d.decisionId}`} className="w-fit text-sm text-accent underline">
                      {t.openPastDecision}
                    </Link>
                  </div>
                </details>
              </ListRow>
            ))}
          </List>
          {anyReview && <HelpText>{t.reviewLabelsNote}</HelpText>}
        </div>
      )}

      {brief.episodes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">{t.episodesTitle}</h3>
          <List label={t.episodesTitle}>
            {brief.episodes.map((e) => (
              <ListRow key={e.key}>
                <div className="flex flex-col gap-1.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="neutral">{e.status === "open" ? t.episodeOpen : t.episodeClosed}</Badge>
                    <span className="text-ink">
                      <Num>{day(e.firstDate)}</Num>
                      {e.exitDate && (
                        <>
                          {" – "}
                          <Num>{day(e.exitDate)}</Num>
                        </>
                      )}
                    </span>
                    <span className="text-xs text-muted">
                      <Num>{e.buyCount}</Num> {t.buysSuffix} / <Num>{e.sellCount}</Num> {t.sellsSuffix}
                    </span>
                  </p>
                  {e.sells.length > 0 && (
                    <p className="text-xs text-muted">
                      {t.realizedPrefix}{" "}
                      {e.sells.map((x, i) => (
                        <span key={i}>
                          {i > 0 && " · "}
                          {x.realizedPnlPercent !== null ? <Num>{pct(x.realizedPnlPercent)}</Num> : t.untrustedSell} (<Num>{day(x.date)}</Num>)
                        </span>
                      ))}
                    </p>
                  )}
                  {e.rationale.length > 0 ? (
                    e.rationale.map((r) => (
                      <div key={r.answerId} className="flex flex-col gap-1">
                        <p className="text-xs text-muted">{t.rationaleLabel}</p>
                        <blockquote className="whitespace-pre-wrap border-s-2 border-rule-strong ps-3 text-sm text-ink">{r.answerText}</blockquote>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted">{t.noRationale}</p>
                  )}
                </div>
              </ListRow>
            ))}
          </List>
        </div>
      )}
    </div>
  );
}

// The investor's own frozen words: verbatim, line breaks kept.
function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <blockquote className="whitespace-pre-wrap border-s-2 border-rule-strong ps-3 text-sm text-ink">{text}</blockquote>
    </div>
  );
}
