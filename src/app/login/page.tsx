"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/status";
import { shell, loginPage as t } from "@/lib/i18n/strings";

// The one bare route: rendered without the shell's sidebar (see
// src/components/shell/nav-config.ts BARE_ROUTES). Built from the shared
// primitives so the sign-in screen speaks the same visual language as
// everything behind it.
export default function LoginPage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-bold text-ink">{shell.productName}</h1>
        <p className="text-sm text-muted">{shell.productDescription}</p>
      </div>
      <form
        className="flex flex-col gap-4 rounded-lg border border-rule bg-surface p-5 shadow-panel"
        onSubmit={(e) => {
          e.preventDefault();
          guard(() => login.mutateAsync({ email, password }));
        }}
      >
        <Field label={t.emailLabel} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label={t.passwordLabel} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={login.isPending} loadingLabel={t.signingIn} className="w-full">
          {t.signIn}
        </Button>
        {login.isError && (
          <Notice tone="negative" title={t.failedTitle}>
            {t.failedHint}
          </Notice>
        )}
      </form>
    </main>
  );
}
