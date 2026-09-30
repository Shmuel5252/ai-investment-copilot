import { describe, expect, it } from "vitest";
import { principleCreatedByLabel, strategyPage } from "@/lib/i18n/strings";
import { principleCreatedByEnum } from "@/db/schema/enums";

// Frontend V1 unit 6B — the Strategy chrome is Hebrew, every stored origin has
// a label, and the three kinds of principle keep their locked meanings.
const HEBREW = /[א-ת]/;

describe("Strategy copy coverage", () => {
  it("every Strategy page string is Hebrew", () => {
    for (const [key, value] of Object.entries(strategyPage)) expect(value, key).toMatch(HEBREW);
  });

  it("every stored principle origin has a label", () => {
    for (const v of principleCreatedByEnum.enumValues) expect(principleCreatedByLabel[v], v).toMatch(HEBREW);
  });

  it("the three kinds keep their locked meanings", () => {
    expect(strategyPage.validatedHint).toContain("גדר קבועה של המערכת, לא נלמדה ממך");
    expect(strategyPage.observedHint).toContain("תצפית של המערכת שעדיין נבדקת, לא עיקרון שבחרת");
    expect(strategyPage.proposeHint).toContain("שום הצעה לא הופכת לחלק מהאסטרטגיה עד שתאשר אותה");
  });

  it("approval is described as a new version that rewrites nothing, and nothing is called proven", () => {
    expect(strategyPage.approveHint).toContain("גרסה חדשה");
    expect(strategyPage.approveHint).toContain("החלטות שכבר נרשמו לא משתנות");
    const all = Object.values(strategyPage).join(" ");
    for (const word of ["הוכח", "מוכח", "רווחי", "מבטיח"]) expect(all, word).not.toContain(word);
  });
});
