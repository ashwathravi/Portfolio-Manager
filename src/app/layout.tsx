import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
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
            <div className="flex h-screen w-full bg-muted/40">
              <AppSidebar />
              <div className="flex-1 flex flex-col h-full ml-64 transition-all duration-300 ease-in-out">
                <TopBar />
                <main className="flex-1 overflow-y-auto">
                  {children}
                </main>
              </div>
            </div>
          </ThemeProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
