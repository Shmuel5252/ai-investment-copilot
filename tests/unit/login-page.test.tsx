// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loginPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 8 — the login screen: unchanged auth behavior (the exact
// auth.login input, success to "/" with a refresh), and failure copy that only
// blames the credentials when the server rejected them. Only the tRPC
// plumbing and the router are stubbed.

const state: { error: null | { message: string; data: { code: string } }; pending: boolean } = { error: null, pending: false };
const calls: unknown[] = [];
const router = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/trpc/react", () => ({
  trpc: {
    auth: {
      login: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutateAsync: async (input: unknown) => {
            calls.push(input);
            if (state.error) throw state.error;
            opts.onSuccess?.();
            return { displayName: "x" };
          },
          isPending: state.pending,
          isError: state.error !== null,
          error: state.error,
        }),
      },
    },
  },
}));

const { default: LoginPage } = await import("@/app/login/page");

beforeEach(() => {
  state.error = null;
  state.pending = false;
  calls.length = 0;
  router.push.mockClear();
  router.refresh.mockClear();
});

function fill() {
  fireEvent.change(screen.getByLabelText(new RegExp(t.emailLabel)), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getByLabelText(new RegExp(t.passwordLabel)), { target: { value: "pw" } });
}

describe("/login", () => {
  it("labels both fields in Hebrew and keeps them left-to-right", () => {
    render(<LoginPage />);
    const email = screen.getByLabelText(new RegExp(t.emailLabel)) as HTMLInputElement;
    const password = screen.getByLabelText(new RegExp(t.passwordLabel)) as HTMLInputElement;
    expect(email.getAttribute("dir")).toBe("ltr");
    expect(password.getAttribute("dir")).toBe("ltr");
    expect(email.type).toBe("email");
    expect(password.type).toBe("password");
  });

  it("sends exactly {email, password}, then goes to / and refreshes", async () => {
    render(<LoginPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: t.signIn }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(router.refresh).toHaveBeenCalled();
    expect(calls).toEqual([{ email: "a@b.co", password: "pw" }]);
  });

  it("a double submit sends once", async () => {
    render(<LoginPage />);
    fill();
    const form = screen.getByRole("button", { name: t.signIn }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
  });

  it("shows the pending label while signing in", () => {
    state.pending = true;
    render(<LoginPage />);
    expect((screen.getByRole("button", { name: t.signingIn }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("UNAUTHORIZED: asks to check the email and password", () => {
    state.error = { message: "Invalid email or password.", data: { code: "UNAUTHORIZED" } };
    render(<LoginPage />);
    expect(screen.getByText(t.failedTitle)).toBeTruthy();
    expect(screen.getByText(t.failedHint)).toBeTruthy();
    expect(t.failedHint).toBe("בדוק את האימייל והסיסמה.");
    expect(document.body.textContent).not.toContain("Invalid email");
  });

  it("any other failure: a general message, never blaming the input or leaking the raw error", () => {
    state.error = { message: "fetch failed ECONNREFUSED", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<LoginPage />);
    expect(screen.getByText(t.errorTitle)).toBeTruthy();
    expect(screen.getByText(t.errorHint)).toBeTruthy();
    expect(t.errorTitle).toBe("לא הצלחנו להשלים את הכניסה");
    expect(t.errorHint).toBe("נסה שוב בעוד רגע.");
    expect(document.body.textContent).not.toContain(t.failedHint);
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
  });
});
