"use client";

import { useEffect } from "react";
import { useSettingsStore, type ThemeMode } from "@/lib/stores/settingsStore";

/** Fallback accent when the store value is malformed (e.g. a stale or
 *  tampered localStorage blob). Matches the Forest preset in
 *  `ACCENT_PRESETS`. Kept here so ThemeProvider is self-contained — the
 *  store's default constant is the source of truth, this is a last-resort
 *  safety valve. */
const DEFAULT_ACCENT = "#17cf54";

/** Luminance threshold above which we pick a dark foreground for the
 *  accent-tinted surface. Chosen to maximize WCAG contrast on the five
 *  brand presets:
 *    Forest #17cf54  Y≈0.4545  → dark (white-on-Forest is 2.08:1, fails AA)
 *    Amber  #f59e0b  Y≈0.4543  → dark (white-on-Amber  is 2.15:1, fails AA)
 *    Teal   #0d9488  Y≈0.2304  → dark (white-on-Teal   is 3.74:1, fails AA)
 *    Indigo #6366f1  Y≈0.1852  → white (white-on-Indigo is 4.47:1, near AA)
 *    Slate  #334155  Y≈0.0514  → white (white-on-Slate  is 10.35:1, AAA)
 *  A 0.22 cutoff sits between Indigo and Teal and gets every preset to its
 *  higher-contrast foreground. */
const ACCENT_FOREGROUND_THRESHOLD = 0.22;

/** How far we darken the accent for hover / border-color derivations.
 *  Kept as a named constant so a designer tweak is a one-liner. */
const ACCENT_DARKEN = 0.18;

/** Alpha used for the subtle accent-tinted surfaces (link-button hover,
 *  focus halos, etc.). */
const ACCENT_TINT_ALPHA = 0.1;

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
    // We validate against the hex regex at the boundary: a tampered
    // localStorage value should NEVER land arbitrary CSS in
    // `root.style.setProperty`. `darken`/`withAlpha` fall back to the
    // raw input on malformed hex, so skipping this guard would leak
    // untrusted strings into derived tokens too.
    useEffect(() => {
        const root = document.documentElement;
        const safeAccent = isValidHex(accent) ? accent : DEFAULT_ACCENT;
        root.style.setProperty("--pm-accent", safeAccent);
        root.style.setProperty("--pm-accent-dark", darken(safeAccent, ACCENT_DARKEN));
        root.style.setProperty("--pm-accent-tint", withAlpha(safeAccent, ACCENT_TINT_ALPHA));
        root.style.setProperty("--pm-accent-foreground", chooseAccentForeground(safeAccent));
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

/** True when `hex` matches the strict 6-char hex shape we accept at the
 *  accent boundary. Exported for tests + for the store (see AR-65 review). */
export function isValidHex(hex: string): boolean {
    return parseHex(hex) !== null;
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

/** Relative luminance per WCAG 2.1 (0 = black, 1 = white). */
function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Picks a readable foreground color (near-black or white) for text/icons
 *  rendered on top of the given accent. Threshold tuned for the five brand
 *  presets so Amber doesn't leave ~2.1:1 white-on-amber in `.pm-btn-primary`.
 *  Returns `#ffffff` on dark accents, `#0d1812` on light. Exported for tests. */
export function chooseAccentForeground(hex: string): string {
    const rgb = parseHex(hex);
    if (!rgb) return "#ffffff";
    return relativeLuminance(rgb) < ACCENT_FOREGROUND_THRESHOLD
        ? "#ffffff"
        : "#0d1812";
}
