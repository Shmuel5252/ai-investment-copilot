import { tellMeWhy } from "@/lib/i18n/strings";

// THE one deterministic "Tell me why" question builder — code, never AI (no
// Anthropic import in this file; buildTellMeWhyQuestion is synchronous and
// returns a plain string). Used by interview.startTellMeWhy, and again by
// interview.answer, which regenerates it and requires the echoed question to
// be identical before anything is stored.
//
// Unit 7C-B: Tell me why is ENTRY RATIONALE ONLY. The question is the
// wording only and asks about the decision to enter, never about managing,
// selling or leaving the position, whatever happened afterwards; it names
// only the ticker. The entry facts the investor sees with it are the facts
// line of the entry's point-in-time snapshot
// (src/lib/interview/anchor-context.ts), returned separately and persisted in
// interview_answers.anchor_context, never inside question_text.
export function buildTellMeWhyQuestion(ticker: string): string {
  return tellMeWhy.entryQuestionTemplate.replace("{ticker}", ticker);
}
