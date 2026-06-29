"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";
import {
    useSettingsStore,
    type CurrencyCode,
} from "@/lib/stores/settingsStore";

/**
 * AR-87 Profile card.
 *
 * Three fields:
 *   - Full name (text, persisted as `profile.fullName`)
 *   - Email (email, persisted as `profile.email`)
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

    // Local draft state — committed to the store only on blur or on
    // pressing Enter. This keeps the zustand subscription count low.
    const [fullName, setFullName] = useState(profile.fullName);
    const [email, setEmail] = useState(profile.email);

    // Hydrate local state if the store changes out from under us (e.g.
    // a reset). Stale inputs after a reset would silently re-apply the
    // old values on blur, which is worse than the re-render.
    useEffect(() => {
        // Keep local text drafts aligned with external profile resets.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFullName(profile.fullName);
        setEmail(profile.email);
    }, [profile.fullName, profile.email]);

    const commitName = () => {
        if (fullName.trim() && fullName !== profile.fullName) {
            updateProfile({ fullName: fullName.trim() });
            toast.success("Name updated");
        } else if (!fullName.trim()) {
            // Empty name is nonsensical — snap back to the stored value.
            setFullName(profile.fullName);
        }
    };

    const commitEmail = () => {
        const next = email.trim();
        if (!next) {
            setEmail(profile.email);
            return;
        }
        // Minimal sanity — full RFC-compliant validation is the
        // server's job. We just refuse obviously-malformed inputs.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
            toast.error("That doesn't look like a valid email");
            setEmail(profile.email);
            return;
        }
        if (next !== profile.email) {
            updateProfile({ email: next });
            toast.success("Email updated");
        }
    };

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
                    <span className="pm-settings-field-label">Full name</span>
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
                        placeholder="Your name"
                        autoComplete="name"
                    />
                </label>

                <label className="pm-settings-field">
                    <span className="pm-settings-field-label">Email</span>
                    <input
                        type="email"
                        className="pm-settings-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={commitEmail}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        placeholder="you@example.com"
                        autoComplete="email"
                        spellCheck={false}
                    />
                </label>

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
