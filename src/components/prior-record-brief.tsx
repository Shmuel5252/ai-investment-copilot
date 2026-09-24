"use client";

// Prior Record Brief V1 — renders a PriorRecordBrief (live on the research
// page, frozen on a Decision Snapshot). Facts only: the investor's own past
// decisions (verbatim frozen text, predictions as they stand, the Review's
// own verdict labels), past episodes with realized outcomes backed by known
// holdings, and the investor's own rationale answers. No price move since a
// past decision is shown (for a PASS that is the counterfactual, shown only
// on explicit request elsewhere), no score, no inferred intent.
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { Num } from "@/components/num";
import { priorRecord as t, decisionTypeLabel, predictionStatusLabel, predictionKindLabel } from "@/lib/i18n/strings";

const day = (iso: string) => new Date(iso).toLocaleDateString("he-IL");
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
// Quantities are computed sums (float): show at most 6 decimals, never an artifact like 0.38589999999999997.
const qty = (n: number) => String(Number(n.toFixed(6)));

export function PriorRecordBriefView({ brief, frozen = false }: { brief: PriorRecordBrief; frozen?: boolean }) {
  const s = brief.summary;
  const empty = s.decisionCount === 0 && s.episodeCount === 0;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-journal-muted">
        {frozen ? t.frozenNote : t.liveNote} · {t.generatedAtPrefix} <Num>{new Date(brief.asOf).toLocaleString("he-IL")}</Num>
        {" · "}
        {brief.historyThrough ? (
          <>
            {t.historyThroughPrefix} <Num>{day(brief.historyThrough)}</Num>
          </>
        ) : (
          t.noHistory
        )}
      </p>

      <p>
        {brief.position.status === "held" ? (
          <>
            {t.heldPrefix}{" "}
            <Num>
              {qty(brief.position.quantity)} @ {brief.position.costBasisPerShare !== null ? "$" + brief.position.costBasisPerShare.toFixed(2) : "?"}
            </Num>
          </>
        ) : brief.position.status === "not_held" ? (
          t.notHeld
        ) : (
          t.positionUnavailable
        )}
      </p>

      {empty ? (
        <p className="text-journal-muted">{t.empty}</p>
      ) : (
        <p className="text-xs text-journal-muted">
          <Num>{s.decisionCount}</Num> {t.decisionsCountSuffix} (<Num>{s.reviewedDecisionCount}</Num> {t.reviewedSuffix}) ·{" "}
          <Num>{s.episodeCount}</Num> {t.episodesCountSuffix} (<Num>{s.openEpisodeCount}</Num> {t.openSuffix}) · <Num>{s.rationaleAnswerCount}</Num>{" "}
          {t.rationaleCountSuffix}
        </p>
      )}

      {s.pendingReentryConditions.length > 0 && (
        <div className="rounded border border-journal-accent p-2">
          <p className="text-xs font-semibold">{t.reentryTitle}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {s.pendingReentryConditions.map((c) => (
              <li key={c.predictionId}>
                {c.claimText}{" "}
                <span className="text-xs text-journal-muted">
                  ({decisionTypeLabel[c.decisionType] ?? c.decisionType} · <Num>{day(c.decisionDate)}</Num>)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.decisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold">{t.decisionsTitle}</p>
          {brief.decisions.map((d) => (
            <details key={d.decisionId} className="rounded border border-journal-rule p-2">
              <summary className="cursor-pointer">
                {decisionTypeLabel[d.decisionType] ?? d.decisionType} · <Num>{day(d.decisionDate)}</Num>
                {d.priceAtDecision !== null && (
                  <>
                    {" · "}
                    {t.priceAtDecisionLabel} <Num>${Number(d.priceAtDecision).toFixed(2)}</Num>
                  </>
                )}
                {" · "}
                {d.latestReview ? (
                  <bdi dir="ltr">
                    Review: {d.latestReview.decisionQualityOverall} · thesis: {d.latestReview.thesisAccuracy}
                  </bdi>
                ) : (
                  t.notReviewed
                )}
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {d.reasoningText && <Block label={t.reasoningLabel} text={d.reasoningText} />}
                {d.risksConsideredText && <Block label={t.risksLabel} text={d.risksConsideredText} />}
                {d.exitConditionsText && <Block label={t.exitConditionsLabel} text={d.exitConditionsText} />}
                {d.predictions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold">{t.predictionsLabel}</p>
                    <ul className="flex flex-col gap-1">
                      {d.predictions.map((p) => (
                        <li key={p.id}>
                          {p.claimText}{" "}
                          <span className="text-xs text-journal-muted">
                            ({p.kind ? `${predictionKindLabel[p.kind] ?? p.kind} · ` : ""}
                            {predictionStatusLabel[p.status] ?? p.status})
                          </span>
                          {p.resolutionNote && <p className="text-xs text-journal-muted">{p.resolutionNote}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.laterContexts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold">{t.laterContextLabel}</p>
                    {d.laterContexts.map((lc, i) => (
                      <p key={i} className="text-xs">
                        <Num>{day(lc.addedAt)}</Num> — {lc.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {brief.episodes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold">{t.episodesTitle}</p>
          {brief.episodes.map((e) => (
            <div key={e.key} className="rounded border border-journal-rule p-2">
              <p>
                <bdi dir="ltr">{e.key}</bdi> · {e.status === "open" ? t.episodeOpen : t.episodeClosed} · <Num>{day(e.firstDate)}</Num>
                {e.exitDate && (
                  <>
                    {" → "}
                    <Num>{day(e.exitDate)}</Num>
                  </>
                )}
                {" · "}
                <Num>{e.buyCount}</Num> {t.buysSuffix} / <Num>{e.sellCount}</Num> {t.sellsSuffix}
              </p>
              {e.sells.length > 0 && (
                <p className="text-xs text-journal-muted">
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
                  <p key={r.answerId} className="mt-1 text-xs">
                    <span className="text-journal-muted">{t.rationaleLabel}</span> {r.answerText}
                  </p>
                ))
              ) : (
                <p className="text-xs text-journal-muted">{t.noRationale}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold">{label}</p>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}
