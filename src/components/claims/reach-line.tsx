import { dnaPage as t } from "@/lib/i18n/strings";
import type { ClaimReach } from "./types";

// Whether the system currently uses a claim, from evidence.reach — the
// authoritative visibility fact. A missing reach record is said as such and
// never read as "used". "Not used" is never "false": the wording keeps the
// two apart.
export function ReachLine({ reach }: { reach: ClaimReach | undefined }) {
  return <p className="text-xs text-muted">{reach === undefined ? t.reachUnknown : reach.visibleToAi ? t.usedByAi : t.notUsedByAi}</p>;
}
