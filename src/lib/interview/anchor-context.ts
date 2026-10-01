import { createHash } from "node:crypto";
import {
  computePositions,
  QUANTITY_EPSILON,
  type CorporateActionInput,
  type OpeningStateInput,
  type TransactionInput,
} from "@/lib/portfolio/positions";
import { canonicalDecimal } from "@/lib/import/reconcile";

// Guided Interview PIT contract (Unit 7C-B) — the point-in-time context of one
// historical action ("anchor"), built in code from stored history only.
//
// The anchor boundary is IMMEDIATELY BEFORE the action executes. `before` is
// the position as it stood then, computed by computePositions() itself over
// the transactions strictly before the anchor's date plus the same-day
// transactions whose declared intra-day order is lower; the position math is
// never reimplemented here. `anchor` carries the action's own decided
// attributes separately. A SELL's execution price is never part of the
// context: together with the average cost it would yield the realized return.
//
// Two layers, deliberately apart:
//   - AnchorContextV1 is the AUDIT record persisted on the answer row
//     (interview_answers.anchor_context). It may hold more than the question
//     was allowed to use (prior actions, splits, the opening state).
//   - ExposedFacts is the INFORMATION BOUNDARY: the only facts the factsLine
//     is rendered from, the AI receives, the validator accepts and the hash
//     covers. It is built field by field below, so a field added to the audit
//     record later can never become question content by accident.

export const ANCHOR_CONTEXT_VERSION = 1 as const;
export const PIT_QUESTION_CONTRACT = "interview_question_pit_v1" as const;
export const BOUNDARY_RULE = "strictly_before_date_plus_declared_same_day" as const;

export type AnchorRole = "initial_buy" | "add_buy" | "partial_sell" | "full_sell";
export type CostConfidence = "known" | "approximate" | "unknown";

export interface HistoryTransaction {
  id: string;
  ticker: string | null;
  transactionType: string;
  quantity: number | null;
  price: number | null;
  amount: number;
  transactionDate: Date;
  intraDayOrder: number | null;
}

export interface AnchorHistory {
  transactions: readonly HistoryTransaction[];
  openingStates: readonly OpeningStateInput[];
  corporateActions: readonly CorporateActionInput[];
}

export interface AnchorContextV1 {
  version: typeof ANCHOR_CONTEXT_VERSION;
  anchor: {
    transactionId: string;
    ticker: string;
    side: "buy" | "sell";
    /** YYYY-MM-DD; transactions are stored date-only (00:00Z). */
    date: string;
    quantity: string;
    role: AnchorRole;
    /** The BUY fill price; always null for a SELL. */
    price: string | null;
  };
  /** null only for an initial buy (nothing was held). */
  before: null | {
    sharesHeld: string;
    /** null when the cost confidence is unknown: an average over unknown-cost shares is not a fact. */
    averageCost: string | null;
    costConfidence: CostConfidence;
    entryDate: string;
    daysSinceEntry: number;
    priorBuys: { date: string; quantity: string }[];
    priorSells: { date: string; quantity: string }[];
    /** The opening state the holding has been continuous since, when it started there. */
    openingState: null | { asOfDate: string; quantity: string; costConfidence: CostConfidence };
  };
  boundary: {
    rule: typeof BOUNDARY_RULE;
    sameDay: "none" | "declared";
    splitsApplied: { effectiveDate: string; ratio: string }[];
  };
  factsLine: string;
  generator: null | { contract: typeof PIT_QUESTION_CONTRACT; model: string; validated: true };
}

/** The question's information boundary. Every value here is also in factsLine. */
export interface ExposedFacts {
  ticker: string;
  side: "buy" | "sell";
  role: AnchorRole;
  date: string;
  quantity: string;
  /** BUY only. */
  price: string | null;
  sharesHeld: string | null;
  averageCost: string | null;
  costApproximate: boolean;
  entryDate: string | null;
  daysSinceEntry: number | null;
}

export type AnchorContextResult =
  | { ok: true; context: AnchorContextV1 }
  | { ok: false; reason: "not_found" | "not_a_trade" | "ambiguous_same_day" | "untrusted_history" | "insufficient_holdings" };

const MS_PER_DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
// Fixed scales before canonicalization, so float noise never reaches the snapshot or its hash.
const qty = (n: number) => canonicalDecimal(n.toFixed(6))!;
const money = (n: number) => canonicalDecimal(n.toFixed(2))!;

/** Deterministic order of a ticker's history: date, then declared intra-day order, then id. */
function byTime(a: HistoryTransaction, b: HistoryTransaction): number {
  const d = a.transactionDate.getTime() - b.transactionDate.getTime();
  if (d !== 0) return d;
  const oa = a.intraDayOrder ?? Number.POSITIVE_INFINITY;
  const ob = b.intraDayOrder ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const isTrade = (t: HistoryTransaction) => t.ticker !== null && (t.transactionType === "buy" || t.transactionType === "sell");

function toInput(t: HistoryTransaction): TransactionInput {
  return { id: t.id, ticker: t.ticker, transactionType: t.transactionType as TransactionInput["transactionType"], quantity: t.quantity, price: t.price, amount: t.amount, transactionDate: t.transactionDate, intraDayOrder: t.intraDayOrder };
}

export function buildAnchorContext(history: AnchorHistory, anchorTransactionId: string): AnchorContextResult {
  const anchor = history.transactions.find((t) => t.id === anchorTransactionId);
  if (!anchor) return { ok: false, reason: "not_found" };
  if (!isTrade(anchor) || anchor.quantity === null || !(anchor.quantity > 0)) return { ok: false, reason: "not_a_trade" };
  const ticker = anchor.ticker!;
  const anchorTime = anchor.transactionDate.getTime();
  const tickerTrades = history.transactions.filter((t) => t.ticker === ticker && isTrade(t));

  // Same-day order before the anchor must be authoritative: every trade of
  // this ticker on this date, the anchor included, carries a declared order.
  const sameDay = tickerTrades.filter((t) => t.transactionDate.getTime() === anchorTime && t.id !== anchor.id);
  if (sameDay.length > 0 && (anchor.intraDayOrder === null || sameDay.some((t) => t.intraDayOrder === null))) {
    return { ok: false, reason: "ambiguous_same_day" };
  }
  const predecessors = sameDay.filter((t) => t.intraDayOrder! < anchor.intraDayOrder!);
  const prior = [...tickerTrades.filter((t) => t.transactionDate.getTime() < anchorTime), ...predecessors].sort(byTime);

  // The cutoff is the anchor's date: splits and opening states effective on or
  // before it apply (the accounting applies a same-date action before the
  // transaction); nothing later can.
  const openingStates = history.openingStates.filter((o) => o.ticker === ticker);
  const splits = history.corporateActions.filter((a) => a.ticker === ticker);
  const at = anchor.transactionDate;
  const positionAfter = (rows: HistoryTransaction[]) => computePositions(rows.map(toInput), openingStates, at, splits);

  const state = positionAfter(prior);
  if (state.warnings.some((w) => w.ticker === ticker)) return { ok: false, reason: "untrusted_history" };
  const position = state.positions.find((p) => p.ticker === ticker) ?? null;
  const held = position?.quantity ?? 0;
  const isBuy = anchor.transactionType === "buy";
  if (!isBuy && held < anchor.quantity - QUANTITY_EPSILON) return { ok: false, reason: "insufficient_holdings" };

  const role: AnchorRole = isBuy ? (held <= QUANTITY_EPSILON ? "initial_buy" : "add_buy") : Math.abs(held - anchor.quantity) <= QUANTITY_EPSILON ? "full_sell" : "partial_sell";

  let before: AnchorContextV1["before"] = null;
  if (held > QUANTITY_EPSILON) {
    // Entry = the first trade after the last moment this ticker was flat, found
    // by replaying prefixes through the same accounting; no flat moment at all
    // means the holding is continuous since the applicable opening state.
    let entryIndex = -1;
    for (let j = prior.length - 1; j >= 0; j -= 1) {
      const q = positionAfter(prior.slice(0, j)).positions.find((p) => p.ticker === ticker)?.quantity ?? 0;
      if (q <= QUANTITY_EPSILON) {
        entryIndex = j;
        break;
      }
    }
    const applicableOpening = [...openingStates].filter((o) => o.asOfDate.getTime() <= anchorTime).at(-1) ?? null;
    const fromOpening = entryIndex === -1;
    if (fromOpening && !applicableOpening) return { ok: false, reason: "untrusted_history" };
    const entryDate = fromOpening ? applicableOpening!.asOfDate : prior[entryIndex]!.transactionDate;
    const since = prior.slice(fromOpening ? 0 : entryIndex);
    const confidence = position!.costBasisConfidence as CostConfidence;
    before = {
      sharesHeld: qty(held),
      averageCost: confidence === "unknown" || position!.costBasisPerShare === null ? null : money(position!.costBasisPerShare),
      costConfidence: confidence,
      entryDate: isoDay(entryDate),
      daysSinceEntry: Math.round((anchorTime - entryDate.getTime()) / MS_PER_DAY),
      priorBuys: since.filter((t) => t.transactionType === "buy").map((t) => ({ date: isoDay(t.transactionDate), quantity: qty(t.quantity ?? 0) })),
      priorSells: since.filter((t) => t.transactionType === "sell").map((t) => ({ date: isoDay(t.transactionDate), quantity: qty(t.quantity ?? 0) })),
      openingState: fromOpening ? { asOfDate: isoDay(applicableOpening!.asOfDate), quantity: qty(applicableOpening!.quantity), costConfidence: applicableOpening!.costBasisConfidence as CostConfidence } : null,
    };
  }

  const context: AnchorContextV1 = {
    version: ANCHOR_CONTEXT_VERSION,
    anchor: {
      transactionId: anchor.id,
      ticker,
      side: isBuy ? "buy" : "sell",
      date: isoDay(anchor.transactionDate),
      quantity: qty(anchor.quantity),
      role,
      price: isBuy && anchor.price !== null ? money(anchor.price) : null,
    },
    before,
    boundary: {
      rule: BOUNDARY_RULE,
      sameDay: sameDay.length > 0 ? "declared" : "none",
      splitsApplied: splits
        .filter((a) => a.effectiveDate.getTime() <= anchorTime)
        .sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime())
        .map((a) => ({ effectiveDate: isoDay(a.effectiveDate), ratio: `${a.ratioNumerator}:${a.ratioDenominator}` })),
    },
    factsLine: "",
    generator: null,
  };
  context.factsLine = renderFactsLine(exposedFacts(context));
  return { ok: true, context };
}

/** The information boundary, field by field. Nothing outside this list may reach a question. */
export function exposedFacts(context: AnchorContextV1): ExposedFacts {
  const { anchor, before } = context;
  return {
    ticker: anchor.ticker,
    side: anchor.side,
    role: anchor.role,
    date: anchor.date,
    quantity: anchor.quantity,
    price: anchor.side === "buy" ? anchor.price : null,
    sharesHeld: before?.sharesHeld ?? null,
    averageCost: before?.averageCost ?? null,
    costApproximate: before?.costConfidence === "approximate",
    entryDate: before?.entryDate ?? null,
    daysSinceEntry: before?.daysSinceEntry ?? null,
  };
}

/** dd/mm/yyyy, the format every question uses. */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function renderFactsLine(f: ExposedFacts): string {
  const day = formatDay(f.date);
  const price = f.price !== null ? `, במחיר $${f.price} למניה` : "";
  const action =
    f.role === "initial_buy" || f.role === "add_buy"
      ? `קנייה של ${f.quantity} מניות ${f.ticker} ב-${day}${price}.`
      : f.role === "full_sell"
        ? `מכירה של כל ${f.quantity} מניות ${f.ticker} שהוחזקו, ב-${day}.`
        : `מכירה של ${f.quantity} מתוך ${f.sharesHeld} מניות ${f.ticker}, ב-${day}.`;
  if (f.sharesHeld === null) return `${action} לפני הקנייה לא הוחזקו מניות ${f.ticker}.`;
  const cost = f.averageCost !== null ? ` בעלות ממוצעת של $${f.averageCost} למניה${f.costApproximate ? " (משוערת)" : ""}` : "";
  return `${action} לפני הפעולה הוחזקו ${f.sharesHeld} מניות${cost}, מאז ${formatDay(f.entryDate!)} (${f.daysSinceEntry} ימים).`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/**
 * The hash returned by interview.start and verified at answer time. It covers
 * exactly what the question was allowed to know: the snapshot version, the
 * anchor transaction and the exposed facts (from which factsLine is rendered).
 * Audit-only fields (prior action dates, splits, the opening state record)
 * are deliberately outside it, so a change there cannot cause a false
 * mismatch; any change to an exposed fact changes the hash.
 */
export function anchorContextHash(context: AnchorContextV1): string {
  const material = { version: context.version, anchorTransactionId: context.anchor.transactionId, exposed: exposedFacts(context) };
  return createHash("sha256").update(stableJson(material)).digest("hex");
}

/** Shape check for a persisted snapshot, so readers never trust an unknown version. */
export function isAnchorContextV1(value: unknown): value is AnchorContextV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const a = v.anchor as Record<string, unknown> | undefined;
  return v.version === ANCHOR_CONTEXT_VERSION && typeof v.factsLine === "string" && typeof a === "object" && a !== null && typeof a.ticker === "string" && typeof a.date === "string";
}
