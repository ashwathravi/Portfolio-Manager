"use client";

import { signOut } from "next-auth/react";
import { KeyRound } from "lucide-react";
import { useViewerIdentity } from "@/components/providers/IdentityProvider";

/**
 * Sign-in & security. Atlas Wealth signs in with Google only, so there is
 * no password to change and two-factor lives in the Google account. The
 * old Security tab had a password form that showed "Password updated"
 * without changing anything; this card says what is actually true.
 */
export function SignInCard() {
    const identity = useViewerIdentity();
    return (
        <section className="pm-settings-card" aria-labelledby="pm-settings-signin-head" data-testid="signin-card">
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <KeyRound className="pm-settings-card-icon" aria-hidden="true" />
                    <h2 id="pm-settings-signin-head" className="pm-settings-card-title">Sign-in &amp; security</h2>
                </div>
            </header>
            <div className="pm-settings-card-body">
                <p className="pm-settings-readonly">
                    {identity?.mode === "signed-in"
                        ? `Signed in with Google${identity.email ? ` as ${identity.email}` : ""}.`
                        : identity?.mode === "local-dev"
                            ? "Local development session — Google sign-in is bypassed on this machine."
                            : "Not signed in."}
                </p>
                <p className="pm-card-subtitle">
                    Passwords and two-step verification are managed in your Google account.
                    Brokerage access tokens are stored server-side and never in this browser.
                </p>
                {identity?.mode === "signed-in" && (
                    <div className="pm-empty-actions">
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={() => void signOut({ callbackUrl: "/login" })}>
                            Sign out
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}
