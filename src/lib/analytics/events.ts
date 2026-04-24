/**
 * Lightweight analytics shim (AR-109).
 *
 * A thin front door for product analytics — the goal for JournalPlus
 * is to capture behavioral signal without shipping a heavyweight vendor
 * SDK. The real integration lands later; for now we:
 *
 *   1. Normalize every call through a single typed surface so every
 *      call site is greppable (`track('trade.rationale.submitted', …)`)
 *      and easy to migrate when we pick a vendor.
 *   2. Log to console in dev so authors can verify events fire while
 *      building features.
 *   3. Pipe through `window.__pmAnalytics` when present so tests and
 *      the eventual vendor integration can subscribe without patching.
 *
 * Zero dependencies, zero side effects on import. Safe to call from
 * any client component; server-side calls early-return.
 */

export type AnalyticsEvent =
    /** User submitted an order with a completed rationale block. */
    | { name: 'trade.rationale.submitted'; props: TradeRationaleSubmittedProps }
    /** User submitted an order without a rationale because the setting
     *  was disabled, or because this was a non-gated code path. */
    | { name: 'trade.rationale.skipped'; props: TradeRationaleSkippedProps };

export interface TradeRationaleSubmittedProps {
    ticker: string;
    side: 'buy' | 'sell';
    notionalUsd: number;
    setupType: string;
    mood: string;
    conviction: number;
    rationaleLength: number;
    timeToDecisionMs: number;
}

export interface TradeRationaleSkippedProps {
    ticker: string;
    side: 'buy' | 'sell';
    notionalUsd: number;
    /** Why we didn't require a rationale. `setting_off` = user disabled
     *  the rationale requirement in Settings; `unsupported_flow` = a
     *  surface that hasn't yet been wired for rationale capture (e.g.
     *  Terminal keystroke path). */
    reason: 'setting_off' | 'unsupported_flow';
}

declare global {
    interface Window {
        /** Test/vendor hook. Populated by Playwright or a future SDK
         *  adapter to observe the event stream. */
        __pmAnalytics?: {
            events: Array<{ name: string; props: Record<string, unknown>; at: number }>;
            emit?: (name: string, props: Record<string, unknown>) => void;
        };
    }
}

/**
 * Primary entry point. Typed over `AnalyticsEvent` so misspelled event
 * names or missing props are a compile error.
 *
 * Usage:
 *   track('trade.rationale.submitted', { ticker: 'AAPL', ... })
 */
export function track<T extends AnalyticsEvent['name']>(
    name: T,
    props: Extract<AnalyticsEvent, { name: T }>['props'],
): void {
    // SSR / unit-test early-out. Most callers are client components,
    // but React can re-run them on the server during hydration; we'd
    // rather drop the event than crash.
    if (typeof window === 'undefined') return;

    // Cast via `unknown` — typed event unions aren't structurally
    // assignable to `Record<string, unknown>` (no index signature),
    // but their shape at runtime is plain-old-data that the downstream
    // sink expects as a dictionary.
    const propsDict = props as unknown as Record<string, unknown>;
    const payload = { name, props: propsDict, at: Date.now() };

    // Dev-only console trace. Behind `NODE_ENV` so prod bundles are
    // quiet.
    if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[analytics]', name, props);
    }

    // Stash the last N events on window for tests and potential vendor
    // adapters. Capped so long sessions don't balloon memory.
    const bucket = (window.__pmAnalytics ??= { events: [] });
    bucket.events.push(payload);
    if (bucket.events.length > 200) bucket.events.shift();

    // `emit` is user/vendor-supplied — a throwing adapter must not take
    // down the submit handler. Swallow and log so we don't mask bugs
    // in the sink but never fail a trade because analytics crashed.
    if (bucket.emit) {
        try {
            bucket.emit(name, propsDict);
        } catch (err) {
            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.warn('[analytics] sink threw, event kept in buffer', err);
            }
        }
    }
}
