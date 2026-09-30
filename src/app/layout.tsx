import type { Metadata } from "next";
import { Assistant, Frank_Ruhl_Libre } from "next/font/google";
import { TRPCProvider } from "@/trpc/Provider";
import { AppShell } from "@/components/shell/app-shell";
import { shell } from "@/lib/i18n/strings";
import "./globals.css";

// The two faces of the "יומן אנליטי" world, loaded ONCE here and exposed as
// CSS variables that globals.css maps to the `font-sans` / `font-serif`
// theme tokens. Pages that still instantiate the same faces locally keep
// working (next/font serves identical files); they can drop their copies
// when each page is redesigned.
const sans = Assistant({
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-assistant",
});
const serif = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-frank-ruhl",
});

export const metadata: Metadata = {
  title: shell.productName,
  description: shell.productDescription,
};

// Hebrew and RTL are owned here, at the root — a firm product rule
// (AGENTS.md "שפת תוכן — עברית"), no longer re-declared page by page.
// LTR runs for numbers, tickers, prices and dates stay explicit through
// <Num> (src/components/num.tsx).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        <TRPCProvider>
          <AppShell>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
