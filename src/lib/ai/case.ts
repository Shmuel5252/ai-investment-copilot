import { anthropic, CLAUDE_MODEL } from "./client";
import type { MarketIntelligence } from "@/lib/market/fmp";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";

// A required tool-response field silently disappearing (undefined/null/
// empty) is exactly what No Fake Certainty exists to catch, not a mere
// convenience gap: a live check once caught CASE_TOOL's `synthesisText`
// coming back `null` despite being `required` in the schema below, with
// nothing anywhere flagging that anything was missing — it would have
// quietly leaked through to the DB/UI as if it were a normal empty
// field (docs/backlog.md, "עדיפות גבוהה"). This turns that failure mode
// into a loud, specific error at the one place both functions in this
// file cast a raw tool response, instead of trusting the type assertion
// alone.
export function assertNonEmptyStrings<T extends object>(obj: T, fields: (keyof T & string)[], toolName: string): void {
  const missing = fields.filter((f) => {
    const value = obj[f];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(`AI's "${toolName}" response is missing required field(s): ${missing.join(", ")}.`);
  }
}

// ---------------------------------------------------------------------
// Case synthesis — Bull/Bear/Catalysts/Invalidation/Market Blindspot/
// Devil's Advocate/overall synthesis, plus a narrative read of the
// already-computed Portfolio Fit numbers (docs/architecture.md §2.5: "AI
// מסנתז Bull/Bear/Catalysts/Invalidation/Devil's Advocate"). Everything
// here is grounded in real, already-fetched inputs (MarketIntelligence
// from FMP, PortfolioFit computed in code) — the model is told explicitly
// not to invent facts (revenue, guidance, analyst targets, ...) beyond
// what it's actually handed, matching CLAUDE.md's "AI לא ממציא facts".
// ---------------------------------------------------------------------

export interface CaseSynthesisInput {
  ticker: string;
  ideaNoteText?: string;
  marketIntelligence: MarketIntelligence;
  portfolioFit: PortfolioFit;
}

export interface CaseSynthesis {
  bullCaseText: string;
  bearCaseText: string;
  catalystsText: string;
  invalidationConditionsText: string;
  marketBlindspotText: string;
  devilsAdvocateText: string;
  portfolioFitText: string;
  synthesisText: string;
}

const CASE_SYSTEM_PROMPT = `You help a personal investor think through a potential stock position. You are given real, already-fetched data — a company/valuation snapshot and computed portfolio-fit numbers — and nothing else. You do not have access to financial statements, analyst estimates, or news.

Write bullCaseText, bearCaseText, catalystsText, invalidationConditionsText, marketBlindspotText, devilsAdvocateText, portfolioFitText, and synthesisText in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms (e.g. P/E, margin of safety) in English exactly as an investor writing in natural mixed Hebrew/English would — that mixed style is expected, not a fallback. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically).

Ground rules:
- Use ONLY the numbers and facts you are actually given (price, market cap, sector, industry, beta, valuation ratios if present, description, portfolio fit numbers). Never invent revenue, earnings, guidance, analyst price targets, news events, or any other fact not present in what you were handed.
- If a valuation ratio (P/E, price/book, price/sales, dividend yield) is marked unavailable, say plainly that it wasn't available rather than guessing at it or working around it with an invented number.
- marketBlindspotText should be an honest statement of what this data snapshot genuinely can't tell you (no cash-flow trend, no forward guidance, no news/sentiment, no financial-statement detail) — not a generic disclaimer, and not a fabricated additional risk dressed up as a blind spot.
- portfolioFitText should narrate the portfolio-fit numbers you were given in plain language (current exposure, projected weight if a hypothetical size was given, how it compares to the largest current position, any cash-shortfall warning) — do not introduce new numbers or a concentration threshold that wasn't given to you.
- devilsAdvocateText should genuinely argue against taking this position, not restate the bear case in different words.
- Keep each field to 2-4 sentences. Be specific to the actual data given, not generic boilerplate that could apply to any stock.`;

const CASE_TOOL = {
  name: "synthesize_case",
  description: "Synthesize an investment case from real market data and computed portfolio-fit numbers.",
  input_schema: {
    type: "object" as const,
    properties: {
      bullCaseText: { type: "string" as const },
      bearCaseText: { type: "string" as const },
      catalystsText: {
        type: "string" as const,
        description: "Plausible events that could move this thesis, grounded in sector/valuation context you were given — not invented specific news.",
      },
      invalidationConditionsText: {
        type: "string" as const,
        description: "What would show this thesis was wrong.",
      },
      marketBlindspotText: { type: "string" as const },
      devilsAdvocateText: { type: "string" as const },
      portfolioFitText: { type: "string" as const },
      synthesisText: { type: "string" as const, description: "A short overall wrap-up, 2-3 sentences." },
    },
    required: [
      "bullCaseText",
      "bearCaseText",
      "catalystsText",
      "invalidationConditionsText",
      "marketBlindspotText",
      "devilsAdvocateText",
      "portfolioFitText",
      "synthesisText",
    ],
  },
};

function formatMarketIntelligence(m: MarketIntelligence): string {
  const lines = [
    `Ticker: ${m.ticker} (${m.companyName})`,
    `Sector: ${m.sector ?? "unknown"} / Industry: ${m.industry ?? "unknown"}`,
    `Price: $${m.price} (${m.changePercentage >= 0 ? "+" : ""}${m.changePercentage.toFixed(2)}% today)`,
    `Market cap: $${m.marketCap.toLocaleString()}`,
    `Beta: ${m.beta ?? "unavailable"}`,
    `52-week range: ${m.fiftyTwoWeekRange ?? "unavailable"}`,
  ];
  if (m.valuationRatiosAvailable) {
    lines.push(
      `P/E (TTM): ${m.peRatioTtm ?? "unavailable"}`,
      `Price/Book (TTM): ${m.priceToBookRatioTtm ?? "unavailable"}`,
      `Price/Sales (TTM): ${m.priceToSalesRatioTtm ?? "unavailable"}`,
      `Dividend yield (TTM): ${m.dividendYieldTtm ?? "unavailable"}`
    );
  } else {
    lines.push("Valuation ratios (P/E, price/book, price/sales, dividend yield): unavailable on the current data plan for this ticker.");
  }
  if (m.description) lines.push(`Description: ${m.description}`);
  return lines.join("\n");
}

function formatPortfolioFit(f: PortfolioFit): string {
  const lines = [
    `Total portfolio value: $${f.totalPortfolioValueUsd.toFixed(2)}${f.totalPortfolioValueApproximate ? " (approximate — some holdings priced at cost basis, not live)" : ""}`,
    `Existing holding in this ticker: ${f.existingHoldingQuantity} shares, $${f.existingPositionValueUsd.toFixed(2)}, ${f.existingWeightPercent.toFixed(1)}% of portfolio`,
    `Number of current holdings: ${f.holdingsCount}`,
  ];
  if (f.largestCurrentPositionTicker) {
    lines.push(
      `Current largest position: ${f.largestCurrentPositionTicker} at ${f.largestCurrentPositionWeightPercent?.toFixed(1)}% of portfolio`
    );
  }
  if (f.projectedPositionValueUsd !== null && f.projectedWeightPercent !== null) {
    lines.push(
      `Projected position value if this hypothetical size is added: $${f.projectedPositionValueUsd.toFixed(2)} (${f.projectedWeightPercent.toFixed(1)}% of portfolio)`
    );
  }
  if (f.warnings.length > 0) lines.push(`Warnings: ${f.warnings.join(" ")}`);
  return lines.join("\n");
}

export async function synthesizeInvestmentCase(input: CaseSynthesisInput): Promise<CaseSynthesis> {
  const userContent = [
    `=== Market data (source: Financial Modeling Prep, fetched ${input.marketIntelligence.fetchedAt}) ===`,
    formatMarketIntelligence(input.marketIntelligence),
    "",
    "=== Portfolio fit (computed) ===",
    formatPortfolioFit(input.portfolioFit),
    ...(input.ideaNoteText ? ["", "=== Investor's own note on this idea ===", input.ideaNoteText] : []),
  ].join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    system: CASE_SYSTEM_PROMPT,
    tools: [CASE_TOOL],
    tool_choice: { type: "tool", name: "synthesize_case" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a case synthesis via the expected tool call.");
  }

  const result = toolUse.input as CaseSynthesis;
  assertNonEmptyStrings(
    result,
    [
      "bullCaseText",
      "bearCaseText",
      "catalystsText",
      "invalidationConditionsText",
      "marketBlindspotText",
      "devilsAdvocateText",
      "portfolioFitText",
      "synthesisText",
    ],
    "synthesize_case"
  );
  return result;
}

// ---------------------------------------------------------------------
// Personal Fit — how this idea/case relates to the investor's own DNA
// hypotheses and Strategy principles (docs/architecture.md §2.5: shown
// separately from Portfolio Fit, "לא ממוצעים"). Every citation is an
// actual DNA hypothesis / Strategy principle id; the caller validates
// them against real rows before storing (src/lib/case/validate-personal-fit.ts),
// same trust boundary as everywhere else AI cites evidence by id.
// ---------------------------------------------------------------------

export interface PersonalFitDnaInput {
  id: string;
  statementText: string;
  evidenceStrength: string;
}

export interface PersonalFitStrategyInput {
  id: string;
  statementText: string;
  principleType: string;
  evidenceStrength: string | null;
}

export interface PersonalFitInput {
  ticker: string;
  ideaNoteText?: string;
  dnaHypotheses: PersonalFitDnaInput[];
  strategyPrinciples: PersonalFitStrategyInput[];
}

export interface ProposedPersonalFit {
  personalFitText: string;
  citedDnaHypothesisIds: string[];
  citedStrategyPrincipleIds: string[];
}

// insufficient_evidence hypotheses/principles are filtered out by the
// caller before this ever runs (src/lib/dna/evidence-strength.ts's
// excludeInsufficientEvidence — see its comment for why: a real gap
// found on real data, where a verbal "say plainly how thin it is" hedge
// still let a thin item lean the conclusion's direction). Nothing
// insufficient_evidence reaches this prompt at all, so there's no
// "mention it but hedge it" tightrope left to walk here — only genuinely
// evidenced items (weak and up) are ever in front of the model.
const PERSONAL_FIT_SYSTEM_PROMPT = `You assess how a potential stock idea fits (or conflicts with) what's actually known about this specific investor — their DNA hypotheses (behavioral patterns, each with an evidence-strength label) and Strategy principles (declared rules, observed patterns, or fixed baseline risk guardrails). Every hypothesis/principle you're given already has real evidence behind it — thin/unconfirmed ones have already been excluded, so you don't need to second-guess whether something you were given is too weak to use.

Write personalFitText in Hebrew — natural, fluent Hebrew, not a forced or literal translation. Keep tickers, company/product names, and established financial terms in English as an investor writing in natural mixed Hebrew/English would. Keep these fixed terms in English exactly as spelled, never translated: DNA, Evidence Strength, Personal Fit, Portfolio Fit, and Strategy (when naming a Strategy principle specifically).

Ground rules:
- Only reference a hypothesis or principle you were actually given, by citing its exact ID. Never invent one.
- Be honest about evidence strength — don't treat a "weak" hypothesis as if it were a confirmed pattern; you can still mention it, but say plainly how thin it is.
- If you were given no DNA hypotheses and no Strategy principles at all, say plainly that there isn't enough personal history yet to assess fit — that is a completely normal, expected result, not a failure. Do not invent a personal-fit narrative from nothing.
- Note both alignment AND conflict where relevant — a hypothesis or principle can just as easily argue against this idea as for it; report that honestly rather than only picking supportive ones.
- Keep it to 2-4 sentences.`;

const PERSONAL_FIT_TOOL = {
  name: "assess_personal_fit",
  description: "Assess how a potential idea fits this investor's actual DNA hypotheses and Strategy principles.",
  input_schema: {
    type: "object" as const,
    properties: {
      personalFitText: { type: "string" as const },
      citedDnaHypothesisIds: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "IDs of DNA hypotheses actually referenced in personalFitText.",
      },
      citedStrategyPrincipleIds: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "IDs of Strategy principles actually referenced in personalFitText.",
      },
    },
    required: ["personalFitText", "citedDnaHypothesisIds", "citedStrategyPrincipleIds"],
  },
};

function formatPersonalFitContext(input: PersonalFitInput): string {
  const parts = [`Ticker under consideration: ${input.ticker}`];
  if (input.ideaNoteText) parts.push(`Investor's own note: ${input.ideaNoteText}`);

  if (input.dnaHypotheses.length > 0) {
    parts.push(
      "\nDNA hypotheses:\n" +
        input.dnaHypotheses
          .map((h) => `- [id: ${h.id}] (${h.evidenceStrength}) ${h.statementText}`)
          .join("\n")
    );
  } else {
    parts.push("\nDNA hypotheses: none yet.");
  }

  if (input.strategyPrinciples.length > 0) {
    parts.push(
      "\nStrategy principles:\n" +
        input.strategyPrinciples
          .map(
            (p) =>
              `- [id: ${p.id}] (${p.principleType}${p.evidenceStrength ? `, ${p.evidenceStrength}` : ""}) ${p.statementText}`
          )
          .join("\n")
    );
  } else {
    parts.push("\nStrategy principles: none yet.");
  }

  return parts.join("\n");
}

export async function synthesizePersonalFit(input: PersonalFitInput): Promise<ProposedPersonalFit> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system: PERSONAL_FIT_SYSTEM_PROMPT,
    tools: [PERSONAL_FIT_TOOL],
    tool_choice: { type: "tool", name: "assess_personal_fit" },
    messages: [{ role: "user", content: formatPersonalFitContext(input) }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a personal-fit assessment via the expected tool call.");
  }

  // Only personalFitText is checked here — citedDnaHypothesisIds/
  // citedStrategyPrincipleIds are arrays that can legitimately be empty
  // (no citations is a normal result), and a genuinely missing array
  // fails loudly on its own the moment the caller maps over it, unlike
  // a missing string quietly becoming an empty field with no error.
  const result = toolUse.input as ProposedPersonalFit;
  assertNonEmptyStrings(result, ["personalFitText"], "assess_personal_fit");
  return result;
}
