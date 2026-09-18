// AI Structured-Output Boundary Hardening.
//
// A real production incident (first controlled Strategy generation): the
// model answered a tool call with HTTP 200 and a tool input of
//   { principles: "{\"principles\":[ ... ]}" }
// i.e. the collection field was itself a JSON-ENCODED STRING wrapping the
// expected wrapper object, instead of the array the tool schema asks for.
// Every generator's strict `Array.isArray(input.K)` check rejected it —
// correctly fail-closed, but the content was deterministically decodable.
//
// This module answers exactly ONE question: "can this AI response be
// deterministically decoded into the expected structural JSON container
// (an array)?" It never judges whether the decoded items are valid — the
// caller's existing domain validators (citation ids, stance, statements)
// still run on whatever comes back, unchanged.
//
// Explicit bound — NOT recursive, NOT "parse until something works". The
// whole normalization is one straight-line sequence with at most TWO
// JSON decodes and TWO wrapper unwraps:
//
//   raw
//   -> decode #1   only if raw is a string
//   -> unwrap key  only if the value is a wrapper object (an array is final)
//   -> decode #2   only if the unwrapped field is a string
//   -> unwrap key  only if the value is a wrapper object again
//   -> the value MUST now be an array; anything else fails closed.
//
// A decode that yields yet another string means the encoding nests deeper
// than the bound, and fails closed as `depth_exceeded`.
//
// Deliberately NOT done (each would turn "representation" into guessing):
// no regex/substring extraction of JSON from prose, no Markdown-fence
// stripping (no reviewed production contract supports it), no repair of
// malformed JSON, no guessing an alternative field name when the expected
// key is missing, no coercing a lone object into a one-element array, no
// dropping malformed elements to keep the rest. Elements of the returned
// array are never inspected here.
//
// Errors carry only a code and the caller's static label — never the raw
// value, never JSON.parse's own message (it quotes a snippet of the input)
// — so nothing about the investor's content can leak through an error.
export type StructuredOutputErrorCode =
  | "malformed_json"
  | "unexpected_representation"
  | "not_an_array"
  | "depth_exceeded";

export class StructuredOutputError extends Error {
  readonly code: StructuredOutputErrorCode;

  constructor(code: StructuredOutputErrorCode, label: string) {
    super(`AI returned a malformed ${label} list (${code}).`);
    this.name = "StructuredOutputError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeStructuredCollection(raw: unknown, key: string, label: string): unknown[] {
  const fail = (code: StructuredOutputErrorCode): never => {
    throw new StructuredOutputError(code, label);
  };

  const decode = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      // Intentionally no `cause`: SyntaxError messages quote the input.
      return fail("malformed_json");
    }
  };

  // A wrapper is an object holding the expected key. Refuses to guess: a
  // missing key is never replaced by "the only array-looking field", and a
  // wrapper that ALSO carries another array field is ambiguous about which
  // one is the collection, so it fails closed. Extra non-array fields are
  // ignored, exactly as before this hardening.
  const unwrap = (value: unknown, onFail: StructuredOutputErrorCode): unknown => {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, key)) return fail(onFail);
    for (const [otherKey, otherValue] of Object.entries(value)) {
      if (otherKey !== key && Array.isArray(otherValue)) return fail(onFail);
    }
    return value[key];
  };

  let value: unknown = raw;

  // Decode #1 — the whole tool input arrived as a JSON string.
  if (typeof value === "string") {
    value = decode(value);
    if (typeof value === "string") return fail("depth_exceeded");
  }
  if (Array.isArray(value)) return value;

  // Unwrap #1 — the outer container. Failure here means the top-level
  // shape is not any recognized representation at all.
  value = unwrap(value, "unexpected_representation");
  if (Array.isArray(value)) return value;

  // Decode #2 — the collection field itself is a JSON string (the
  // observed incident class). Unwrap #2 exists only behind this decode: a
  // directly nested object wrapper (no string layer) was never observed
  // and is not accepted.
  if (typeof value === "string") {
    value = decode(value);
    if (typeof value === "string") return fail("depth_exceeded");
    if (Array.isArray(value)) return value;

    // Unwrap #2 — the decoded value is an inner wrapper of the same
    // expected key (the exact observed incident shape). From here on a
    // failure means the expected collection field did not resolve to an
    // array.
    if (isPlainObject(value)) {
      value = unwrap(value, "not_an_array");
      if (Array.isArray(value)) return value;
      // The bound is spent: a string here would need a third decode.
      if (typeof value === "string") return fail("depth_exceeded");
    }
  }

  return fail("not_an_array");
}
