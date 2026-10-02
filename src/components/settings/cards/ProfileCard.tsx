"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";
import {
    useSettingsStore,
    type CurrencyCode,
} from "@/lib/stores/settingsStore";
import { useViewerIdentity } from "@/components/providers/IdentityProvider";

/**
 * AR-87 Profile card.
 *
 * Fields:
 *   - Display name (optional override of the Google account name,
 *     persisted as `profile.fullName`; clear it to use the account name)
 *   - Email (read-only: the signed-in Google account)
 *   - Base currency (select, persisted as `preferences.baseCurrency`)
 *
 * Name / email are locally buffered and committed on blur to avoid
 * spamming the store with every keystroke. Currency writes immediately
 * because it's a single-click select; a debounced buffer would feel
 * surprising there.
 *
 * A thin "Saved" eyebrow fades in after a successful write so the user
 * gets an unmissable confirmation without a modal or toast — we're in
 * a settings page, not a transactional flow.
 */

const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
    { value: "USD", label: "USD — US Dollar" },
    { value: "EUR", label: "EUR — Euro" },
    { value: "GBP", label: "GBP — British Pound" },
];

export function ProfileCard() {
    const profile = useSettingsStore((s) => s.profile);
    const updateProfile = useSettingsStore((s) => s.updateProfile);
    const baseCurrency = useSettingsStore((s) => s.preferences.baseCurrency);
    const updatePreferences = useSettingsStore((s) => s.updatePreferences);

    const identity = useViewerIdentity();

    // Local draft state — committed to the store only on blur or on
    // pressing Enter. This keeps the zustand subscription count low.
    const [fullName, setFullName] = useState(profile.fullName);

    // Hydrate local state if the store changes out from under us (e.g. a reset).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFullName(profile.fullName);
    }, [profile.fullName]);

    // An empty display name is allowed: it means "use my account name".
    const commitName = () => {
        const next = fullName.trim();
        if (next === profile.fullName) return;
        updateProfile({ fullName: next });
        toast.success(next ? "Display name updated" : "Using your account name");
    };

    const accountEmail = identity?.email ?? null;

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-profile-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <User className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-profile-head"
                        className="pm-settings-card-title"
                    >
                        Profile
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    Shown across the workspace
                </span>
            </header>

            <div className="pm-settings-card-body">
                <label className="pm-settings-field">
                    <span className="pm-settings-field-label">Display name</span>
                    <input
                        type="text"
                        className="pm-settings-input"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        placeholder={identity?.name ?? "Your name"}
                        autoComplete="name"
                    />
                </label>

                <div className="pm-settings-field">
                    <span className="pm-settings-field-label">Email</span>
                    <p className="pm-settings-readonly" data-testid="profile-email">
                        {accountEmail
                            ? `${accountEmail} · signed in with Google`
                            : identity?.mode === "local-dev"
                                ? "Local development session (no Google account)"
                                : "Not signed in"}
                    </p>
                </div>

                <label className="pm-settings-field">
                    <span className="pm-settings-field-label">Base currency</span>
                    <select
                        className="pm-settings-select"
                        value={baseCurrency}
                        onChange={(e) => {
                            const next = e.target.value as CurrencyCode;
                            updatePreferences({ baseCurrency: next });
                            toast.success(`Base currency set to ${next}`);
                        }}
                    >
                        {CURRENCY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
        </section>
    );
}
