import { describe, expect, it } from "vitest";
import {
  buildAnswerCaseKeys,
  UNMAPPED_EPISODE_SENTINEL,
} from "@/lib/evidence/build-answer-case-keys";

describe("buildAnswerCaseKeys", () => {
  it("uses the answer's own id when transactionId is null, unconditionally", () => {
    const keys = buildAnswerCaseKeys(
      [{ id: "answer-1", transactionId: null }],
      new Map([["txn-1", "AAPL#1"]])
    );
    expect(keys.get("answer-1")).toBe("answer-1");
  });

  it("maps a transaction-anchored answer to its episode key", () => {
    const keys = buildAnswerCaseKeys(
      [{ id: "answer-1", transactionId: "txn-1" }],
      new Map([["txn-1", "MP#1"]])
    );
    expect(keys.get("answer-1")).toBe("MP#1");
  });

  it("collapses two answers about different transactions in the same episode to one case key", () => {
    // The MP scenario: BUY, partial SELL, final SELL are three different
    // transactions but one episode — three InterviewAnswers anchored to
    // them must all resolve to the same case key.
    const episodeMap = new Map([
      ["buy-txn", "MP#1"],
      ["sell-1-txn", "MP#1"],
      ["sell-2-txn", "MP#1"],
    ]);
    const keys = buildAnswerCaseKeys(
      [
        { id: "a-buy", transactionId: "buy-txn" },
        { id: "a-sell-1", transactionId: "sell-1-txn" },
        { id: "a-sell-2", transactionId: "sell-2-txn" },
      ],
      episodeMap
    );
    expect(keys.get("a-buy")).toBe("MP#1");
    expect(keys.get("a-sell-1")).toBe("MP#1");
    expect(keys.get("a-sell-2")).toBe("MP#1");
  });

  it("falls back to the fixed global sentinel — never the raw transactionId — when a transaction can't be resolved to an episode", () => {
    const keys = buildAnswerCaseKeys(
      [{ id: "answer-1", transactionId: "unresolvable-txn" }],
      new Map() // empty — nothing resolves
    );
    expect(keys.get("answer-1")).toBe(UNMAPPED_EPISODE_SENTINEL);
    expect(keys.get("answer-1")).not.toBe("unresolvable-txn");
  });

  it("collapses multiple independently-unmapped answers to the SAME shared sentinel case, contributing at most one case", () => {
    const keys = buildAnswerCaseKeys(
      [
        { id: "answer-1", transactionId: "unresolvable-txn-A" },
        { id: "answer-2", transactionId: "unresolvable-txn-B" },
      ],
      new Map()
    );
    expect(keys.get("answer-1")).toBe(UNMAPPED_EPISODE_SENTINEL);
    expect(keys.get("answer-2")).toBe(UNMAPPED_EPISODE_SENTINEL);
    expect(keys.get("answer-1")).toBe(keys.get("answer-2"));
  });

  it("keeps the null-transactionId path and the episode-lookup path from interfering with each other in the same call", () => {
    const keys = buildAnswerCaseKeys(
      [
        { id: "general-answer", transactionId: null },
        { id: "anchored-answer", transactionId: "txn-1" },
      ],
      new Map([["txn-1", "MP#1"]])
    );
    expect(keys.get("general-answer")).toBe("general-answer");
    expect(keys.get("anchored-answer")).toBe("MP#1");
  });
});
