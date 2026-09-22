import type { EpisodeEntryFacts, EpisodeJournal, EpisodeLaterFacts, EpisodeRationale, JournalEpisode } from "@/lib/portfolio/episodes";

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
