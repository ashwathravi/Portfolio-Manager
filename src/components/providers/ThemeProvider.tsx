"use client";

import { useEffect } from "react";
import { useSettingsStore, type ThemeMode } from "@/lib/stores/settingsStore";

/**
 * Resolves a theme choice (including `system`) to a concrete theme
 * attribute value. Exported for tests.
 */
export function resolveTheme(
    theme: ThemeMode,
    prefersDark: boolean
): Exclude<ThemeMode, "system"> {
    if (theme === "system") return prefersDark ? "dark" : "light";
    return theme;
}

/**
 * ThemeProvider — writes the Ledger design tokens to the document:
 *   - `<body data-theme>`   → light | dim | dark  (AR-63)
 *   - `<body data-density>` → comfortable | compact  (AR-64)
 *   - `<html class="dark">` → kept in sync with resolved theme for legacy
 *     Tailwind `dark:` variants
 *   - `data-compact` on `<html>` stays mirrored for back-compat with
 *     pre-Ledger callers.
 *   - `--pm-accent` + `--pm-accent-dark` on `<html>`  (AR-65)
 *
 * Writes happen inside useEffect so SSR output is unaffected.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useSettingsStore((state) => state.appearance.theme);
    const density = useSettingsStore((state) => state.appearance.density);
    const compactMode = useSettingsStore((state) => state.appearance.compactMode);
    const accent = useSettingsStore((state) => state.appearance.accent);

    // Theme (light / dim / dark / system)
    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;

        const apply = (resolved: Exclude<ThemeMode, "system">) => {
            // Dim is a light-family theme — only set the dark class for
            // the true dark theme.
            if (resolved === "dark") {
                root.classList.add("dark");
            } else {
                root.classList.remove("dark");
            }
            // The Ledger token layer keys off `data-theme` on the body.
            body.setAttribute("data-theme", resolved);
        };

        if (theme === "system") {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            apply(resolveTheme("system", mq.matches));
            const handler = (e: MediaQueryListEvent) =>
                apply(resolveTheme("system", e.matches));
            mq.addEventListener("change", handler);
            return () => mq.removeEventListener("change", handler);
        }
        apply(resolveTheme(theme, false));
    }, [theme]);

    // Density (comfortable / compact)
    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;

        body.setAttribute("data-density", density);

        // Back-compat: pre-Ledger selectors still read `data-compact` on the
        // <html> element. Mirror the density flag so both coexist.
        if (density === "compact" || compactMode) {
            root.setAttribute("data-compact", "true");
        } else {
            root.removeAttribute("data-compact");
        }
    }, [density, compactMode]);

    // Accent — drives `--pm-accent` for charts, buttons, active nav.
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--pm-accent", accent);
        root.style.setProperty("--pm-accent-dark", darken(accent, 0.18));
        root.style.setProperty("--pm-accent-tint", withAlpha(accent, 0.1));
    }, [accent]);

    return <>{children}</>;
}

// -----------------------------------------------------------------------------
// Color helpers (kept local — the ThemeProvider is the only consumer)
// -----------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const int = parseInt(m[1], 16);
    return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** Returns the hex darkened by `amount` (0..1). Safe on malformed input. */
export function darken(hex: string, amount: number): string {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    const k = Math.max(0, 1 - amount);
    const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Returns an `rgba()` string for `hex` at `alpha` (0..1). */
export function withAlpha(hex: string, alpha: number): string {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}
