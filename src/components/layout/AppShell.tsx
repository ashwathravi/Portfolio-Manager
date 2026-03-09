"use client";

import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <AppSidebar />
            <div className="pl-64 transition-all duration-300 ease-in-out">
                <TopBar />
                <main className="min-h-[calc(100vh-4rem)]">
                    <div className="container mx-auto p-6 max-w-7xl">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

