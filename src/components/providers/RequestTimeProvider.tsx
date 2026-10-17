"use client";

import { createContext, useContext, type ReactNode } from "react";

const RequestTimeContext = createContext<number | null>(null);

/** Provides the time (Unix ms) the server rendered this document at. */
export function RequestTimeProvider({ now, children }: { now: number; children: ReactNode }) {
    return <RequestTimeContext.Provider value={now}>{children}</RequestTimeContext.Provider>;
}

/**
 * The clock for rendering date-relative example data: the time the server
 * rendered this document at. The server render and hydration read the same
 * value, so they agree on the UTC day even when hydration lands after
 * midnight or the browser clock is off. It stays fixed for the life of the
 * document (a reload picks up a new one); outside the provider it is the
 * current time.
 *
 * Deliberately not a live clock after hydration: switching values once
 * hydrated (e.g. with useSyncExternalStore) forces every caller to
 * re-render right after it hydrates, and on a slow device that swallowed
 * clicks made during hydration.
 */
export function useRequestTime(): number {
    const requestTime = useContext(RequestTimeContext);
    // Only outside the app layout (no provider), e.g. isolated renders.
    // eslint-disable-next-line react-hooks/purity
    return requestTime ?? Date.now();
}
