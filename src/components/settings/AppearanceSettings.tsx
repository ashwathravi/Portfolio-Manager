"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
    ACCENT_PRESETS,
    useSettingsStore,
    type DensityMode,
    type ThemeMode,
} from "@/lib/stores/settingsStore";
import { toast } from "sonner";
import { handleRovingRadioKey } from "@/lib/a11y/rovingRadio";

const DENSITY_ORDER: readonly DensityMode[] = ["comfortable", "compact"] as const;
const DENSITY_LABEL: Record<DensityMode, string> = {
    comfortable: "Comfortable",
    compact: "Compact",
};

export function AppearanceSettings() {
    const theme = useSettingsStore((s) => s.appearance.theme);
    const density = useSettingsStore((s) => s.appearance.density);
    const animationsEnabled = useSettingsStore((s) => s.appearance.animationsEnabled);
    const accent = useSettingsStore((s) => s.appearance.accent);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const setDensity = useSettingsStore((s) => s.setDensity);
    const toggleAnimations = useSettingsStore((s) => s.toggleAnimations);
    const setAccent = useSettingsStore((s) => s.setAccent);

    const handleThemeChange = (value: string) => {
        setTheme(value as ThemeMode);
        const label =
            value === "system"
                ? "Auto"
                : value.charAt(0).toUpperCase() + value.slice(1);
        toast.success(`Theme set to ${label}`);
    };

    const handleDensityChange = (next: DensityMode) => {
        setDensity(next);
        toast.success(
            next === "compact" ? "Compact density enabled" : "Comfortable density enabled"
        );
    };

    const handleAnimationsToggle = () => {
        toggleAnimations();
        toast.success(animationsEnabled ? "Animations disabled" : "Animations enabled");
    };

    const handleAccentChange = (value: string, name: string) => {
        setAccent(value);
        toast.success(`Accent set to ${name}`);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Theme */}
                <div>
                    <h3 className="font-medium mb-3">Theme</h3>
                    <RadioGroup
                        value={theme}
                        onValueChange={handleThemeChange}
                        className="grid grid-cols-4 gap-3"
                    >
                        {/* Light */}
                        <label
                            htmlFor="theme-light"
                            className={`flex flex-col items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                                theme === "light"
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                    : "border-border hover:border-muted-foreground/30"
                            }`}
                        >
                            <div className="w-full aspect-[4/3] rounded-md bg-white border border-neutral-200 flex flex-col p-2 gap-1">
                                <div className="h-1.5 w-8 rounded bg-neutral-200" />
                                <div className="h-1.5 w-12 rounded bg-neutral-100" />
                                <div className="flex-1 rounded bg-neutral-50" />
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="light" id="theme-light" />
                                <span className="text-sm font-medium">Light</span>
                            </div>
                        </label>

                        {/* Dim */}
                        <label
                            htmlFor="theme-dim"
                            className={`flex flex-col items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                                theme === "dim"
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                    : "border-border hover:border-muted-foreground/30"
                            }`}
                        >
                            <div className="w-full aspect-[4/3] rounded-md border flex flex-col p-2 gap-1" style={{ background: "#f0f2ee", borderColor: "#dfe3dd" }}>
                                <div className="h-1.5 w-8 rounded" style={{ background: "#dfe3dd" }} />
                                <div className="h-1.5 w-12 rounded" style={{ background: "#e7eae6" }} />
                                <div className="flex-1 rounded" style={{ background: "#fafbf8" }} />
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="dim" id="theme-dim" />
                                <span className="text-sm font-medium">Dim</span>
                            </div>
                        </label>

                        {/* Dark */}
                        <label
                            htmlFor="theme-dark"
                            className={`flex flex-col items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                                theme === "dark"
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                    : "border-border hover:border-muted-foreground/30"
                            }`}
                        >
                            <div className="w-full aspect-[4/3] rounded-md bg-neutral-900 border border-neutral-700 flex flex-col p-2 gap-1">
                                <div className="h-1.5 w-8 rounded bg-neutral-700" />
                                <div className="h-1.5 w-12 rounded bg-neutral-800" />
                                <div className="flex-1 rounded bg-neutral-800" />
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="dark" id="theme-dark" />
                                <span className="text-sm font-medium">Dark</span>
                            </div>
                        </label>

                        {/* Auto (System) */}
                        <label
                            htmlFor="theme-system"
                            className={`flex flex-col items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                                theme === "system"
                                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                    : "border-border hover:border-muted-foreground/30"
                            }`}
                        >
                            <div className="w-full aspect-[4/3] rounded-md overflow-hidden flex border border-neutral-300">
                                <div className="w-1/2 bg-white flex flex-col p-1.5 gap-0.5">
                                    <div className="h-1 w-5 rounded bg-neutral-200" />
                                    <div className="flex-1 rounded bg-neutral-50" />
                                </div>
                                <div className="w-1/2 bg-neutral-900 flex flex-col p-1.5 gap-0.5">
                                    <div className="h-1 w-5 rounded bg-neutral-700" />
                                    <div className="flex-1 rounded bg-neutral-800" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="system" id="theme-system" />
                                <span className="text-sm font-medium">Auto</span>
                            </div>
                        </label>
                    </RadioGroup>
                </div>

                <hr className="border-border" />

                {/* Density (AR-64) */}
                <div>
                    <h3 className="font-medium mb-3">Density</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                        Tighten card padding, table rows, and font sizes across the app.
                    </p>
                    <div
                        role="radiogroup"
                        aria-label="Interface density"
                        className="pm-seg pm-seg-full max-w-sm"
                    >
                        {DENSITY_ORDER.map((d) => {
                            const active = density === d;
                            return (
                                <button
                                    key={d}
                                    role="radio"
                                    aria-checked={active}
                                    // Roving tabindex: only the active button is in
                                    // the tab order; arrow keys move selection.
                                    tabIndex={active ? 0 : -1}
                                    type="button"
                                    onClick={() => handleDensityChange(d)}
                                    onKeyDown={(e) =>
                                        handleRovingRadioKey(
                                            e,
                                            DENSITY_ORDER,
                                            density,
                                            handleDensityChange
                                        )
                                    }
                                    className={`pm-seg-btn ${active ? "is-active" : ""}`}
                                >
                                    {DENSITY_LABEL[d]}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <hr className="border-border" />

                {/* Accent (AR-65) */}
                <div>
                    <h3 className="font-medium mb-3">Accent</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                        Drives the active-nav highlight, primary buttons, and chart lines.
                    </p>
                    <div
                        role="radiogroup"
                        aria-label="Accent color"
                        className="flex items-center gap-3"
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
                                    // Roving tabindex — see density comment above.
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => handleAccentChange(a.value, a.name)}
                                    onKeyDown={(e) =>
                                        handleRovingRadioKey(
                                            e,
                                            ACCENT_PRESETS.map((p) => p.value),
                                            accent,
                                            (nextValue) => {
                                                const match = ACCENT_PRESETS.find(
                                                    (p) => p.value === nextValue
                                                );
                                                handleAccentChange(
                                                    nextValue,
                                                    match?.name ?? nextValue
                                                );
                                            }
                                        )
                                    }
                                    className={`pm-accent-dot ${active ? "is-active" : ""}`}
                                    // Only the dynamic background color stays inline —
                                    // size/border/shadow/focus ring live in
                                    // `.pm-accent-dot` / `.pm-accent-dot.is-active` /
                                    // `.pm-accent-dot:focus-visible` in globals.css.
                                    style={{ background: a.value }}
                                />
                            );
                        })}
                    </div>
                </div>

                <hr className="border-border" />

                {/* Animations */}
                <div className="flex items-center justify-between space-x-2">
                    <Label htmlFor="animations" className="flex flex-col space-y-1">
                        <span>Animations</span>
                        <span className="font-normal text-xs text-muted-foreground">
                            Enable smooth transitions and animations
                        </span>
                    </Label>
                    <Switch
                        id="animations"
                        checked={animationsEnabled}
                        onCheckedChange={handleAnimationsToggle}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
