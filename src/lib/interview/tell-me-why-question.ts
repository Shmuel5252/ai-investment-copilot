// "Tell me why" — the question here is built entirely in code, not by
// an AI call: no Anthropic client is imported anywhere in this file, and
// the function below is synchronous (returns string, not
// Promise<string>) — provable by its signature, not by mocking anything
// (docs/backlog.md, Manual Historical Entry). This is different from
// select-transactions.ts's guided interview, where the SELECTION is code
// but the question's phrasing is still AI (src/lib/ai/interview.ts). For
// "Tell me why" the investor already told the system which transaction
// they want to talk about — nothing needs to be inferred or phrased
// dynamically, so there's no reason to spend an AI call on it.
//
// The question is deliberately generic per-ticker, not per-transaction-
// type/quantity/date: it invites the whole lifecycle of the position
// (entry, what happened while holding it, why it was reduced or closed)
// in one open answer, not a narrow "why did you buy on this exact date"
// — real lifecycles (e.g. a BUY followed by a partial SELL and a final
// SELL) span more than one transaction, but InterviewAnswer still links
// to exactly one anchor transaction (docs/backlog.md — verified no
// structural blocker to this: the answer text itself is unconstrained
// free text, never validated against the anchor's own facts).
import { tellMeWhy } from "@/lib/i18n/strings";

export function buildTellMeWhyQuestion(ticker: string): string {
  return tellMeWhy.questionTemplate.replace("{ticker}", ticker);
}
