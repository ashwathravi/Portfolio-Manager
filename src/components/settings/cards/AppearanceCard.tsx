"use client";

import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    ACCENT_PRESETS,
    useSettingsStore,
    type DensityMode,
    type ThemeMode,
} from "@/lib/stores/settingsStore";
import { handleRovingRadioKey } from "@/lib/a11y/rovingRadio";

/**
 * AR-88 Appearance card.
 *
 * Mirrors the floating Tweaks panel (AR-68) exactly — same setters,
 * same accent presets, same density tokens — so the two surfaces
 * never disagree. Users can reach either one and land at the same
 * persisted state.
 *
 *   ┌─ Appearance ────────────────────────────┐
 *   │  THEME                                  │
 *   │  [ Light | Dim | Dark ]                 │
 *   │  DENSITY                                │
 *   │  [ Comfortable | Compact ]              │
 *   │  ACCENT                                 │
 *   │  ● ● ● ● ●  + label underneath          │
 *   └─────────────────────────────────────────┘
 *
 * Unlike the Tweaks panel, this card:
 *   - Surfaces the accent name next to each dot (tooltip-like label
 *     below the row) so the Settings surface is self-documenting.
 *   - Drops the "Auto" theme option — Settings is a deliberate
 *     choice surface, and the Tweaks panel already covers Auto for
 *     the 3-click flow. If we surface Auto here without the Tweaks
 *     explainer, users end up with theme="system" and no idea why
 *     the app changed colors at sunset.
 *
 * We keep roving focus (AR-64 a11y pattern) on both the theme/density
 * seg groups and the accent dots — arrow keys move selection without
 * triggering a tab stop on every item.
 */

const THEMES: { value: Exclude<ThemeMode, "system">; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dim", label: "Dim" },
    { value: "dark", label: "Dark" },
];
const THEME_ORDER = THEMES.map((t) => t.value);

const DENSITIES: { value: DensityMode; label: string }[] = [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact" },
];
const DENSITY_ORDER = DENSITIES.map((d) => d.value);

export function AppearanceCard() {
    const theme = useSettingsStore((s) => s.appearance.theme);
    const density = useSettingsStore((s) => s.appearance.density);
    const accent = useSettingsStore((s) => s.appearance.accent);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const setDensity = useSettingsStore((s) => s.setDensity);
    const setAccent = useSettingsStore((s) => s.setAccent);

    // If the user picked "system" via the Tweaks panel and then opened
    // Settings, we render it as Light visually (the current effective
    // theme) rather than no selection. The selection still lives in
    // the store as "system" — clicking any theme here overwrites it.
    const themeDisplay: Exclude<ThemeMode, "system"> =
        theme === "system" ? "light" : theme;

    const activeAccent = ACCENT_PRESETS.find((a) => a.value === accent);

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-appearance-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Palette className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-appearance-head"
                        className="pm-settings-card-title"
                    >
                        Appearance
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    Matches the Tweaks panel
                </span>
            </header>

            <div className="pm-settings-card-body">
                {/* Theme */}
                <div className="pm-settings-appearance-group">
                    <div className="pm-settings-field-label">Theme</div>
                    <div
                        role="radiogroup"
                        aria-label="Color theme"
                        className="pm-seg pm-seg-full"
                    >
                        {THEMES.map((t) => {
                            const active = themeDisplay === t.value;
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
                                            themeDisplay,
                                            (next) => setTheme(next),
                                        )
                                    }
                                    className={cn(
                                        "pm-seg-btn",
                                        active && "is-active",
                                    )}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Density */}
                <div className="pm-settings-appearance-group">
                    <div className="pm-settings-field-label">Density</div>
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
                                            (next) => setDensity(next),
                                        )
                                    }
                                    className={cn(
                                        "pm-seg-btn",
                                        active && "is-active",
                                    )}
                                >
                                    {d.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Accent */}
                <div className="pm-settings-appearance-group">
                    <div className="pm-settings-field-label">Accent</div>
                    <div
                        role="radiogroup"
                        aria-label="Accent color"
                        className="pm-settings-accent-row"
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
                                            (next) => setAccent(next),
                                        )
                                    }
                                    className={cn(
                                        "pm-accent-dot",
                                        "pm-settings-accent-dot",
                                        active && "is-active",
                                    )}
                                    style={{ background: a.value }}
                                    title={a.name}
                                />
                            );
                        })}
                    </div>
                    <div className="pm-settings-accent-label">
                        {activeAccent?.name ?? "Custom"}
                    </div>
                </div>
            </div>
        </section>
    );
}
