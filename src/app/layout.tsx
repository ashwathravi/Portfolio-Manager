import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import "../styles/ledger-refinements.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppFrame } from "@/components/layout/AppFrame";

// Self-hosted via next/font so text never silently falls back to system
// fonts. Plex has true tabular figures, which every money column relies on.
const appSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-app-sans",
  display: "swap",
});
const appMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-app-mono",
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
 *       AppFrame         — app chrome for product routes; auth routes render
 *                          without the sidebar/topbar shell
 *
 * Sidebar width is driven by `--pm-sidebar-w` (defined in globals.css) so
 * we can tweak the width in one place without touching the layout shell.
 * Using `md:ml-[var(--pm-sidebar-w)]` keeps Tailwind happy and matches
 * the sidebar's actual fixed width of 248px — 8px tighter than the old
 * 256px (md:ml-64) to buy back a bit of content width on 13" laptops.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(appSans.variable, appMono.variable)}>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased overflow-hidden",
        )}
      >
        <QueryProvider>
          <ThemeProvider>
            <AppFrame>{children}</AppFrame>
          </ThemeProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
