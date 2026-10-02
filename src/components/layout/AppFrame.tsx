"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { CommandCenter } from "@/components/command/CommandCenter";
import { PageHeaderProvider } from "@/components/layout/PageHeaderContext";

export function AppFrame({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    useEffect(() => {
        document.body.dataset.pmHydratedPath = pathname;

        return () => {
            delete document.body.dataset.pmHydratedPath;
        };
    }, [pathname]);

    if (pathname === "/login") {
        return <main className="min-h-screen">{children}</main>;
    }

    return (
        <PageHeaderProvider>
            <a href="#pm-main-content" className="pm-a11y-skip">
                Skip to main content
            </a>
            <div className="flex h-screen w-full bg-muted/40">
                <AppSidebar />
                {/* min-w-0: without it this flex item grows to the top bar's
                    min-content width and pushes pages wider than a phone. */}
                <div className="flex-1 min-w-0 flex flex-col h-full md:ml-[var(--pm-sidebar-w)] transition-all duration-300 ease-in-out">
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
            <TweaksPanel />
            <CommandCenter />
        </PageHeaderProvider>
    );
}
