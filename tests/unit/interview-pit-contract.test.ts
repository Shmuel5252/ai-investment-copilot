import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  anchorContextHash,
  buildAnchorContext,
  exposedFacts,
  renderFactsLine,
  type AnchorContextV1,
  type AnchorHistory,
  type HistoryTransaction,
} from "@/lib/interview/anchor-context";
import { fallbackQuestion, validatePitQuestion } from "@/lib/interview/question-safety";
import { anthropic } from "@/lib/ai/client";
import { generatePitQuestion } from "@/lib/ai/interview";

// Unit 7C-B — the Guided Interview point-in-time contract, DB-free: the
// anchor context (state strictly before the action, through the real
// computePositions), the exposed-facts boundary, the deterministic
// validator and fallback, the hash, and the AI request shape. No real AI.

vi.mock("@/lib/ai/client", () => ({ anthropic: { messages: { create: vi.fn() } }, CLAUDE_MODEL: "claude-test" }));
const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;

type Spec = { id: string; ticker?: string; type: "buy" | "sell" | "dividend"; date: string; qty?: number; price?: number; order?: number | null };
const tx = (s: Spec): HistoryTransaction => ({
  id: s.id,
  ticker: s.ticker ?? "QRST",
  transactionType: s.type,
  quantity: s.qty ?? null,
  price: s.price ?? null,
  amount: s.type === "buy" ? -(s.qty ?? 0) * (s.price ?? 0) : (s.qty ?? 0) * (s.price ?? 0),
  transactionDate: new Date(`${s.date}T00:00:00Z`),
  intraDayOrder: s.order ?? null,
});
const history = (specs: Spec[], extra: Partial<AnchorHistory> = {}): AnchorHistory => ({ transactions: specs.map(tx), openingStates: [], corporateActions: [], ...extra });
function ctxOf(h: AnchorHistory, id: string): AnchorContextV1 {
  const r = buildAnchorContext(h, id);
  if (!r.ok) throw new Error(`expected a context, got ${r.reason}`);
  return r.context;
}

// One position: entry, add-on, partial sell, full sell, then a re-entry.
const LIFE: Spec[] = [
  { id: "b1", type: "buy", date: "2026-06-11", qty: 200, price: 8.05 },
  { id: "b2", type: "buy", date: "2026-07-01", qty: 100, price: 6.9 },
  { id: "s1", type: "sell", date: "2026-08-14", qty: 120, price: 11.4 },
  { id: "s2", type: "sell", date: "2026-09-02", qty: 180, price: 13.75 },
  { id: "b3", type: "buy", date: "2026-09-20", qty: 50, price: 12 },
];

describe("anchor context — state strictly before the action, through the real accounting", () => {
  const h = history(LIFE);

  it("initial buy: nothing held before, the buy's own price is allowed", () => {
    const c = ctxOf(h, "b1");
    expect(c.anchor).toEqual({ transactionId: "b1", ticker: "QRST", side: "buy", date: "2026-06-11", quantity: "200", role: "initial_buy", price: "8.05" });
    expect(c.before).toBeNull();
    expect(c.boundary).toEqual({ rule: "strictly_before_date_plus_declared_same_day", sameDay: "none", splitsApplied: [] });
    expect(c.generator).toBeNull();
  });

  it("add-on buy: the position before it, average cost and entry", () => {
    const c = ctxOf(h, "b2");
    expect(c.anchor.role).toBe("add_buy");
    expect(c.before).toMatchObject({ sharesHeld: "200", averageCost: "8.05", costConfidence: "known", entryDate: "2026-06-11", daysSinceEntry: 20, priorBuys: [{ date: "2026-06-11", quantity: "200" }], priorSells: [], openingState: null });
  });

  it("partial sell: no execution price anywhere, only what was held before", () => {
    const c = ctxOf(h, "s1");
    expect(c.anchor).toMatchObject({ side: "sell", role: "partial_sell", quantity: "120", price: null });
    expect(c.before).toMatchObject({ sharesHeld: "300", averageCost: "7.67", entryDate: "2026-06-11", daysSinceEntry: 64 });
    expect(JSON.stringify(c)).not.toMatch(/11\.4/);
    expect(c.factsLine).not.toMatch(/11\.4|\$11/);
  });

  it("full sell: the role says the whole holding is sold; no price, no return", () => {
    const c = ctxOf(h, "s2");
    expect(c.anchor).toMatchObject({ role: "full_sell", quantity: "180", price: null });
    expect(c.before).toMatchObject({ sharesHeld: "180", priorSells: [{ date: "2026-08-14", quantity: "120" }] });
    expect(JSON.stringify(c)).not.toMatch(/13\.75|%/);
  });

  it("a re-entry after the position went flat is an initial buy of a new holding", () => {
    expect(ctxOf(h, "b3").anchor.role).toBe("initial_buy");
    expect(ctxOf(h, "b3").before).toBeNull();
  });

  it("later actions never enter: adding trades after the anchor changes neither the snapshot nor its hash", () => {
    const shorter = history(LIFE.slice(0, 2));
    expect(ctxOf(h, "b2")).toEqual(ctxOf(shorter, "b2"));
    expect(anchorContextHash(ctxOf(h, "b2"))).toBe(anchorContextHash(ctxOf(shorter, "b2")));
  });

  it("a split before the anchor applies to the units; a split after it never does", () => {
    const split = (date: string) => ({ ticker: "QRST", effectiveDate: new Date(`${date}T00:00:00Z`), ratioNumerator: 4, ratioDenominator: 1 });
    const before = ctxOf(history(LIFE, { corporateActions: [split("2026-06-20")] }), "b2");
    expect(before.before).toMatchObject({ sharesHeld: "800", averageCost: "2.01" });
    expect(before.boundary.splitsApplied).toEqual([{ effectiveDate: "2026-06-20", ratio: "4:1" }]);
    const after = ctxOf(history(LIFE, { corporateActions: [split("2026-07-20")] }), "b2");
    expect(after.before).toMatchObject({ sharesHeld: "200", averageCost: "8.05" });
    expect(after.boundary.splitsApplied).toEqual([]);
  });

  it("an opening state: approximate cost is marked, unknown cost is not a fact, the holding is continuous since it", () => {
    const os = (conf: "approximate" | "unknown") => [{ ticker: "QRST", quantity: 40, costBasisPerShare: conf === "unknown" ? null : 5, costBasisConfidence: conf, asOfDate: new Date("2026-05-31T00:00:00Z") }];
    const sells = [{ id: "s", type: "sell" as const, date: "2026-06-10", qty: 10, price: 9 }];
    const approx = ctxOf(history(sells, { openingStates: os("approximate") }), "s");
    expect(approx.before).toMatchObject({ sharesHeld: "40", averageCost: "5", costConfidence: "approximate", entryDate: "2026-05-31", openingState: { asOfDate: "2026-05-31", quantity: "40", costConfidence: "approximate" } });
    expect(approx.factsLine).toContain("(משוערת)");
    const unknown = ctxOf(history(sells, { openingStates: os("unknown") }), "s");
    expect(unknown.before).toMatchObject({ averageCost: null, costConfidence: "unknown" });
    expect(unknown.factsLine).not.toMatch(/עלות|\$/);
  });

  it("same day: a declared predecessor is part of 'before'; an undeclared group fails closed", () => {
    const declared = history([
      { id: "a", type: "buy", date: "2026-03-02", qty: 10, price: 5, order: 1 },
      { id: "b", type: "sell", date: "2026-03-02", qty: 4, price: 6, order: 2 },
    ]);
    expect(ctxOf(declared, "b").before).toMatchObject({ sharesHeld: "10" });
    expect(ctxOf(declared, "b").boundary.sameDay).toBe("declared");
    expect(ctxOf(declared, "a").before).toBeNull();
    const undeclared = history([
      { id: "a", type: "buy", date: "2026-03-02", qty: 10, price: 5 },
      { id: "b", type: "sell", date: "2026-03-02", qty: 4, price: 6 },
    ]);
    expect(buildAnchorContext(undeclared, "b")).toEqual({ ok: false, reason: "ambiguous_same_day" });
    expect(buildAnchorContext(undeclared, "a")).toEqual({ ok: false, reason: "ambiguous_same_day" });
  });

  it("fails closed on untrusted or insufficient history, and on a non-trade", () => {
    const over = history([{ id: "s0", type: "sell", date: "2026-01-02", qty: 5, price: 1 }, { id: "b", type: "buy", date: "2026-02-02", qty: 5, price: 1 }]);
    expect(buildAnchorContext(over, "s0")).toEqual({ ok: false, reason: "insufficient_holdings" });
    expect(buildAnchorContext(over, "b")).toEqual({ ok: false, reason: "untrusted_history" });
    expect(buildAnchorContext(history([{ id: "d", type: "dividend", date: "2026-01-02" }]), "d")).toEqual({ ok: false, reason: "not_a_trade" });
    expect(buildAnchorContext(history(LIFE), "missing")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the exposed-facts boundary", () => {
  const c = ctxOf(history(LIFE), "s2");

  it("exposes only the listed facts, and the facts line is rendered from them alone", () => {
    expect(Object.keys(exposedFacts(c)).sort()).toEqual(["averageCost", "costApproximate", "date", "daysSinceEntry", "entryDate", "price", "quantity", "role", "sharesHeld", "side", "ticker"]);
    expect(c.factsLine).toBe(renderFactsLine(exposedFacts(c)));
  });

  it("an audit-only value in the snapshot cannot become question content", () => {
    // the earlier partial sale's date is in before.priorSells (audit), not exposed
    expect(c.before!.priorSells[0]!.date).toBe("2026-08-14");
    expect(validatePitQuestion("מה גרם לך למכור את QRST ב-14/08/2026?", exposedFacts(c)).ok).toBe(false);
    // an exposed fact can
    expect(validatePitQuestion("מה גרם לך למכור את כל 180 מניות QRST ב-02/09/2026?", exposedFacts(c)).ok).toBe(true);
  });

  it("an audit-only field added later neither changes the hash nor authorizes wording", () => {
    const widened = { ...c, before: { ...c.before!, extraAuditNumber: "999" } } as unknown as AnchorContextV1;
    expect(exposedFacts(widened)).toEqual(exposedFacts(c));
    expect(anchorContextHash(widened)).toBe(anchorContextHash(c));
    expect(validatePitQuestion("למה מכרת 999 מניות QRST?", exposedFacts(widened)).ok).toBe(false);
  });
});

describe("validatePitQuestion — deterministic, strict, against exposed facts only", () => {
  const facts = exposedFacts(ctxOf(history(LIFE), "s1"));
  const rejects = (q: string) => expect(validatePitQuestion(q, facts).ok, q).toBe(false);
  const accepts = (q: string) => expect(validatePitQuestion(q, facts), q).toEqual({ ok: true });

  it("accepts a question built from the anchor's own facts", () => {
    accepts("מה גרם לך למכור 120 מתוך 300 מניות QRST ב-14/08/2026?");
    accepts("ב-14/08/2026 החזקת את QRST כבר 64 ימים, בעלות ממוצעת של $7.67. מה עמד מאחורי ההחלטה למכור חלק?");
    accepts("מה הוביל אותך לפעולה הזו באותו רגע?");
  });

  it("rejects percentages", () => {
    rejects("האם 40% מהפוזיציה הספיקו לך?");
    rejects("כמה אחוזים מכרת?");
  });

  it("rejects gain, loss and return framing in Hebrew and English, any casing or spacing", () => {
    for (const q of ["מה עשית עם הרווח?", "איך הרגשת עם ההפסד?", "מה הייתה התשואה?", "מכרת ברווחים?", "Did you lock in a GAIN?", "after the  Loss?", "your Return on QRST?", "P & L of QRST?", "a big Winner?"]) rejects(q);
  });

  it("rejects outcome, ranking and after-the-fact language", () => {
    for (const q of ["העסקה הגדולה ביותר שלך?", "הכי מוצלחת?", "מה קרה אחר כך?", "בדיעבד, היית מוכר?", "בסופו של דבר?", "מה התברר?", "your best trade?", "what happened later?", "it turned out well?", "after you exited?"]) rejects(q);
  });

  it("rejects price movement and multiples the facts never carry", () => {
    for (const q of ["למה מכרת אחרי שהמניה עלתה?", "אחרי הירידה במחיר?", "כשההשקעה הוכפלה?", "after it rose?", "once it Doubled?", "after the stock fell?"]) rejects(q);
    accepts("מה עלה בדעתך כשמכרת?");
  });

  it("rejects exit framing except for a full sell", () => {
    rejects("למה החלטת לצאת מהפוזיציה?");
    const full = exposedFacts(ctxOf(history(LIFE), "s2"));
    expect(validatePitQuestion("למה החלטת לצאת מהפוזיציה ב-02/09/2026?", full).ok).toBe(true);
  });

  it("rejects a foreign ticker or any other Latin token", () => {
    rejects("למה מכרת QRST ולא ABCD?");
    rejects("מה ה-P/E היה אז?");
    accepts("למה מכרת qrst?");
  });

  it("rejects a date or month not in the exposed facts", () => {
    rejects("מה ידעת ב-01/09/2026?");
    rejects("ב-2026-09-01 מכרת?");
    rejects("מה קרה באוגוסט?");
    rejects("in August?");
    accepts("מה ידעת ב-14.08.2026?");
  });

  it("rejects any number or currency amount not in the exposed facts, after normalization", () => {
    rejects("מכרת ב-$11.40?");
    rejects("מכרת 121 מניות?");
    rejects("האם 1,200 מניות?");
    rejects("החזקת 65 ימים?");
    accepts("החזקת 300 מניות בעלות של $7.67?");
    accepts("120‏ מניות?");
  });

  it("does not trip on Hebrew words that merely contain a short forbidden term", () => {
    accepts("מאיזו סיבה מכרת? האם התכוונת להכין מקום לרעיון אחר?");
  });
});

describe("fallbackQuestion", () => {
  const h = history(LIFE);
  it.each([["b1", "initial_buy"], ["b2", "add_buy"], ["s1", "partial_sell"], ["s2", "full_sell"]])("%s (%s) passes the same validator and names no forbidden fact", (id, role) => {
    const facts = exposedFacts(ctxOf(h, id));
    expect(facts.role).toBe(role);
    const q = fallbackQuestion(facts);
    expect(validatePitQuestion(q, facts)).toEqual({ ok: true });
    expect(q).not.toMatch(/%|רווח|הפסד|תשואה|11\.4|13\.75/);
  });
});

describe("anchorContextHash", () => {
  it("is deterministic and depends only on the exposed facts", () => {
    const a = ctxOf(history(LIFE), "s1");
    const b = ctxOf(history(LIFE), "s1");
    expect(anchorContextHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(anchorContextHash(a)).toBe(anchorContextHash(b));
    expect(anchorContextHash({ ...a, generator: { contract: "interview_question_pit_v1", model: "m", validated: true } })).toBe(anchorContextHash(a));
  });

  it("changes when what the question may know changes", () => {
    const base = anchorContextHash(ctxOf(history(LIFE), "s1"));
    const changedEarlier = LIFE.map((s) => (s.id === "b2" ? { ...s, qty: 101 } : s));
    expect(anchorContextHash(ctxOf(history(changedEarlier), "s1"))).not.toBe(base);
    const changedAnchor = LIFE.map((s) => (s.id === "s1" ? { ...s, qty: 119 } : s));
    expect(anchorContextHash(ctxOf(history(changedAnchor), "s1"))).not.toBe(base);
  });
});

describe("generatePitQuestion — the model receives the facts line and nothing else", () => {
  beforeEach(() => create.mockReset());
  const line = ctxOf(history(LIFE), "s1").factsLine;

  it("sends exactly one user message: the facts line", async () => {
    create.mockResolvedValue({ content: [{ type: "tool_use", name: "ask_question", input: { question: "  מה גרם לך למכור?  " } }] });
    await expect(generatePitQuestion(line)).resolves.toBe("מה גרם לך למכור?");
    const req = create.mock.calls[0]![0];
    expect(req.messages).toEqual([{ role: "user", content: line }]);
    expect(req.tool_choice).toEqual({ type: "tool", name: "ask_question" });
    expect(JSON.stringify(req)).not.toMatch(/biggest_gain|realizedPnl|holdingPeriod|category/);
  });

  it("returns null for a malformed response (the caller falls back); a transport failure is covered by the router test", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "no tool" }] });
    await expect(generatePitQuestion(line)).resolves.toBeNull();
    create.mockResolvedValue({ content: [{ type: "tool_use", name: "ask_question", input: { question: "   " } }] });
    await expect(generatePitQuestion(line)).resolves.toBeNull();
  });
});
