import type { Metadata } from "next";
import { TRPCProvider } from "@/trpc/Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Investment Copilot",
  description: "A personal AI copilot that learns how you invest.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
