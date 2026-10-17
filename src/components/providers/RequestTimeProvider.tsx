"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

const RequestTimeContext = createContext<number | null>(null);

/** Provides the time (Unix ms) the server rendered this document at. */
export function RequestTimeProvider({ now, children }: { now: number; children: ReactNode }) {
    return <RequestTimeContext.Provider value={now}>{children}</RequestTimeContext.Provider>;
}

const subscribeNever = () => () => {};

/**
 * The clock for rendering date-relative example data. In the server render
 * and during hydration it is the server's request time, so the browser
 * computes the same UTC day even when hydration lands after midnight or its
 * clock is off; after hydration, and in components that mount later, it is
 * the browser clock.
 */
export function useRenderNow(): number {
    const requestTime = useContext(RequestTimeContext);
    const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
    // Deliberately the live clock once hydrated; callers derive day- or
    // month-level values from it, which stay stable between renders.
    // eslint-disable-next-line react-hooks/purity
    return hydrated || requestTime === null ? Date.now() : requestTime;
}
