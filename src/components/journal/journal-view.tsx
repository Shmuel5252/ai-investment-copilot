"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { List, ListRow } from "@/components/ui/list";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState, HelpText } from "@/components/ui/states";
import { Quote, Provenance } from "@/components/ui/quote";
import { KeyValues } from "@/components/ui/table";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { RationaleWriter, type RationaleActions } from "./rationale-writer";
import { journalPage as t } from "@/lib/i18n/strings";

// /journal — Frontend V1 unit 7A. The Journal is a projection, not a stored
// feed: each row is one position lifecycle ("episode") derived from the
// transactions, plus the investor's effective rationale answers anchored to
// its entry BUY. The page only presents what interview.journal returns:
//   - the two lists split by rationale.status and keep the server's order;
//   - an unanswered row shows entry-time facts only. The server already
//     sends `later: null` for it; the row also leaves out open/closed status
//     and the buy/sell counts, which describe what happened after entry;
//   - later facts appear only for an answered row, closed by default, in a
//     labelled region, with no success/failure coloring;
//   - the derived key (TICKER#n) is never shown as an identifier.
// Dates arrive as ISO strings (no tRPC transformer).

type When = string | Date;

export interface JournalAnswer {
  id: string;
  questionText: string;
  answerText: string;
  createdAt: When;
}

export interface JournalEpisodeRow {
  key: string;
  ticker: string;
  episodeNumber: number;
  status: "open" | "closed";
  buyCount: number;
  sellCount: number;
  firstDate: When;
  entry: { transactionId: string; date: When; quantity: number | null; price: number | null } | null;
  anchorable: boolean;
  rationale: { status: "answered" | "unanswered"; answers: JournalAnswer[]; latestAnswerId: string | null };
  later: {
    exitDate: When | null;
    holdingDays: number | null;
    sells: { transactionId: string; date: When; realizedPnlPercent: number; sufficientHoldings: boolean }[];
  } | null;
}

export interface JournalData {
  coverage: { covered: number; total: number };
  episodes: JournalEpisodeRow[];
}

/** Split by rationale status only, keeping the server's order in each part. */
export function partitionEpisodes<E extends Pick<JournalEpisodeRow, "rationale">>(episodes: readonly E[]) {
  return {
    unanswered: episodes.filter((e) => e.rationale.status === "unanswered"),
    answered: episodes.filter((e) => e.rationale.status === "answered"),
  };
}

const quantity = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4).replace(/\.?0+$/, ""));

export function JournalView({ journal, actions }: { journal: Loadable<JournalData>; actions: RationaleActions }) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <RegionBody q={journal} lines={6}>
        {(data) =>
          data.episodes.length === 0 ? (
            <EmptyState
              title={t.emptyTitle}
              action={
                <ButtonLink href="/import" size="sm" variant="secondary">
                  {t.emptyAction}
                </ButtonLink>
              }
            >
              {t.emptyHint}
            </EmptyState>
          ) : (
            <Episodes data={data} actions={actions} />
          )
        }
      </RegionBody>
    </PageShell>
  );
}

function Episodes({ data, actions }: { data: JournalData; actions: RationaleActions }) {
  const { unanswered, answered } = partitionEpisodes(data.episodes);
  return (
    <>
      <p className="text-sm text-ink-2">
        {t.coveragePrefix}
        <Num>{data.coverage.covered}</Num> {t.coverageMiddle} <Num>{data.coverage.total}</Num> {t.coverageSuffix}
      </p>

      <Section id="unanswered" title={t.unansweredTitle} count={unanswered.length} hint={unanswered.length > 0 ? t.unansweredHint : undefined}>
        {unanswered.length === 0 ? (
          <p className="text-sm text-ink-2">{t.noneWaiting}</p>
        ) : (
          <List label={t.unansweredTitle}>
            {unanswered.map((e) => (
              <UnansweredRow key={e.key} episode={e} actions={actions} />
            ))}
          </List>
        )}
      </Section>

      <Section id="answered" title={t.answeredTitle} count={answered.length} hint={answered.length > 0 ? t.answeredHint : undefined}>
        {answered.length === 0 ? (
          <p className="text-sm text-ink-2">{t.noneAnswered}</p>
        ) : (
          <List label={t.answeredTitle}>
            {answered.map((e) => (
              <AnsweredRow key={e.key} episode={e} actions={actions} />
            ))}
          </List>
        )}
      </Section>
    </>
  );
}

// Ticker and the episode's ordinal: what tells two positions in one ticker apart.
function EpisodeTitle({ episode }: { episode: JournalEpisodeRow }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold text-ink">
        <Num>{episode.ticker}</Num>
      </span>
      <span className="text-muted">
        {t.positionOrdinal} <Num>{episode.episodeNumber}</Num>
      </span>
    </p>
  );
}

// Facts of the entry BUY itself, known on the day of entry.
function EntryFacts({ episode }: { episode: JournalEpisodeRow }) {
  const { entry } = episode;
  if (!entry) {
    return (
      <p className="text-xs text-ink-2">
        {t.firstTradePrefix}: <Num>{day(episode.firstDate)}</Num>
      </p>
    );
  }
  return (
    <p className="text-xs text-ink-2">
      {t.entryPrefix}: <Num>{day(entry.date)}</Num>
      {entry.quantity !== null && entry.price !== null && (
        <>
          {" · "}
          <Num>{quantity(entry.quantity)}</Num> {t.sharesAt} <Num>${entry.price.toFixed(2)}</Num>
        </>
      )}
    </p>
  );
}

function UnansweredRow({ episode, actions }: { episode: JournalEpisodeRow; actions: RationaleActions }) {
  return (
    <ListRow>
      <div className="flex flex-col gap-2">
        <EpisodeTitle episode={episode} />
        <EntryFacts episode={episode} />
        {episode.anchorable && episode.entry ? (
          <RationaleWriter transactionId={episode.entry.transactionId} actions={actions} />
        ) : (
          <HelpText>{t.notAnchorable}</HelpText>
        )}
      </div>
    </ListRow>
  );
}

function AnsweredRow({ episode, actions }: { episode: JournalEpisodeRow; actions: RationaleActions }) {
  // While an update is being written the later facts leave the screen: an
  // update is a rationale too, and must not be composed next to the outcome.
  const [updating, setUpdating] = useState(false);
  const { answers, latestAnswerId } = episode.rationale;
  const latest = answers.find((a) => a.id === latestAnswerId) ?? answers.at(-1);
  return (
    <ListRow>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <EpisodeTitle episode={episode} />
          <EntryFacts episode={episode} />
        </div>
        {answers.length > 1 && <HelpText>{t.severalAnswers}</HelpText>}
        {answers.map((a) => (
          <article key={a.id} className="flex flex-col gap-1.5">
            <HelpText>
              {t.inReplyTo} <span className="text-ink-2">{a.questionText}</span>
            </HelpText>
            <Quote>{a.answerText}</Quote>
            <p className="text-xs text-muted">
              {t.writtenOnPrefix}
              <Num>{day(a.createdAt)}</Num>
            </p>
          </article>
        ))}
        <Provenance>{t.answerProvenance}</Provenance>
        {episode.entry && latest && (
          <RationaleWriter
            transactionId={episode.entry.transactionId}
            current={{ id: latest.id, answerText: latest.answerText }}
            actions={actions}
            onWritingChange={setUpdating}
          />
        )}
        {episode.later && !updating && <LaterFacts episode={episode} later={episode.later} />}
      </div>
    </ListRow>
  );
}

// Post-entry facts, derived from the transactions by the position math. Shown
// only for an answered episode, closed by default, never colored by result.
function LaterFacts({ episode, later }: { episode: JournalEpisodeRow; later: NonNullable<JournalEpisodeRow["later"]> }) {
  const items: { label: React.ReactNode; value: React.ReactNode }[] = [
    { label: t.statusLabel, value: episode.status === "open" ? t.statusOpen : t.statusClosed },
    {
      label: t.tradesLabel,
      value: (
        <>
          <Num>{episode.buyCount}</Num> {t.buysSuffix} · <Num>{episode.sellCount}</Num> {t.sellsSuffix}
        </>
      ),
    },
  ];
  if (later.exitDate) items.push({ label: t.exitLabel, value: <Num>{day(later.exitDate)}</Num> });
  if (later.holdingDays !== null) items.push({ label: t.holdingDaysLabel, value: <Num>{later.holdingDays}</Num> });
  return (
    <Disclosure summary={t.laterSummary} className="border-t border-rule pt-2">
      <HelpText>{t.laterNote}</HelpText>
      <KeyValues items={items} />
      {episode.status === "open" && <p className="text-xs text-ink-2">{t.stillOpenNote}</p>}
      {later.sells.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-ink-2">{t.sellsTitle}</p>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-2">
            {later.sells.map((s) => (
              <li key={s.transactionId}>
                {t.sellOnPrefix}
                <Num>{day(s.date)}</Num>:{" "}
                <Num>
                  {s.realizedPnlPercent >= 0 ? "+" : ""}
                  {s.realizedPnlPercent.toFixed(1)}%
                </Num>
                {!s.sufficientHoldings && <span className="text-muted"> · {t.insufficientHoldingsNote}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        episode.status === "closed" && <p className="text-xs text-ink-2">{t.noSellTrace}</p>
      )}
    </Disclosure>
  );
}
