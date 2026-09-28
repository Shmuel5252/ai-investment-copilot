import { AI_CONTRACTS } from "@/lib/ai/contracts";
import { STANCE_SEMANTICS_VERSION } from "@/lib/ai/stance-rules";
import { codeVersionFromEnv } from "./provenance";

// OD-R9 — the identity of one authorized, persisted grounding run, as the
// audit ledger (grounding_judgments) records it on every row of that run.
//
// `runId` is a uuid the run chooses ONCE and keeps: a retry of the same run
// reuses it (and replays, or is refused if it judged differently), and a
// later revalidation — even under the same contract — uses a new one. It is
// never derived from a timestamp.
//
// The contract and the rule version are read from the running code, never
// passed in, so a run cannot label its judgments with a contract it did not
// judge under. SDK-free.
export interface GroundingRun {
  runId: string;
  contract: string;
  semanticRule: string;
  /** The model that produced the judgments. */
  model: string;
  /** Deploy/commit identifier when the runtime exposes one; null locally. */
  codeVersion: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildGroundingRun(input: { runId: string; model: string }): GroundingRun {
  if (!UUID.test(input.runId)) throw new Error("A grounding run id must be a uuid chosen once for the authorized run.");
  if (input.model.trim() === "") throw new Error("A grounding run must name the model that produced its judgments.");
  return {
    runId: input.runId.toLowerCase(),
    contract: AI_CONTRACTS.evidenceGrounding,
    semanticRule: STANCE_SEMANTICS_VERSION,
    model: input.model,
    codeVersion: codeVersionFromEnv(),
  };
}
