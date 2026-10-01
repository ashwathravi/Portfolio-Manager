"use client";

import { createContext, useContext, type ReactNode } from "react";
import { displayNameFor, firstNameFor, initialsFor, type ViewerIdentity } from "@/lib/identity";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const IdentityContext = createContext<ViewerIdentity | null>(null);

/** Provides the server-resolved viewer identity to client components. */
export function IdentityProvider({ identity, children }: { identity: ViewerIdentity | null; children: ReactNode }) {
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
