"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/lib/stores/settingsStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useSettingsStore((state) => state.appearance.theme);
    const compactMode = useSettingsStore((state) => state.appearance.compactMode);

    // Apply theme (dark/light/system)
    useEffect(() => {
        const root = document.documentElement;

        const applyTheme = (isDark: boolean) => {
            if (isDark) {
                root.classList.add("dark");
            } else {
                root.classList.remove("dark");
            }
        };

        if (theme === "system") {
            const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
            applyTheme(mediaQuery.matches);
            const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
            mediaQuery.addEventListener("change", handler);
            return () => mediaQuery.removeEventListener("change", handler);
        } else {
            applyTheme(theme === "dark");
        }
    }, [theme]);

    // Apply compact mode
    useEffect(() => {
        if (compactMode) {
            document.documentElement.setAttribute("data-compact", "true");
        } else {
            document.documentElement.removeAttribute("data-compact");
        }
    }, [compactMode]);

    return <>{children}</>;
}
