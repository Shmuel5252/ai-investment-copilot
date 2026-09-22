import { tellMeWhy } from "@/lib/i18n/strings";

// THE one deterministic "Tell me why" question builder — code, never AI
// (no Anthropic import in this file; buildTellMeWhyQuestion is
// synchronous and returns a plain string). Used by interview.startTellMeWhy
// for both entry points: the post-manual-entry button on /import and the
// Episode Journal.
//
// HINDSIGHT PROTECTION (Episode Journal V1, approved product decision 4):
// the question is shown BEFORE the investor writes their rationale, so it
// may only carry what identifies the historical decision — ticker, episode
// number, open/closed, and the entry transaction's own contemporaneous
// facts (date, quantity, price). The input type has no field for anything
// post-decision (realized P&L, exit, later prices), so nothing
// outcome-loaded can reach the text; describeTransactionFacts()
// (src/lib/ai/interview.ts), which DOES state realized P&L, is the guided
// interview's fact line and is deliberately not reused here.
export interface TellMeWhyEntryFacts {
  date: Date;
  quantity: number | null;
  price: number | null;
}

export interface TellMeWhyContext {
  ticker: string;
  episodeNumber?: number;
  /** "closed" asks about entry, management and exit; "open" about entry and current management. */
  status?: "open" | "closed";
  entry?: TellMeWhyEntryFacts | null;
}

// dd/mm/yyyy, UTC — deterministic, locale-independent (the question text is
// persisted verbatim as InterviewAnswer.question_text).
export function formatQuestionDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(4).replace(/\.?0+$/, "");
}

export function describeEpisodeEntry(context: TellMeWhyContext): string | null {
  if (!context.entry) return null;
  const { entry } = context;
  const where = context.episodeNumber !== undefined ? `${context.ticker}#${context.episodeNumber}` : context.ticker;
  const amount =
    entry.quantity !== null && entry.price !== null
      ? tellMeWhy.entryAmountTemplate
          .replace("{quantity}", formatQuantity(entry.quantity))
          .replace("{price}", entry.price.toFixed(2))
      : "";
  return tellMeWhy.contextTemplate
    .replace("{episode}", where)
    .replace("{date}", formatQuestionDate(entry.date))
    .replace("{amount}", amount)
    .replace(/\s+\./g, ".")
    .trim();
}

export function buildTellMeWhyQuestion(input: string | TellMeWhyContext): string {
  const context: TellMeWhyContext = typeof input === "string" ? { ticker: input } : input;
  const template = context.status === "open" ? tellMeWhy.questionTemplateOpen : tellMeWhy.questionTemplate;
  const question = template.replace("{ticker}", context.ticker);
  const entryLine = describeEpisodeEntry(context);
  return entryLine ? `${entryLine} ${question}` : question;
}
