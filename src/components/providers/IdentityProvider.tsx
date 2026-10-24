"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { displayNameFor, firstNameFor, initialsFor, type ViewerIdentity } from "@/lib/identity";
import { adoptFormerlySharedData } from "@/lib/storage/shared-keys";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const IdentityContext = createContext<ViewerIdentity | null>(null);
const AccountStorageContext = createContext(false);

/**
 * Provides the server-resolved viewer identity to client components, and
 * hands the signed-in user whatever this browser saved before storage was per
 * user, on every page, so no other account can pick it up later.
 *
 * `accountStorage` says whether research data (the watchlist, so far) lives
 * in the viewer's account: true when they're signed in and the app has a
 * database (launch item i38). Without one it stays in this browser.
 */
export function IdentityProvider({
    identity,
    accountStorage = false,
    children,
}: {
    identity: ViewerIdentity | null;
    accountStorage?: boolean;
    children: ReactNode;
}) {
    useEffect(() => {
        if (identity) adoptFormerlySharedData();
    }, [identity]);
    return (
        <IdentityContext.Provider value={identity}>
            <AccountStorageContext.Provider value={accountStorage && identity !== null}>{children}</AccountStorageContext.Provider>
        </IdentityContext.Provider>
    );
}

export function useViewerIdentity(): ViewerIdentity | null {
    return useContext(IdentityContext);
}

/** Whether research data is kept in the viewer's account rather than this browser. */
export function useAccountStorage(): boolean {
    return useContext(AccountStorageContext);
}

/** Display name, first name, and initials, honouring a name set in Settings › Profile. */
export function useDisplayName(): { name: string; firstName: string | null; initials: string; email: string | null } {
    const identity = useViewerIdentity();
    const profileName = useSettingsStore((s) => s.profile.fullName);
    const name = displayNameFor(profileName, identity);
    return {
        name,
        firstName: firstNameFor(profileName, identity),
        initials: initialsFor(name),
        email: identity?.email ?? null,
    };
}
