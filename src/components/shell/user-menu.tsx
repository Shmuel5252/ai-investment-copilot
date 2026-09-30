"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Icon } from "./icons";
import { shell } from "@/lib/i18n/strings";

// Who is signed in, and the one way out. Lives in the shell so no page has
// to carry a sign-out button of its own (the Dashboard used to). Shows the
// display name only: the e-mail is the login credential, not something
// the chrome needs to repeat on every screen.
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const guard = useSubmitGuard();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <div className={compact ? "flex items-center gap-3" : "flex flex-col gap-2"}>
      {!compact && (
        <p className="truncate px-3 text-xs text-muted">
          {me.isLoading && shell.loadingUser}
          {me.data && (
            <>
              {shell.signedInAs} <span className="font-semibold text-ink">{me.data.displayName}</span>
            </>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={() => guard(() => logout.mutateAsync())}
        disabled={logout.isPending}
        className="flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-60"
      >
        <Icon name="signOut" size={16} className="text-muted" />
        {logout.isPending ? shell.signingOut : shell.signOut}
      </button>
    </div>
  );
}
