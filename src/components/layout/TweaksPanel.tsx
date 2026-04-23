"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/stores/uiStore";
import {
    ACCENT_PRESETS,
    useSettingsStore,
    type DensityMode,
    type ThemeMode,
} from "@/lib/stores/settingsStore";
import { handleRovingRadioKey } from "@/lib/a11y/rovingRadio";

/**
 * Floating Tweaks panel (AR-68)
 *
 * Handoff reference: `components/TweaksPanel.jsx` + `styles.css` `.pm-tweaks*`.
 *
 *   ┌─ Appearance ────────────── [×] ┐
 *   │  Accent                         │
 *   │  ● ● ● ● ●                      │
 *   │  Theme                          │
 *   │  [ Light | Dim | Dark | Auto ]  │
 *   │  Density                        │
 *   │  [ Comfortable | Compact ]      │
 *   │                                 │
 *   │  Want more? Open full Settings →│
 *   └─────────────────────────────────┘
 *
 * The panel is a 280px-wide popover anchored to the top-right of the
 * viewport (visually tracking the Topbar gear button). It's driven by
 * `useUiStore.tweaksOpen` — toggled by the gear button in the Topbar
 * and by the "Appearance" item in the SidebarUserFooter menu.
 *
 * Why a custom floating panel instead of a Radix Popover?
 *   1. The anchor (the gear button) lives in a sibling React subtree
 *      (`<TopBar/>`), and we need the panel mounted at the layout root
 *      so it can float over `<main>` without being clipped by the
 *      `overflow-y-auto` container. A Radix Popover with a shared
 *      `<PopoverTrigger/>` would require lifting state anyway, so we
 *      already own the state via uiStore — the panel just reads it.
 *   2. This panel is viewport-pinned (top-right), not anchored to a
 *      specific DOM element. Radix's positioning logic is overkill.
 *   3. The close-on-outside-click / close-on-ESC logic is 20 lines of
 *      useEffect; pulling in Radix just for those two behaviors doesn't
 *      pay rent.
 *
 * The existing `<AppearanceSettings>` card in `/settings` remains the
 * canonical deep-dive (with preview tiles, animation toggle, etc.). The
 * Tweaks panel is the 3-click quick-switch surface — accent, theme,
 * density, that's it.
 *
 * NOT in this panel (intentional):
 *   - Animations toggle → lives in Settings. Flipping animations is
 *     sticky enough that you set it once and forget it.
 *   - Preview tiles → each theme preview is ~80px² in Settings; we don't
 *     have the vertical budget in a 280px-wide popover.
 */

const THEMES: { value: ThemeMode; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dim", label: "Dim" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Auto" },
];

const THEME_ORDER: readonly ThemeMode[] = THEMES.map((t) => t.value);

const DENSITIES: { value: DensityMode; label: string }[] = [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact" },
];

const DENSITY_ORDER: readonly DensityMode[] = DENSITIES.map((d) => d.value);

export function TweaksPanel() {
    const open = useUiStore((s) => s.tweaksOpen);
    const closeTweaks = useUiStore((s) => s.closeTweaks);

    const theme = useSettingsStore((s) => s.appearance.theme);
    const density = useSettingsStore((s) => s.appearance.density);
    const accent = useSettingsStore((s) => s.appearance.accent);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const setDensity = useSettingsStore((s) => s.setDensity);
    const setAccent = useSettingsStore((s) => s.setAccent);

    const panelRef = useRef<HTMLDivElement>(null);

    // Close on outside click. We gate on `open` so the listener only runs
    // while the panel is visible — cheaper and it avoids the first-open
    // race where the same click that opened it also gets captured here
    // (which would close it immediately).
    useEffect(() => {
        if (!open) return;
        // Cleanup ref declared up-front so the raf callback can assign to
        // it and the useEffect cleanup can read it back.
        const cleanup: { fn: (() => void) | null } = { fn: null };
        // Defer attach by a frame so the gear-button click that opened the
        // panel doesn't bubble into this handler and close the panel on
        // the very same tick.
        const raf = requestAnimationFrame(() => {
            const onClick = (e: MouseEvent) => {
                const target = e.target as Node | null;
                if (!target) return;
                if (panelRef.current && !panelRef.current.contains(target)) {
                    closeTweaks();
                }
            };
            window.addEventListener("mousedown", onClick);
            cleanup.fn = () =>
                window.removeEventListener("mousedown", onClick);
        });
        return () => {
            cancelAnimationFrame(raf);
            cleanup.fn?.();
        };
    }, [open, closeTweaks]);

    // Close on ESC. Separate effect so the tab scope is scoped to the
    // keydown lifecycle rather than the mousedown one.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                closeTweaks();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, closeTweaks]);

    // Focus the panel when it opens so SR users know focus moved, and ESC
    // works even if no button inside has been clicked yet. We focus the
    // wrapper (tabIndex={-1}) rather than the first button so opening the
    // panel doesn't accidentally "select" the first accent dot visually.
    useEffect(() => {
        if (open) {
            // Wait a frame for the element to enter layout before focusing.
            requestAnimationFrame(() => panelRef.current?.focus());
        }
    }, [open]);

    if (!open) return null;

    return (
        <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-label="Appearance tweaks"
            className="pm-tweaks-panel"
        >
            <div className="pm-tweaks-header">
                <div className="pm-tweaks-title-row">
                    <Settings
                        className="pm-tweaks-icon"
                        aria-hidden="true"
                    />
                    <h2 className="pm-tweaks-title">Appearance</h2>
                </div>
                <button
                    type="button"
                    onClick={closeTweaks}
                    aria-label="Close"
                    className="pm-tweaks-close"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <div className="pm-tweaks-body">
                {/* Accent */}
                <section className="pm-tweaks-section">
                    <h3 className="pm-tweaks-section-label">Accent</h3>
                    <div
                        role="radiogroup"
                        aria-label="Accent color"
                        className="pm-tweaks-accent-row"
                    >
                        {ACCENT_PRESETS.map((a) => {
                            const active = accent === a.value;
                            return (
                                <button
                                    key={a.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    aria-label={a.name}
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => setAccent(a.value)}
                                    onKeyDown={(e) =>
                                        handleRovingRadioKey(
                                            e,
                                            ACCENT_PRESETS.map((p) => p.value),
                                            accent,
                                            (next) => setAccent(next)
                                        )
                                    }
                                    className={cn(
                                        "pm-accent-dot",
                                        active && "is-active"
                                    )}
                                    style={{ background: a.value }}
                                />
                            );
                        })}
                    </div>
                </section>

                {/* Theme */}
                <section className="pm-tweaks-section">
                    <h3 className="pm-tweaks-section-label">Theme</h3>
                    <div
                        role="radiogroup"
                        aria-label="Color theme"
                        className="pm-seg pm-seg-full"
                    >
                        {THEMES.map((t) => {
                            const active = theme === t.value;
                            return (
                                <button
                                    key={t.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => setTheme(t.value)}
                                    onKeyDown={(e) =>
                                        handleRovingRadioKey(
                                            e,
                                            THEME_ORDER,
                                            theme,
                                            (next) => setTheme(next)
                                        )
                                    }
                                    className={cn(
                                        "pm-seg-btn",
                                        active && "is-active"
                                    )}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* Density */}
                <section className="pm-tweaks-section">
                    <h3 className="pm-tweaks-section-label">Density</h3>
                    <div
                        role="radiogroup"
                        aria-label="Interface density"
                        className="pm-seg pm-seg-full"
                    >
                        {DENSITIES.map((d) => {
                            const active = density === d.value;
                            return (
                                <button
                                    key={d.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => setDensity(d.value)}
                                    onKeyDown={(e) =>
                                        handleRovingRadioKey(
                                            e,
                                            DENSITY_ORDER,
                                            density,
                                            (next) => setDensity(next)
                                        )
                                    }
                                    className={cn(
                                        "pm-seg-btn",
                                        active && "is-active"
                                    )}
                                >
                                    {d.label}
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>

            <div className="pm-tweaks-footer">
                <Link
                    href="/settings?tab=appearance"
                    onClick={closeTweaks}
                    className="pm-tweaks-link"
                >
                    Open full Appearance settings →
                </Link>
            </div>
        </div>
    );
}
