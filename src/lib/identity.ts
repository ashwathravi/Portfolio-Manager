/**
 * Who the viewer is, as shown in the UI (sidebar footer, greeting, profile).
 * Client-safe: pure helpers over a serializable identity resolved on the
 * server from the Auth.js session (see lib/auth/viewer.ts).
 */

export interface ViewerIdentity {
    /** Auth user id; scopes per-user browser storage (e.g. the watchlist). */
    id: string | null;
    name: string | null;
    email: string | null;
    image: string | null;
    /** `local-dev` when running with AUTH_LOCAL_DEV_BYPASS (no Google session). */
    mode: 'signed-in' | 'local-dev';
}

/**
 * Display name precedence: a name the user typed in Settings › Profile,
 * then the Google account name, then the email's local part, then a
 * neutral fallback. Never a placeholder person.
 */
export function displayNameFor(profileName: string | null | undefined, identity: ViewerIdentity | null): string {
    const typed = profileName?.trim();
    if (typed) return typed;
    const name = identity?.name?.trim();
    if (name) return name;
    const local = identity?.email?.split('@')[0]?.trim();
    if (local) return local;
    return identity?.mode === 'local-dev' ? 'Local developer' : 'You';
}

/** First word of the display name, or null when only a fallback exists. */
export function firstNameFor(profileName: string | null | undefined, identity: ViewerIdentity | null): string | null {
    const typed = profileName?.trim() || identity?.name?.trim();
    if (!typed) return null;
    return typed.split(/\s+/)[0] ?? null;
}

export function initialsFor(displayName: string): string {
    const parts = displayName.split(/[\s._-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
    return `${first}${last}`.toUpperCase() || '?';
}
