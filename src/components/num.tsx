// Wraps a numeric/currency/percentage/date value that appears inside
// Hebrew/RTL text so it always displays left-to-right, regardless of
// surrounding context.
//
// Plain HTML <bdi> auto-detects direction from the first *strong*
// character (a letter) in its content — digits, +/-, %, $, and
// separators are all "weak"/"neutral" in the bidi algorithm, so a bare
// <bdi> around something like "-0.85%" or a date has no strong
// character to anchor on and isn't guaranteed to resolve LTR the way a
// bare <bdi>VIX 16.01</bdi> does (that one's anchored by the letters
// "VIX"). <bdi dir="ltr"> is the explicit, reliable form.
//
// Centralized here after a live check on Decision Snapshot found
// "-0.85%" rendering as "0.85%-" (the sign flipped to the far side of
// the digits) with a bare <bdi> — every page that shows a price/%/$/
// date value embedded in Hebrew text should use <Num> instead of
// re-solving this locally.
//
// Where to put the boundary (also found live, the hard way): wrap a
// bare value that follows a HEBREW label ("מזומן: <Num>$8,500</Num>") —
// that is the common case across this app and just works. Do NOT wrap
// only the tail of a value that already follows its own unwrapped LATIN
// label ("S&P 500: <Num>7642.21</Num>") — isolating just the number
// splits it from its label as two separate bidi runs and lets them
// reorder relative to each other ("7642.21 :S&P 500", label and colon
// flipped to the wrong side). A Latin-labeled value that itself needs
// isolating (e.g. because it can be negative) should wrap the whole
// "Label: value" cluster together, never just the trailing number.
export function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
