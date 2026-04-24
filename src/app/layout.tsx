import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { AskShortcut } from "@/components/ask/AskShortcut";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { PageHeaderProvider } from "@/components/layout/PageHeaderContext";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
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
 *       PageHeaderProvider — pushes per-route title/crumbs/actions up to Topbar
 *
 * PageHeaderProvider must wrap BOTH `<AppSidebar/>` and `<TopBar/>` plus
 * `{children}` because:
 *   - the Topbar is the consumer (reads the header)
 *   - the pages are the producers (set the header via usePageHeader)
 * Hoisting the provider to the layout root keeps the API declarative and
 * avoids threading a context through every page.
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased overflow-hidden",
          inter.variable,
          jetbrainsMono.variable
        )}
      >
        <QueryProvider>
          <ThemeProvider>
            <PageHeaderProvider>
              {/* Skip-to-content link (AR-91). The first tab stop in the app.
                  Invisible until focused, then appears in the top-left so
                  keyboard users can bypass the sidebar + topbar and jump
                  straight to the current page's content region. */}
              <a href="#pm-main-content" className="pm-a11y-skip">
                Skip to main content
              </a>
              <div className="flex h-screen w-full bg-muted/40">
                <AppSidebar />
                <div className="flex-1 flex flex-col h-full md:ml-[var(--pm-sidebar-w)] transition-all duration-300 ease-in-out">
                  <TopBar />
                  <main
                    id="pm-main-content"
                    className="flex-1 overflow-y-auto"
                    tabIndex={-1}
                  >
                    {children}
                  </main>
                </div>
              </div>
              {/* Floating Tweaks panel — lives outside the flex row so it can
                  float over the whole viewport without affecting layout. */}
              <TweaksPanel />
              {/* AR-115: ⌘K / Ctrl+K overlay for Ask Ledger. Mounts nothing
                  until triggered, then renders a full-viewport modal with
                  the AskSheet inside. */}
              <AskShortcut />
            </PageHeaderProvider>
          </ThemeProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
