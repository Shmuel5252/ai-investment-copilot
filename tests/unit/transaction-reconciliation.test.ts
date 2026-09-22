// History Refresh V1 — the pure reconciliation engine
// (src/lib/import/reconcile.ts). Every case runs the production functions;
// nothing here re-implements identity, rounding or the multiset rule.
import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  decimalScale,
  isNearMatch,
  nearDecimal,
  planInsertions,
  reconcileTransactions,
  ReconciliationError,
  roundDecimalString,
  transactionIdentityKey,
  type ExistingTransaction,
  type IncomingTransaction,
  type ReconciliationResolution,
  type TransactionSource,
} from "@/lib/import/reconcile";
import type { CanonicalTransactionType } from "@/lib/import/types";

type Spec = {
  ticker?: string | null;
  type?: CanonicalTransactionType;
  date?: string;
  qty?: number | string | null;
  price?: number | string | null;
  amount?: number | string;
  source?: TransactionSource;
};

const base = { ticker: "MP", type: "buy" as CanonicalTransactionType, date: "2026-08-05T00:00:00Z", qty: 20.6521, price: 48.42 };

function row(spec: Spec = {}) {
  const s = { ...base, ...spec };
  const type = s.type;
  const amount =
    s.amount !== undefined
      ? s.amount
      : s.qty !== null && s.qty !== undefined && s.price !== null && s.price !== undefined
        ? Math.abs(Number(s.qty) * Number(s.price)) * (type === "buy" ? -1 : 1)
        : 0;
  return {
    ticker: s.ticker === undefined ? "MP" : s.ticker,
    transactionType: type,
    quantity: s.qty === undefined ? null : s.qty,
    price: s.price === undefined ? null : s.price,
    amount,
    transactionDate: new Date(s.date),
    source: s.source ?? "csv_import",
  };
}
let idSeq = 0;
const existing = (spec: Spec = {}): ExistingTransaction => ({ id: `e${String(++idSeq).padStart(3, "0")}`, ...row(spec) });
const incoming = (key: string, spec: Spec = {}): IncomingTransaction => ({ clientRowKey: key, ...row(spec) });
const csv = (inc: IncomingTransaction[], ex: ExistingTransaction[]) => reconcileTransactions(inc, ex, { mode: "csv_import" });
const manual = (inc: IncomingTransaction[], ex: ExistingTransaction[]) =>
  reconcileTransactions(
    inc.map((r) => ({ ...r, source: "manual_entry" as const })),
    ex,
    { mode: "manual_entry" }
  );
const classes = (r: ReturnType<typeof csv>) => r.rows.map((x) => x.class);
// Resolutions are bound to the previewed row's identity, exactly as the UI sends them.
const ik = (r: ReturnType<typeof csv>, key: string) => r.rows.find((x) => x.clientRowKey === key)!.identityKey;
const res = (r: ReturnType<typeof csv>, key: string, action: "same" | "separate", existingTransactionId?: string): ReconciliationResolution => ({
  clientRowKey: key,
  identityKey: ik(r, key),
  action,
  existingTransactionId,
});

describe("numeric canonical form (identity)", () => {
  it("strips IEEE-754 noise that String(number) leaks into numeric columns — the real MRVL manual row", () => {
    expect(canonicalDecimal("-999.9901229999999")).toBe("-999.990123"); // 4.5419 × 220.17
    expect(canonicalDecimal(4.5419 * 220.17)).toBe("999.990123");
    expect(canonicalDecimal(20.6521 * 48.42)).toBe("999.974682");
  });
  it("is representation-independent for equal values and keeps every real digit", () => {
    expect(canonicalDecimal("238.10")).toBe("238.1");
    expect(canonicalDecimal(238.1)).toBe("238.1");
    expect(canonicalDecimal("20.6521")).toBe("20.6521");
    expect(canonicalDecimal("0.00000001")).toBe("0.00000001");
    expect(canonicalDecimal(-0)).toBe("0");
    expect(canonicalDecimal("-0.000000001")).toBe("0"); // below IDENTITY_SCALE
    expect(canonicalDecimal(null)).toBeNull();
    expect(() => canonicalDecimal("abc")).toThrow();
  });
  it("adversarial floats: binary artifacts vanish, real digits stay, sub-scale values collapse to 0, out-of-range fails loudly", () => {
    expect(canonicalDecimal(0.1 + 0.2)).toBe("0.3");
    expect(canonicalDecimal(1.005)).toBe("1.005");
    expect(canonicalDecimal(2.675)).toBe("2.675");
    expect(canonicalDecimal(1e-9)).toBe("0"); // below IDENTITY_SCALE: documented floor
    expect(canonicalDecimal(0.0434)).toBe("0.0434"); // smallest real quantity in the imported history
    expect(canonicalDecimal(630.517)).toBe("630.517");
    expect(canonicalDecimal(-5932.86)).toBe("-5932.86");
    expect(canonicalDecimal("00012.500")).toBe("12.5");
    expect(canonicalDecimal(1e20)).toBe("100000000000000000000");
    expect(() => canonicalDecimal(1e21)).toThrow(/out of supported range/); // toFixed would give "1e+21"
    expect(() => canonicalDecimal(Infinity)).toThrow();
  });
  it("identity key covers ticker/type/date/quantity/price/amount with normalized ticker", () => {
    const a = transactionIdentityKey(row());
    expect(a).toBe(transactionIdentityKey(row({ ticker: " mp " })));
    expect(a).not.toBe(transactionIdentityKey(row({ type: "sell" })));
    expect(a).not.toBe(transactionIdentityKey(row({ date: "2026-08-06T00:00:00Z" })));
    expect(a).not.toBe(transactionIdentityKey(row({ qty: 20.6522 })));
    expect(a).not.toBe(transactionIdentityKey(row({ price: 48.43 })));
    expect(a).not.toBe(transactionIdentityKey(row({ amount: -998.47 }))); // same trade, commission folded in
    expect(transactionIdentityKey(row({ ticker: null, type: "fee", qty: null, price: null, amount: -1 }))).toBe("|fee|2026-08-05T00:00:00.000Z|||-1");
  });
});

describe("decimal-string rounding and the near rule", () => {
  it("rounds half-up on decimal digits, never through a float", () => {
    expect(roundDecimalString("20.655", 2)).toBe("20.66");
    expect(roundDecimalString("1.005", 2)).toBe("1.01"); // (1.005).toFixed(2) would give 1.00
    expect(roundDecimalString("20.6549", 2)).toBe("20.65");
    expect(roundDecimalString("9.999", 2)).toBe("10");
    expect(roundDecimalString("-0.004", 2)).toBe("0");
    expect(roundDecimalString("-2.675", 2)).toBe("-2.68");
    expect(roundDecimalString("48.42", 4)).toBe("48.42");
    expect(decimalScale("48.42")).toBe(2);
    expect(decimalScale("48")).toBe(0);
  });
  it("two recorded values agree at the coarser of their precisions — boundaries", () => {
    expect(nearDecimal("20.65", "20.6521")).toBe(true); // typed rounding of the broker value
    expect(nearDecimal("20.65", "20.6549")).toBe(true);
    expect(nearDecimal("20.65", "20.655")).toBe(false); // rounds to 20.66
    expect(nearDecimal("20.6521", "20.6522")).toBe(false); // same scale, different digit
    expect(nearDecimal("48.4", "48.42")).toBe(true);
    expect(nearDecimal("48.4", "48.45")).toBe(false);
    expect(nearDecimal("21", "20.6521")).toBe(true); // 20.6521 → 21 at scale 0
    expect(nearDecimal("20", "20.6521")).toBe(false);
    expect(nearDecimal(null, null)).toBe(true);
    expect(nearDecimal(null, "1")).toBe(false);
  });
  it("isNearMatch: same ticker/type/date and near quantity+price, only when a manual row is involved", () => {
    const m = row({ source: "manual_entry" });
    expect(isNearMatch(row({ amount: -998.47 }), m)).toBe(true); // commission-only difference
    expect(isNearMatch(row({ qty: 20.65, amount: -998.47 }), m)).toBe(true);
    expect(isNearMatch(row({ price: 48.5 }), m)).toBe(false);
    expect(isNearMatch(row({ type: "sell" }), { ...m, transactionType: "sell", amount: 999 })).toBe(true);
    expect(isNearMatch(row({ type: "sell" }), m)).toBe(false);
    expect(isNearMatch(row({ date: "2026-08-06T00:00:00Z" }), m)).toBe(false);
    expect(isNearMatch(row({ ticker: "MRVL" }), m)).toBe(false);
    expect(isNearMatch(row({ amount: -998.47 }), row())).toBe(false); // csv vs csv: identical or different, never "near"
    const fee = row({ ticker: null, type: "fee", qty: null, price: null, amount: -1.5 });
    expect(isNearMatch(fee, { ...fee, amount: "-1.50", source: "manual_entry" })).toBe(true);
    expect(isNearMatch(fee, { ...fee, amount: -1.6, source: "manual_entry" })).toBe(false);
  });
});

describe("exact identity — multiset semantics", () => {
  it("existing A,A + incoming A,A,A → 2 exact duplicates, 1 new", () => {
    const r = csv([incoming("0"), incoming("1"), incoming("2")], [existing(), existing()]);
    expect(classes(r)).toEqual(["exact_duplicate", "exact_duplicate", "new"]);
    expect(new Set(r.rows.slice(0, 2).map((x) => x.matchedExistingId)).size).toBe(2); // each consumes a different row
    expect(r.counts).toEqual({ new: 1, exact_duplicate: 2, probable_manual_match: 0, ambiguous: 0, requiresResolution: 0 });
  });
  it("existing A + incoming A,A → 1 duplicate, 1 new (a legitimate identical repeat survives)", () => {
    expect(classes(csv([incoming("0"), incoming("1")], [existing()]))).toEqual(["exact_duplicate", "new"]);
  });
  it("every multiplicity combination: A/A, A,A/A, A,A/A,A, ∅/A,A", () => {
    expect(classes(csv([incoming("0")], [existing()]))).toEqual(["exact_duplicate"]);
    expect(classes(csv([incoming("0")], [existing(), existing()]))).toEqual(["exact_duplicate"]);
    expect(classes(csv([incoming("0"), incoming("1")], [existing(), existing()]))).toEqual(["exact_duplicate", "exact_duplicate"]);
    expect(classes(csv([incoming("0"), incoming("1")], []))).toEqual(["new", "new"]);
  });
  it("legitimately identical trades in one broker file are all new when nothing is persisted", () => {
    expect(classes(csv([incoming("0"), incoming("1")], []))).toEqual(["new", "new"]);
  });
  it("re-importing a batch after it was imported classifies every row as an exact duplicate (idempotency)", () => {
    const batch = [incoming("0"), incoming("1", { ticker: "MRVL", qty: 4.5419, price: 220.17 }), incoming("2", { ticker: null, type: "fee", qty: null, price: null, amount: -1.5 })];
    const first = csv(batch, []);
    expect(classes(first)).toEqual(["new", "new", "new"]);
    const persisted = batch.map((b) => existing({ ticker: b.ticker, type: b.transactionType, date: b.transactionDate.toISOString(), qty: b.quantity, price: b.price, amount: b.amount }));
    const second = csv(batch, persisted);
    expect(classes(second)).toEqual(["exact_duplicate", "exact_duplicate", "exact_duplicate"]);
    expect(planInsertions(second, []).insert).toEqual([]);
  });
  it("identity is insensitive to numeric representation and ticker case", () => {
    const r = csv([incoming("0", { ticker: "mp", qty: "20.65210", price: "48.420" })], [existing()]);
    expect(classes(r)).toEqual(["exact_duplicate"]);
  });
  it("each transaction type reconciles on its own fields (quantity/price null for non-trades)", () => {
    const kinds: Array<[CanonicalTransactionType, Spec]> = [
      ["dividend", { type: "dividend", qty: null, price: null, amount: 3 }],
      ["fee", { ticker: null, type: "fee", qty: null, price: null, amount: -1 }],
      ["deposit", { ticker: null, type: "deposit", qty: null, price: null, amount: 1000 }],
      ["withdrawal", { ticker: null, type: "withdrawal", qty: null, price: null, amount: -500 }],
      ["sell", { type: "sell" }],
    ];
    for (const [name, spec] of kinds) {
      expect(classes(csv([incoming("0", spec)], [existing(spec)])), name).toEqual(["exact_duplicate"]);
      expect(classes(csv([incoming("0", { ...spec, amount: Number(row(spec).amount) + 0.01 })], [existing(spec)])), `${name} amount`).toEqual(["new"]);
    }
  });
});

describe("manual-vs-CSV reconciliation", () => {
  const manualMp = existing({ source: "manual_entry" }); // the real MP buy 08-05: 20.6521 @ 48.42, amount without commission
  it("a CSV row for the same trade (commission-adjusted amount) is a PROBABLE manual match — never auto-skipped, never inserted", () => {
    const r = csv([incoming("0", { amount: -1001.47 })], [manualMp]);
    expect(r.rows[0]).toMatchObject({ class: "probable_manual_match", requiresResolution: true, matchedExistingId: null });
    expect(r.rows[0]!.candidates.map((c) => c.id)).toEqual([manualMp.id]);
    expect(r.rows[0]!.candidates[0]).toMatchObject({ source: "manual_entry", quantity: "20.6521", price: "48.42" });
    expect(() => planInsertions(r, [])).toThrow(ReconciliationError);
    expect(() => planInsertions(r, [])).toThrow(/entered manually/);
  });
  it("a rounded manual transcription still matches; a different price does not", () => {
    const rounded = existing({ source: "manual_entry", qty: 20.65 });
    expect(classes(csv([incoming("0")], [rounded]))).toEqual(["probable_manual_match"]);
    expect(classes(csv([incoming("0", { price: 48.6 })], [manualMp]))).toEqual(["new"]);
  });
  it("two candidates for one row → AMBIGUOUS; two rows competing for one candidate → both AMBIGUOUS", () => {
    const m1 = existing({ source: "manual_entry" });
    const m2 = existing({ source: "manual_entry", qty: 20.65 });
    const twoCandidates = csv([incoming("0", { amount: -1001.47 })], [m1, m2]);
    expect(twoCandidates.rows[0]).toMatchObject({ class: "ambiguous", requiresResolution: true });
    expect(twoCandidates.rows[0]!.candidates.map((c) => c.id).sort()).toEqual([m1.id, m2.id].sort());

    const shared = csv([incoming("0", { amount: -1001.47 }), incoming("1", { amount: -1001.48 })], [m1]);
    expect(classes(shared)).toEqual(["ambiguous", "ambiguous"]);
  });
  it("an existing row consumed by an exact duplicate is not offered as a near-match candidate", () => {
    const r = csv([incoming("0"), incoming("1", { amount: -1001.47 })], [manualMp]);
    expect(classes(r)).toEqual(["exact_duplicate", "new"]);
  });
  it("explicit 'same' keeps the manual row and skips the CSV row; explicit 'separate' inserts it", () => {
    const r = csv([incoming("0", { amount: -1001.47 }), incoming("1", { ticker: "MRVL" })], [manualMp]);
    const same = planInsertions(r, [res(r, "0", "same", manualMp.id)]);
    expect(same).toEqual({ insert: ["1"], skippedExact: [], skippedSame: ["0"], separate: [] });
    const separate = planInsertions(r, [res(r, "0", "separate")]);
    expect(separate).toEqual({ insert: ["0", "1"], skippedExact: [], skippedSame: [], separate: ["0"] });
  });
  it("fails closed on stale or invalid resolutions", () => {
    const r = csv([incoming("0", { amount: -1001.47 }), incoming("1", { ticker: "MRVL" })], [manualMp]);
    const bad = (resolutions: ReconciliationResolution[], code: string) => {
      try {
        planInsertions(r, resolutions);
        throw new Error("did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ReconciliationError);
        expect((e as ReconciliationError).code).toBe(code);
      }
    };
    bad([], "unresolved");
    bad([res(r, "0", "same", "not-a-candidate")], "stale");
    bad([res(r, "0", "same")], "stale");
    bad([res(r, "0", "separate"), res(r, "1", "separate")], "stale"); // row 1 no longer needs one
    bad([res(r, "0", "separate"), { ...res(r, "0", "separate"), clientRowKey: "9" }], "stale"); // unknown row
    bad([res(r, "0", "separate"), res(r, "0", "same", manualMp.id)], "invalid");
    const shared = csv([incoming("0", { amount: -1001.47 }), incoming("1", { amount: -1001.48 })], [manualMp]);
    expect(() => planInsertions(shared, [res(shared, "0", "same", manualMp.id), res(shared, "1", "same", manualMp.id)])).toThrow(/both marked as the same/);
  });
  it("a resolution is bound to the previewed row's identity: the same position holding a different row is stale, for every action", () => {
    const previewed = csv([incoming("0", { amount: -1001.47 })], [manualMp]);
    const changed = csv([incoming("0", { qty: 20.65, amount: -1001.47 })], [manualMp]); // still a probable match of the SAME candidate
    expect(changed.rows[0]!.class).toBe("probable_manual_match");
    for (const action of ["same", "separate"] as const) {
      const fromPreview = res(previewed, "0", action, action === "same" ? manualMp.id : undefined);
      expect(() => planInsertions(changed, [fromPreview])).toThrow(/not the row this answer was given for/);
      expect(planInsertions(changed, [{ ...fromPreview, identityKey: ik(changed, "0") }]).insert).toEqual(action === "separate" ? ["0"] : []);
    }
  });
  it("CSV exact duplicates can never be overridden", () => {
    const r = csv([incoming("0")], [existing()]);
    expect(planInsertions(r, []).skippedExact).toEqual(["0"]);
    expect(() => planInsertions(r, [res(r, "0", "separate")])).toThrow(/always skipped/);
  });
});

describe("manual entry mode", () => {
  it("an identical manual row (persisted or earlier in the same form) is flagged and blocks without an explicit answer", () => {
    const r = manual([incoming("0"), incoming("1")], [existing({ source: "manual_entry" })]);
    expect(r.rows.map((x) => [x.class, x.withinBatch, x.requiresResolution])).toEqual([
      ["exact_duplicate", false, true],
      ["exact_duplicate", true, true],
    ]);
    expect(() => planInsertions(r, [])).toThrow(/identical to an existing transaction/);
    const overridden = planInsertions(r, [res(r, "0", "separate"), res(r, "1", "same")]);
    expect(overridden).toEqual({ insert: ["0"], skippedExact: ["1"], skippedSame: [], separate: ["0"] });
    // first skipped as same, second identical row explicitly separate → exactly one copy added
    const other = planInsertions(r, [res(r, "0", "same"), res(r, "1", "separate")]);
    expect(other).toEqual({ insert: ["1"], skippedExact: ["0"], skippedSame: [], separate: ["1"] });
    // within-form multiplicity with nothing persisted: A,A,A → new, dup, dup
    const three = manual([incoming("0"), incoming("1"), incoming("2")], []);
    expect(three.rows.map((x) => [x.class, x.withinBatch])).toEqual([["new", false], ["exact_duplicate", true], ["exact_duplicate", true]]);
  });
  it("manual rows near an existing CSV row are probable matches too (never weaker than CSV dedup)", () => {
    const r = manual([incoming("0", { qty: 20.65 })], [existing()]);
    expect(classes(r)).toEqual(["probable_manual_match"]);
  });
  it("distinct manual rows on the same day are simply new", () => {
    expect(classes(manual([incoming("0"), incoming("1", { qty: 5 })], []))).toEqual(["new", "new"]);
  });
});

describe("properties", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  const multiset = (rows: { transactionType: string; ticker: string | null; quantity: unknown; price: unknown; amount: unknown; transactionDate: Date }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = transactionIdentityKey({ ...r, source: "csv_import" } as never);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  it("import(X); import(X) inserts zero the second time; multiplicities are preserved; permutation-invariant", () => {
    const rand = rng(2026);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 12);
      const specs: Spec[] = [];
      for (let i = 0; i < n; i++) {
        const t = ["buy", "sell", "dividend", "fee"][Math.floor(rand() * 4)] as CanonicalTransactionType;
        const trade = t === "buy" || t === "sell";
        specs.push({
          ticker: t === "fee" ? null : ["A", "B"][Math.floor(rand() * 2)],
          type: t,
          date: `2026-01-0${1 + Math.floor(rand() * 3)}T00:00:00Z`,
          qty: trade ? 1 + Math.floor(rand() * 3) : null,
          price: trade ? [10, 10.5][Math.floor(rand() * 2)] : null,
          amount: trade ? undefined : [1, 2][Math.floor(rand() * 2)],
        });
      }
      // Some pre-existing overlap: a random prefix already persisted (as csv), sometimes twice.
      const persistedCount = Math.floor(rand() * (n + 1));
      const persisted: ExistingTransaction[] = [];
      for (let i = 0; i < persistedCount; i++) {
        persisted.push(existing(specs[i]));
        if (rand() < 0.3) persisted.push(existing(specs[i]));
      }
      const batch = specs.map((s, i) => incoming(String(i), s));

      const first = csv(batch, persisted);
      const plan = planInsertions(first, []);
      // Invariant: max(M - N, 0) per key are new; the rest are exact duplicates.
      const inc = multiset(batch);
      const ex = multiset(persisted);
      for (const [k, m] of inc) {
        const newCount = first.rows.filter((r) => r.identityKey === k && r.class === "new").length;
        const dupCount = first.rows.filter((r) => r.identityKey === k && r.class === "exact_duplicate").length;
        expect(newCount).toBe(Math.max(m - (ex.get(k) ?? 0), 0));
        expect(dupCount).toBe(Math.min(m, ex.get(k) ?? 0));
      }
      expect(first.counts.probable_manual_match + first.counts.ambiguous).toBe(0); // csv-vs-csv never near-matches

      // After inserting the plan, the same batch again (and again) inserts nothing.
      const after = [...persisted, ...plan.insert.map((k) => existing(specs[Number(k)]))];
      const second = csv(batch, after);
      expect(planInsertions(second, []).insert).toEqual([]);
      const third = csv(batch, [...after, ...planInsertions(second, []).insert.map((k) => existing(specs[Number(k)]))]);
      expect(planInsertions(third, []).insert).toEqual([]);
      const afterMultiset = multiset(after);
      for (const [k, m] of inc) expect(afterMultiset.get(k)!).toBeGreaterThanOrEqual(m); // multiplicities preserved
      // Independent multiset oracle for the whole outcome: after = max(existing, incoming) per key, computed from raw counts.
      for (const [k, m] of inc) expect(afterMultiset.get(k)).toBe(Math.max(m, ex.get(k) ?? 0));

      // Permutation invariance of the multiset outcome.
      const shuffled = [...batch].sort(() => rand() - 0.5);
      const permuted = csv(shuffled, persisted);
      const summarize = (r: ReturnType<typeof csv>) => [...r.rows.map((x) => `${x.identityKey}#${x.class}`)].sort();
      expect(summarize(permuted)).toEqual(summarize(first));
    }
  });
});
