"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { displayNameFor, firstNameFor, initialsFor, type ViewerIdentity } from "@/lib/identity";
import { adoptFormerlySharedData } from "@/lib/storage/shared-keys";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const IdentityContext = createContext<ViewerIdentity | null>(null);

/**
 * Provides the server-resolved viewer identity to client components, and
 * hands the signed-in user whatever this browser saved before storage was per
 * user, on every page, so no other account can pick it up later.
 */
export function IdentityProvider({ identity, children }: { identity: ViewerIdentity | null; children: ReactNode }) {
    useEffect(() => {
        if (identity) adoptFormerlySharedData();
    }, [identity]);
    return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

export function useViewerIdentity(): ViewerIdentity | null {
    return useContext(IdentityContext);
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
