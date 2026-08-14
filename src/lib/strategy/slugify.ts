import { randomUUID } from "node:crypto";

// Turns a principle statement into a short, human-legible `key` slug
// (docs/data-model.md §3: "key/slug"). The key has no DB uniqueness
// constraint and isn't relied on for any invariant — it's for human
// debugging/readability (e.g. in db:studio) — so a short random suffix
// is enough to keep two similarly-worded principles visually distinct
// without needing real collision detection.
export function slugifyPrincipleKey(statementText: string): string {
  const base = statementText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const suffix = randomUUID().slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}
