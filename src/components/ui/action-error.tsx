import { Notice } from "./status";
import { shell } from "@/lib/i18n/strings";

// A failed write: the human line first, the server's own message after it,
// left-to-right so an English message keeps its punctuation. Renders nothing
// without a message. Promoted from the Case and Decision pages (Frontend V1
// unit 5) when a third page needed it.
export function ActionError({ message, title = shell.actionFailed }: { message: string | null; title?: string }) {
  if (!message) return null;
  return (
    <Notice tone="negative" title={title}>
      <bdi dir="ltr" className="text-xs">
        {message}
      </bdi>
    </Notice>
  );
}
