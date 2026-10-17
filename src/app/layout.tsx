import type { Metadata } from "next";
import { connection } from "next/server";
// IBM Plex Sans / Plex Mono, self-hosted from files in the repo so text never
// silently falls back to system fonts and builds never fetch from Google.
// Plex has true tabular figures, which every money column relies on.
import "@/styles/fonts/ibm-plex";
import "./globals.css";
import "../styles/ledger-refinements.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppFrame } from "@/components/layout/AppFrame";
import { IdentityProvider } from "@/components/providers/IdentityProvider";
import { resolveViewerIdentity } from "@/lib/auth/viewer";

export const metadata: Metadata = {
  title: "Atlas Wealth | Personal Investment Operating System",
  description: "Comprehensive wealth management platform",
};

/**
 * Root layout (AR-66 / AR-67 / AR-68).
 *
 * Provider stack from outside in:
 *   QueryProvider       — TanStack Query for server state
 *     ThemeProvider     — hydrates `data-theme`/`data-density`/`--pm-accent`
 *       AppFrame         — app chrome for product routes; auth routes render
 *                          without the sidebar/topbar shell
 *
 * Sidebar width is driven by `--pm-sidebar-w` (defined in globals.css) so
 * we can tweak the width in one place without touching the layout shell.
 * Using `md:ml-[var(--pm-sidebar-w)]` keeps Tailwind happy and matches
 * the sidebar's actual fixed width of 248px — 8px tighter than the old
 * 256px (md:ml-64) to buy back a bit of content width on 13" laptops.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is per-viewer: render at request time so the identity is
  // never baked into a statically prerendered page.
  await connection();
  const identity = await resolveViewerIdentity();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased overflow-hidden",
        )}
      >
        <QueryProvider>
          <ThemeProvider>
            <IdentityProvider identity={identity}>
              <AppFrame>{children}</AppFrame>
            </IdentityProvider>
          </ThemeProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
