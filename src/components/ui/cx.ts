// Joins class names, dropping falsy values. Three lines instead of a
// dependency: no variant merging is needed at this size.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
