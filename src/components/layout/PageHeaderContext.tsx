"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

/**
 * Page-header context (AR-67)
 *
 * Pages call `usePageHeader({ title, subtitle?, crumbs?, actions? })` in a
 * `useEffect` to declare the header they want the shared Topbar to render.
 * The Topbar subscribes to this context and re-renders automatically.
 *
 * Why a context instead of prop-drilling the Topbar into every page?
 *  - The Topbar is mounted exactly once in `app/layout.tsx`. Prop-drilling
 *    would force every page to import + render its own Topbar, which breaks
 *    sticky positioning and duplicates the search/notifications/Tweaks chrome.
 *  - Pages sometimes need to update the header mid-flight (e.g. drilling
 *    into a portfolio detail view — the crumb trail grows). A store-like
 *    setter models that cleanly.
 *  - Using React context (not Zustand) keeps the header ephemeral: it
 *    resets when the route changes, and doesn't pollute localStorage.
 *
 * If a page doesn't call `usePageHeader`, the Topbar falls back to the
 * default header (title = `defaultTitle`, no crumbs/actions). This keeps
 * pages that haven't been migrated from Phase 0 rendering cleanly.
 */
export interface PageHeader {
    /** Page title — rendered as the `<h1>` inside the Topbar. */
    title: string;
    /** Optional 1-line muted subtitle under the title. */
    subtitle?: string;
    /** Breadcrumb trail — the LAST crumb is treated as the current page and
     *  highlighted. Pass `['Portfolios', 'Growth']` for "Portfolios / Growth". */
    crumbs?: string[];
    /** Right-aligned action slot (e.g. an "Add portfolio" button). */
    actions?: ReactNode;
}

interface PageHeaderContextValue {
    header: PageHeader | null;
    setHeader: (next: PageHeader | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
    const [header, setHeader] = useState<PageHeader | null>(null);
    // Memoize so consumers don't re-render when the provider re-renders for
    // unrelated reasons.
    const value = useMemo(() => ({ header, setHeader }), [header]);
    return (
        <PageHeaderContext.Provider value={value}>
            {children}
        </PageHeaderContext.Provider>
    );
}

/**
 * Imperative setter — useful when the header needs to be driven by async
 * state (e.g. a portfolio detail page waiting on a fetch to know the
 * portfolio name). Components that can derive the header synchronously
 * should use `usePageHeader` instead.
 */
export function usePageHeaderSetter(): (next: PageHeader | null) => void {
    const ctx = useContext(PageHeaderContext);
    if (!ctx) {
        throw new Error(
            "usePageHeaderSetter must be used inside <PageHeaderProvider>"
        );
    }
    return useCallback(
        (next: PageHeader | null) => ctx.setHeader(next),
        [ctx]
    );
}

/**
 * Declarative hook — a page calls this once per render to declare its
 * header. Handles mount/unmount so the header resets when the route
 * changes. Stringifying the `crumbs` array in the dep list is intentional:
 * it skips re-renders caused by a caller passing a fresh `[...]` literal
 * with the same content.
 */
export function usePageHeader(header: PageHeader): void {
    const ctx = useContext(PageHeaderContext);
    if (!ctx) {
        throw new Error("usePageHeader must be used inside <PageHeaderProvider>");
    }
    const crumbsKey = header.crumbs?.join("›") ?? "";
    // `actions` is a ReactNode and can't be usefully diff'd here — if the
    // caller passes a stable node (memoized or a constant import) the
    // reference check in React handles it; if they pass a fresh JSX each
    // render the header just re-sets each time, which is cheap.
    useEffect(() => {
        ctx.setHeader(header);
        return () => {
            // Reset on unmount so a page that navigates away doesn't leave
            // its stale title in the Topbar while the next page mounts.
            ctx.setHeader(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [header.title, header.subtitle, crumbsKey, header.actions]);
}

/**
 * Topbar-side consumer. Returns the current header (or null if no page
 * has set one yet). Not exported for page use — pages should call
 * `usePageHeader`, not read from context directly.
 */
export function useCurrentPageHeader(): PageHeader | null {
    const ctx = useContext(PageHeaderContext);
    if (!ctx) {
        throw new Error(
            "useCurrentPageHeader must be used inside <PageHeaderProvider>"
        );
    }
    return ctx.header;
}
