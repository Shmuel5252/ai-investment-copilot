import { describe, it, expect } from "vitest";
import { assertNonEmptyStrings } from "@/lib/ai/case";

// Deterministic validation logic (docs/backlog.md, "עדיפות גבוהה" —
// this is exactly what No Fake Certainty exists to catch: a required
// tool-response field silently disappearing, live-caught once as
// synthesisText coming back null with no error anywhere). Real unit
// coverage, not a smoke test, per CLAUDE.md's Definition of Done.
describe("assertNonEmptyStrings", () => {
  it("does not throw when every listed field is a non-empty string", () => {
    const obj = { a: "hello", b: "world", c: 42 };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).not.toThrow();
  });

  it("throws when a required field is missing (undefined)", () => {
    const obj = { a: "hello" } as { a: string; b?: string };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).toThrow(/missing required field\(s\): b/);
  });

  it("throws when a required field is null", () => {
    const obj = { a: "hello", b: null } as unknown as { a: string; b: string };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).toThrow(/b/);
  });

  it("throws when a required field is an empty string", () => {
    const obj = { a: "hello", b: "" };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).toThrow(/b/);
  });

  it("throws when a required field is whitespace only", () => {
    const obj = { a: "hello", b: "   " };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).toThrow(/b/);
  });

  it("throws when a required field is the wrong type (number instead of string)", () => {
    const obj = { a: "hello", b: 5 } as unknown as { a: string; b: string };
    expect(() => assertNonEmptyStrings(obj, ["a", "b"], "some_tool")).toThrow(/b/);
  });

  it("reports every missing field, not just the first", () => {
    const obj = { a: undefined, b: undefined, c: "fine" } as unknown as { a: string; b: string; c: string };
    expect(() => assertNonEmptyStrings(obj, ["a", "b", "c"], "some_tool")).toThrow(/a, b/);
  });

  it("includes the tool name in the error message", () => {
    const obj = {} as { x: string };
    expect(() => assertNonEmptyStrings(obj, ["x"], "synthesize_case")).toThrow(/synthesize_case/);
  });

  it("only checks the fields it's told to — an unrelated missing field is ignored", () => {
    const obj = { a: "hello" } as { a: string; unchecked?: string };
    expect(() => assertNonEmptyStrings(obj, ["a"], "some_tool")).not.toThrow();
  });
});
