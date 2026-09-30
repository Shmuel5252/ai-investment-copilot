import { describe, expect, it } from "vitest";
import { ideasPage, shell } from "@/lib/i18n/strings";

// Frontend V1 unit 5 — the Ideas chrome is Hebrew, and its words describe a
// note, never a recommendation or a ranking.
const HEBREW = /[א-ת]/;

describe("Ideas copy coverage", () => {
  it("every Ideas string is Hebrew", () => {
    for (const [key, value] of Object.entries(ideasPage)) expect(value, key).toMatch(HEBREW);
    expect(shell.actionFailed).toMatch(HEBREW);
  });

  it("no string speaks of recommending, ranking, scoring or approving", () => {
    const all = Object.values(ideasPage).join(" ");
    for (const word of ["מומלץ", "המלצה שלנו", "דירוג", "ציון", "עדיפות", "אושר", "מאושר", "הזדמנות"]) expect(all, word).not.toContain(word);
  });

  it("the promote explanation does not claim the note is copied into the case", () => {
    expect(ideasPage.promoteHelp).not.toMatch(/יועתק|מועתק|העתק/);
    expect(ideasPage.promoteHelp).toContain("המקושר לרעיון");
  });
});
