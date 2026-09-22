import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { transactionLinkFacts, transactionLinkFactMembers } from "@/db/schema";
import {
  findLinkFactConflicts,
  selectEffectiveLinkFacts,
  validateLinkFactShape,
  type LinkFactMemberTransaction,
  type LinkFactRow,
} from "@/lib/evidence/link-facts";

const txn = (id: string, ticker: string | null, type: string, investorId = "inv-1"): LinkFactMemberTransaction => ({
  id,
  investorId,
  ticker,
  transactionType: type,
});
const SELL_MP = txn("t-sell", "MP", "sell");
const BUY_MRVL = txn("t-buy", "MRVL", "buy");

const validate = (
  verdict: "linked" | "independent",
  ids: string[],
  found: LinkFactMemberTransaction[],
  investorId = "inv-1"
) => validateLinkFactShape({ investorId, verdict, requestedTransactionIds: ids, foundTransactions: found });

describe("validateLinkFactShape", () => {
  it("accepts a linked fact with a sell, a buy and two tickers", () => {
    expect(validate("linked", ["t-sell", "t-buy"], [SELL_MP, BUY_MRVL])).toEqual([]);
  });

  it("accepts a multi-leg rebalance fact (two sells, two buys)", () => {
    const found = [SELL_MP, txn("t-s2", "ZS", "sell"), BUY_MRVL, txn("t-b2", "SPCX", "buy")];
    expect(validate("linked", ["t-sell", "t-s2", "t-buy", "t-b2"], found)).toEqual([]);
  });

  it("requires at least 2 DISTINCT transactions", () => {
    expect(validate("linked", ["t-sell"], [SELL_MP]).join(" ")).toMatch(/at least 2/);
    expect(validate("independent", [], []).join(" ")).toMatch(/at least 2/);
    expect(validate("linked", ["t-sell", "t-sell"], [SELL_MP]).join(" ")).toMatch(/Duplicate/);
  });

  it("rejects unknown transactions and transactions of another investor", () => {
    expect(validate("independent", ["t-sell", "ghost"], [SELL_MP]).join(" ")).toMatch(/Unknown transaction/);
    expect(validate("independent", ["t-sell", "t-buy"], [SELL_MP, txn("t-buy", "MRVL", "buy", "someone-else")]).join(" ")).toMatch(
      /belong to the investor/
    );
  });

  it("a linked fact needs >= 1 sell, >= 1 buy and >= 2 tickers", () => {
    expect(validate("linked", ["t-buy", "t-b2"], [BUY_MRVL, txn("t-b2", "SPCX", "buy")]).join(" ")).toMatch(/at least one sell/);
    expect(validate("linked", ["t-sell", "t-s2"], [SELL_MP, txn("t-s2", "ZS", "sell")]).join(" ")).toMatch(/at least one buy/);
    expect(validate("linked", ["t-sell", "t-buy"], [SELL_MP, txn("t-buy", "MP", "buy")]).join(" ")).toMatch(/2 distinct tickers/);
  });

  it("an independent fact may be any two trades, but members must be trades with a ticker", () => {
    expect(validate("independent", ["t-b1", "t-b2"], [txn("t-b1", "A", "buy"), txn("t-b2", "B", "buy")])).toEqual([]);
    expect(validate("independent", ["t-sell", "t-div"], [SELL_MP, txn("t-div", "MP", "dividend")]).join(" ")).toMatch(/buy or sell trade/);
    expect(validate("independent", ["t-sell", "t-x"], [SELL_MP, txn("t-x", null, "buy")]).join(" ")).toMatch(/buy or sell trade/);
  });
});

describe("effective facts are chain heads", () => {
  const f = (id: string, supersedesFactId: string | null): LinkFactRow => ({
    id,
    verdict: "linked",
    supersedesFactId,
    transactionIds: ["a", "b"],
  });

  it("keeps only facts nothing supersedes", () => {
    expect(selectEffectiveLinkFacts([f("f1", null), f("f2", "f1"), f("f3", "f2"), f("g1", null)]).map((x) => x.id).sort()).toEqual(["f3", "g1"]);
  });

  it("a fact with no successor is effective; an empty history has none", () => {
    expect(selectEffectiveLinkFacts([f("only", null)]).map((x) => x.id)).toEqual(["only"]);
    expect(selectEffectiveLinkFacts([])).toEqual([]);
  });
});

describe("conflicting opposite-verdict facts", () => {
  const linked: LinkFactRow = { id: "L", verdict: "linked", supersedesFactId: null, transactionIds: ["a", "b", "c"] };

  it("an independent fact covering a pair an effective linked fact covers conflicts", () => {
    expect(findLinkFactConflicts({ verdict: "independent", transactionIds: ["a", "b"] }, [linked]).map((c) => c.id)).toEqual(["L"]);
  });

  it("sharing only ONE member is not a shared pair", () => {
    expect(findLinkFactConflicts({ verdict: "independent", transactionIds: ["a", "z"] }, [linked])).toEqual([]);
  });

  it("same-verdict overlap is redundant, not conflicting", () => {
    expect(findLinkFactConflicts({ verdict: "linked", transactionIds: ["a", "b"] }, [linked])).toEqual([]);
  });

  it("superseding the conflicting fact removes the conflict (the caller passes the set AFTER supersession)", () => {
    expect(findLinkFactConflicts({ verdict: "independent", transactionIds: ["a", "b"] }, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Static boundary tests — these pin the design's hard edges to the source.
// ---------------------------------------------------------------------
const read = (p: string) => readFileSync(p, "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("14. repository invariants that live in the source", () => {
  const repo = read("src/db/repositories/link-facts.ts");

  it("is insert-only: no UPDATE, no DELETE, and exactly the expected exports", () => {
    expect(repo).not.toMatch(/\.update\(/);
    expect(repo).not.toMatch(/\.delete\(/);
    expect(repo).not.toMatch(/\bonConflict/);
    const exports = [...repo.matchAll(/^export (?:async function|class|const|function) (\w+)/gm)].map((m) => m[1]).sort();
    expect(exports).toEqual(["LinkFactValidationError", "insertTransactionLinkFact", "loadEffectiveLinkFacts"]);
  });

  it("no other module may UPDATE or DELETE the link-fact tables", () => {
    for (const file of sourceFiles("src")) {
      const text = read(file);
      expect(text, file).not.toMatch(/\.(update|delete)\(\s*transactionLinkFact(Members)?\b/);
    }
  });

  it("the schema has NO origin / ai_* / kind / channel / role column — nothing marks a fact as anything but an investor assertion", () => {
    expect(Object.keys(getTableColumns(transactionLinkFacts)).sort()).toEqual(
      ["createdAt", "id", "investorId", "note", "shownBasisJson", "supersedesFactId", "verdict"].sort()
    );
    expect(Object.keys(getTableColumns(transactionLinkFactMembers)).sort()).toEqual(["factId", "id", "transactionId"]);
  });
});

describe("16. no AI dependency anywhere in the independence chain", () => {
  const CHAIN = [
    "src/lib/evidence/resolve-independence.ts",
    "src/lib/evidence/link-facts.ts",
    "src/lib/evidence/recalculate-independence.ts",
    "src/lib/evidence/load-independence-resolver.ts",
    "src/db/repositories/link-facts.ts",
    "src/db/repositories/independence-recalculation.ts",
  ];

  it("no module in the chain imports src/lib/ai or an Anthropic client", () => {
    for (const file of CHAIN) {
      const text = read(file);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/ai/);
      expect(text, file).not.toMatch(/anthropic/i);
    }
  });

  it("nothing in src/lib/ai can reach the fact repository, the resolver or the recalculation", () => {
    for (const file of sourceFiles("src/lib/ai")) {
      const text = read(file);
      expect(text, file).not.toMatch(/link-facts|resolve-independence|recalculate-independence|independence-recalculation|load-independence/);
    }
  });

  it("the pure resolver takes no candidate parameter: its input type has only episode keys, transactions, answers and facts", () => {
    const text = read("src/lib/evidence/resolve-independence.ts");
    const context = text.match(/export interface IndependenceContext \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect([...context.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])).toEqual(["episodeKeyByTransactionId", "transactions", "answers", "facts"]);
  });
});

describe("no speculative mutation surface for historical truth", () => {
  it("no router or server module imports the fact repository or its pure rules — there is no assert-linked / assert-independent procedure", () => {
    for (const file of sourceFiles("src/server")) {
      expect(read(file), file).not.toMatch(/link-facts|insertTransactionLinkFact/);
    }
  });

  it("insertTransactionLinkFact has no caller outside its own module and the tests", () => {
    for (const file of sourceFiles("src")) {
      if (file.replaceAll("\\", "/").endsWith("src/db/repositories/link-facts.ts")) continue;
      expect(read(file), file).not.toMatch(/insertTransactionLinkFact/);
    }
  });
});

describe("17. DNA and Strategy count through ONE resolver", () => {
  const CONSUMERS = [
    "src/lib/dna/validate-hypotheses.ts",
    "src/lib/dna/ground-evidence.ts",
    "src/lib/dna/remediate-grounding.ts",
    "src/lib/dna/resolve-hypothesis-identity.ts",
    "src/lib/strategy/validate-principles.ts",
    "src/lib/strategy/ground-evidence.ts",
    "src/lib/strategy/remediate-grounding.ts",
    "src/lib/strategy/resolve-principle-identity.ts",
    "src/lib/evidence/recalculate-independence.ts",
  ];

  it("every DNA and Strategy counting path imports the shared resolver and none re-implements counting", () => {
    for (const file of CONSUMERS) {
      const text = read(file);
      expect(text, file).toMatch(/@\/lib\/evidence\/resolve-independence/);
      expect(text, file).not.toMatch(/countIndependentCases/);
      expect(text, file).not.toMatch(/calculateEvidenceStrength\(\s*supporting/); // tier only ever via the shared assessCitations
    }
  });

  it("the routers load the resolver from persisted rows and no longer build case keys", () => {
    for (const file of ["src/server/routers/dna.ts", "src/server/routers/strategy.ts"]) {
      const text = read(file);
      expect(text, file).toMatch(/loadIndependenceResolver/);
      expect(text, file).not.toMatch(/buildAnswerCaseKeys|answerCaseKeys/);
    }
  });
});
