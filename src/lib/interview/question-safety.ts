import { formatDay, type ExposedFacts } from "./anchor-context";

// Guided Interview PIT contract (Unit 7C-B) — the deterministic gate every
// question passes before an investor sees it, and again when the answer is
// stored. It judges the wording against the EXPOSED facts only (never the
// full audit snapshot): every number, date and Latin token in the question
// must be one of those facts, and nothing may speak of results, rankings or
// what happened after the action. A rejection is not an error: the caller
// uses fallbackQuestion(), which is built from the same facts. There is no
// second AI call. Deliberately strict: a false rejection costs only a less
// specific question; a false acceptance would put hindsight in a stored row.

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] };

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const normalize = (text: string) => text.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

// Results, rankings, selection reasons and after-the-fact framing. Hebrew is
// matched as a substring (prefix letters attach to words), English on word
// boundaries, both case-insensitively.
const FORBIDDEN_HE = [
  "רווח", "הרוויח", "הרווחת", "הפסד", "הפסיד", "תשואה", "תשואות", "ביצועי", "תוצאה", "תוצאות", "מנצח", "מפסיד",
  "ביותר", "בדיעבד", "אחר כך", "אחר-כך", "לאחר מכן", "מאוחר יותר", "בסופו של דבר", "התברר", "בהמשך",
  "הצליח", "הצלחה", "כישלון", "נכשל", "זינק", "קרס", "צנח", "מימש", "מימוש",
  // price movement and multiples: the facts line never carries them, so any
  // mention is information the question was not given
  "עלתה", "ירדה", "עלייה", "ירידה", "התאוששה", "הוכפל", "הכפיל", "הכפלת",
];
// Short words that also occur inside unrelated words ("להכין", "מאיזו"):
// matched as whole Hebrew words, after one optional prefix letter.
const FORBIDDEN_HE_WORDS = new Set(["הכי", "שיא", "סוף"]);
const MONTHS_HE = new Set(["ינואר", "פברואר", "מרץ", "מרס", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]);
const PREFIX = /^[בלהמוכש]/;
function hebrewWords(text: string): string[] {
  return text.split(/[^א-ת]+/).filter(Boolean);
}
const hasWord = (words: string[], set: ReadonlySet<string>) => words.some((w) => set.has(w) || (w.length > 2 && PREFIX.test(w) && set.has(w.slice(1))));
const FORBIDDEN_EN =
  /\b(gains?|gained|loss(es)?|lost|los(e|ing)|profit(s|able)?|returns?|returned|p\s*&\s*l|pnl|winners?|losers?|outcomes?|results?|performance|biggest|best|worst|largest|longest|quickest|fastest|flip(ped|s)?|later|afterwards?|eventually|ended up|turned out|hindsight|since then|closed?|exit(ed)?|rose|risen|fell|fallen|dropped|rall(y|ied)|surged?|crashed|plunged|doubled|tripled)\b/i;
// Leaving or closing the position is the decision itself only for a full sell.
const EXIT_HE = ["יציאה", "לצאת", "יצאת", "סגרת", "סגירת", "נסגר"];
const MONTHS_EN = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/g;
const NUMBER = /\$?\d+(?:[.,]\d+)*/g;
const LATIN = /[A-Za-z][A-Za-z.]*/g;

function toIsoDate(m: RegExpExecArray): string | null {
  const [y, mo, d] = m[1] ? [m[1], m[2]!, m[3]!] : [m[6]!.length === 2 ? `20${m[6]}` : m[6]!, m[5]!, m[4]!];
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function parseNumber(raw: string): number {
  const s = raw.replace(/^\$/, "");
  // 1,200 or 1,200.50 is a thousands separator; any other comma is a decimal comma.
  const cleaned = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  return Number(cleaned);
}

export function validatePitQuestion(question: string, facts: ExposedFacts): ValidationResult {
  const reasons: string[] = [];
  const text = normalize(question);
  const lower = text.toLowerCase();
  if (text === "") return { ok: false, reasons: ["empty"] };
  if (text.length > 500) reasons.push("too_long");
  if (text.includes("%") || lower.includes("אחוז")) reasons.push("percent");
  for (const w of FORBIDDEN_HE) if (lower.includes(w)) reasons.push(`forbidden:${w}`);
  const en = FORBIDDEN_EN.exec(lower);
  if (en) reasons.push(`forbidden:${en[0]}`);
  const words = hebrewWords(text);
  if (hasWord(words, FORBIDDEN_HE_WORDS)) reasons.push("forbidden:word");
  if (facts.role !== "full_sell") for (const w of EXIT_HE) if (lower.includes(w)) reasons.push(`exit_framing:${w}`);
  if (MONTHS_EN.test(text) || hasWord(words, MONTHS_HE)) reasons.push("month_name");

  const allowedDates = new Set([facts.date, facts.entryDate].filter((d): d is string => d !== null));
  let rest = text;
  for (const m of text.matchAll(DATE)) {
    const iso = toIsoDate(m as RegExpExecArray);
    if (!iso || !allowedDates.has(iso)) reasons.push(`foreign_date:${m[0]}`);
    rest = rest.replace(m[0], " ");
  }

  const amounts = [facts.price, facts.averageCost].filter((v): v is string => v !== null).map(Number);
  const numbers = [facts.quantity, facts.sharesHeld, facts.price, facts.averageCost].filter((v): v is string => v !== null).map(Number);
  if (facts.daysSinceEntry !== null) numbers.push(facts.daysSinceEntry);
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  for (const m of rest.matchAll(NUMBER)) {
    const value = parseNumber(m[0]);
    const pool = m[0].startsWith("$") ? amounts : numbers;
    if (!Number.isFinite(value) || !pool.some((n) => same(n, value))) reasons.push(`foreign_number:${m[0]}`);
  }

  for (const m of text.matchAll(LATIN)) {
    const token = m[0].replace(/\.+$/, "");
    if (token.toUpperCase() !== facts.ticker.toUpperCase()) reasons.push(`foreign_token:${token}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** The deterministic question for each role, from the exposed facts only. It passes validatePitQuestion by construction (tested). */
export function fallbackQuestion(f: ExposedFacts): string {
  const day = formatDay(f.date);
  switch (f.role) {
    case "initial_buy":
      return `מה הוביל אותך לקנות ${f.quantity} מניות ${f.ticker} ב-${day}, ומה היה הרעיון שלך באותו רגע?`;
    case "add_buy":
      return `ב-${day} הוספת ${f.quantity} מניות ${f.ticker} לפוזיציה של ${f.sharesHeld} מניות. מה גרם לך להגדיל את הפוזיציה דווקא אז?`;
    case "partial_sell":
      return `ב-${day} מכרת ${f.quantity} מתוך ${f.sharesHeld} מניות ${f.ticker}. מה גרם לך למכור חלק מהפוזיציה דווקא אז?`;
    case "full_sell":
      return `ב-${day} מכרת את כל ${f.quantity} מניות ${f.ticker} שהחזקת. מה הוביל אותך לצאת מהפוזיציה באותו רגע?`;
  }
}
