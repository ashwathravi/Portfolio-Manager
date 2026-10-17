import type { Metadata } from "next";
import { connection } from "next/server";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import "../styles/ledger-refinements.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppFrame } from "@/components/layout/AppFrame";
import { IdentityProvider } from "@/components/providers/IdentityProvider";
import { RequestTimeProvider } from "@/components/providers/RequestTimeProvider";
import { resolveViewerIdentity } from "@/lib/auth/viewer";

// Self-hosted via next/font so text never silently falls back to system
// fonts. Plex has true tabular figures, which every money column relies on.
const appSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const appMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

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
 *       IdentityProvider / RequestTimeProvider — the viewer and the
 *                          request time the server rendered with
 *         AppFrame       — app chrome for product routes; auth routes render
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
  // Shared with the browser so hydration computes date-relative example
  // data from the same instant as this render.
  // eslint-disable-next-line react-hooks/purity
  const requestTime = Date.now();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Font variables are set here rather than via a className on <html>:
            ThemeProvider toggles `dark` on <html>, and a React-owned className
            there would overwrite it on re-render. */}
        <style>{`:root{--font-app-sans:${appSans.style.fontFamily};--font-app-mono:${appMono.style.fontFamily}}`}</style>
      </head>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased overflow-hidden",
        )}
      >
        <QueryProvider>
          <ThemeProvider>
            <IdentityProvider identity={identity}>
              <RequestTimeProvider now={requestTime}>
                <AppFrame>{children}</AppFrame>
              </RequestTimeProvider>
            </IdentityProvider>
          </ThemeProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
