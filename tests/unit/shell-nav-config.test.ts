import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BARE_ROUTES, NAV_GROUPS, NAV_ITEMS, isActiveRoute, isBareRoute } from "@/components/shell/nav-config";

// Frontend V1, unit 1 — the shell's navigation is data plus one pure
// matcher. These tests pin what a broken shell would silently get wrong:
// a destination that no longer exists, two items lighting up at once, or
// a Latin label leaking into Hebrew chrome.
const APP = path.resolve(__dirname, "../../src/app");
const HEBREW = /[א-ת]/;

describe("shell navigation config", () => {
  it("every destination is a real page route", () => {
    for (const item of NAV_ITEMS) {
      const file = path.join(APP, item.href === "/" ? "" : item.href, "page.tsx");
      expect(fs.existsSync(file), `${item.href} -> ${file}`).toBe(true);
    }
  });

  it("destinations are unique and grouped in product order", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(NAV_GROUPS.map((g) => g.items.length)).toEqual([4, 3, 3]);
    expect(hrefs[0]).toBe("/");
  });

  it("every label and group name is Hebrew, apart from the fixed English product terms", () => {
    for (const group of NAV_GROUPS) expect(group.label, group.label).toMatch(HEBREW);
    for (const item of NAV_ITEMS) expect(item.label, item.label).toMatch(HEBREW);
    // DNA stays English by product rule; the label still carries Hebrew around it
    expect(NAV_ITEMS.find((i) => i.href === "/dna")?.label).toContain("DNA");
  });

  it("lights exactly one item for a nested route", () => {
    const active = NAV_ITEMS.filter((i) => isActiveRoute("/cases/9d2c", i.href)).map((i) => i.href);
    expect(active).toEqual(["/cases"]);
  });

  it("matches on path boundaries only, and home on the exact path", () => {
    expect(isActiveRoute("/decisions", "/decisions")).toBe(true);
    expect(isActiveRoute("/decisions/abc", "/decisions")).toBe(true);
    expect(isActiveRoute("/decisions-archive", "/decisions")).toBe(false);
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/dna", "/")).toBe(false);
  });

  it("renders /login bare and nothing else", () => {
    expect(BARE_ROUTES).toEqual(["/login"]);
    expect(isBareRoute("/login")).toBe(true);
    expect(isBareRoute("/login/")).toBe(true);
    expect(isBareRoute("/loginx")).toBe(false);
    for (const item of NAV_ITEMS) expect(isBareRoute(item.href)).toBe(false);
  });
});
