import type { EpisodeAnswerInput, EpisodeEntryFacts, EpisodeJournal, EpisodeLaterFacts, EpisodeRationale, JournalEpisode } from "@/lib/portfolio/episodes";
import { isAnchorContextV1, type AnchorRole } from "@/lib/interview/anchor-context";

// Episode Journal V1 — the HINDSIGHT-SAFE projection the API hands to the
// UI (approved product decision 4). A rationale must be the investor's
// reconstruction of what they knew at the time, so for an episode that has
// no rationale yet the journal exposes only what identifies the historical
// decision: ticker, episode number, side counts, open/closed, and the entry
// transaction's own contemporaneous facts. Everything post-decision —
// realized P&L, exit date, holding duration, the sell trace — is withheld
// server-side (`later: null`) until an answer has been persisted; only then
// may the UI show it, and it shows it labelled as later facts. Enforced
// here, in the projection, not in the page: a client cannot render what it
// was never sent.
//
// Action answers (Unit 7C-F backend delta, Owner decision): the investor's
// own answers about a LATER action of the episode (a guided question about an
// add-on or a sell) are returned whether or not the entry has a rationale, so
// they never disappear from the UI. They never count as the entry rationale
// and never change coverage. Each is projected explicitly (JournalActionAnswerView):
// the anchored action's own stored identity, the investor's answer, the
// question's provenance and stored wording, and the frozen point-in-time
// facts line only when the row has a PIT snapshot — a legacy row has none,
// and none is reconstructed. `later` (realized results, exit, holding
// duration) stays withheld until an entry rationale exists.

export interface JournalEpisodeView {
  key: string;
  ticker: string;
  episodeNumber: number;
  status: "open" | "closed";
  buyCount: number;
  sellCount: number;
  firstDate: Date;
  entry: EpisodeEntryFacts | null;
  /** false = no BUY anchor; "Tell me why" cannot be started for it (fail closed). */
  anchorable: boolean;
  rationale: EpisodeRationale;
  /** Present only once a rationale exists — never before. */
  later: EpisodeLaterFacts | null;
  /**
   * Effective answers anchored to the episode's other actions, oldest first.
   * Always returned (Owner decision, Unit 7C-F); never entry coverage.
   */
  actionAnswers: JournalActionAnswerView[];
}

/** One investor answer about a specific later action, for display. */
export interface JournalActionAnswerView {
  answerId: string;
  /** The exact anchored action, from its stored transaction. role: from the PIT snapshot only; null for a legacy row (never reconstructed). */
  action: { transactionId: string; ticker: string; side: "buy" | "sell"; date: Date; role: AnchorRole | null };
  /** The investor's words, verbatim. */
  answerText: string;
  answeredAt: Date;
  /** interview_answers.question_provenance; null only when the source row did not carry it. */
  questionProvenance: string | null;
  /**
   * The stored question wording, for human display beside its provenance. A
   * guided_legacy wording predates the point-in-time rule and may mention
   * later facts; it stays excluded from every AI context (aiQuestionContext).
   */
  questionText: string;
  /** The frozen point-in-time facts line; null when the row has no PIT snapshot. */
  factsLine: string | null;
}

export function toActionAnswerView(episode: JournalEpisode, answer: EpisodeAnswerInput): JournalActionAnswerView {
  const tx = episode.transactions.find((t) => t.id === answer.transactionId);
  if (!tx) throw new Error(`toActionAnswerView: answer ${answer.id} is not anchored to a transaction of episode ${episode.key}.`);
  const snapshot = isAnchorContextV1(answer.anchorContext) ? answer.anchorContext : null;
  return {
    answerId: answer.id,
    action: { transactionId: tx.id, ticker: episode.ticker, side: tx.side, date: tx.date, role: snapshot ? snapshot.anchor.role : null },
    answerText: answer.answerText,
    answeredAt: answer.createdAt,
    questionProvenance: answer.questionProvenance ?? null,
    questionText: answer.questionText,
    factsLine: snapshot ? snapshot.factsLine : null,
  };
}

export interface JournalView {
  coverage: { covered: number; total: number };
  episodes: JournalEpisodeView[];
}

export function toHindsightSafeView(episode: JournalEpisode): JournalEpisodeView {
  return {
    key: episode.key,
    ticker: episode.ticker,
    episodeNumber: episode.episodeNumber,
    status: episode.status,
    buyCount: episode.buyCount,
    sellCount: episode.sellCount,
    firstDate: episode.firstDate,
    entry: episode.entry,
    anchorable: episode.entry !== null,
    rationale: episode.rationale,
    later: episode.rationale.status === "answered" ? episode.later : null,
    actionAnswers: episode.actionAnswers.map((a) => toActionAnswerView(episode, a)),
  };
}

export function toHindsightSafeJournal(journal: EpisodeJournal): JournalView {
  return { coverage: journal.coverage, episodes: journal.episodes.map(toHindsightSafeView) };
}

export type TellMeWhyAnchorResolution =
  | { ok: true; episode: JournalEpisode; anchorTransactionId: string }
  | { ok: false; reason: "no_episode" | "no_entry_anchor" };

// Which episode a chosen buy/sell transaction belongs to, and the ONE
// deterministic transaction its rationale is persisted against (the
// episode's entry BUY — see src/lib/portfolio/episodes.ts). Fails closed
// rather than guessing when the position math assigned no episode or the
// episode has no BUY.
export function resolveTellMeWhyAnchor(journal: EpisodeJournal, transactionId: string): TellMeWhyAnchorResolution {
  const episode = journal.episodes.find((e) => e.transactions.some((t) => t.id === transactionId));
  if (!episode) return { ok: false, reason: "no_episode" };
  if (!episode.entry) return { ok: false, reason: "no_entry_anchor" };
  return { ok: true, episode, anchorTransactionId: episode.entry.transactionId };
}
