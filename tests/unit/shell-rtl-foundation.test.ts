import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Frontend V1, unit 1 — Hebrew/RTL is owned by the root layout, and by
// nothing else. A page that re-declares direction is the old pattern
// creeping back; a root that loses it breaks every screen at once.
const SRC = path.resolve(__dirname, "../../src");

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

describe("RTL foundation", () => {
  it("the root layout declares Hebrew and RTL once", () => {
    const layout = fs.readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<html[^>]*\blang="he"/);
    expect(layout).toMatch(/<html[^>]*\bdir="rtl"/);
  });

  it("no page re-declares direction or language on its own root", () => {
    const pages = pageFiles(path.join(SRC, "app"));
    expect(pages.length).toBeGreaterThanOrEqual(13);
    for (const file of pages) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, path.relative(SRC, file)).not.toMatch(/dir="rtl"/);
      expect(text, path.relative(SRC, file)).not.toMatch(/lang="he"/);
    }
  });

  it("the design tokens keep the legacy journal aliases the older pages still use", () => {
    const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    for (const token of ["--color-journal-bg", "--color-journal-surface", "--color-journal-rule", "--color-journal-ink", "--color-journal-muted", "--color-journal-accent"]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toContain("--color-paper:");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
  });
});
