/**
 * Phase 7 (AR-83) Execution variant model.
 *
 * The execution surface ships three interchangeable layouts so we can put
 * the same job — place an order, review what's working, audit what filled
 * — in front of three different moods of trader:
 *
 *   - `focus`     · split form + blotter. The default. Calm, one screen,
 *                   everything in view. Good for discretionary traders who
 *                   sit on a few names a day.
 *   - `checkout`  · guided wizard (Security → Sizing → Thesis → Review).
 *                   Good for newer traders, for systematic traders who
 *                   want the guardrails, and for anyone who wants the
 *                   "am I really sure" beat before they click.
 *   - `terminal`  · pro command palette, monospaced dark theme, Level II
 *                   book, hotkeys. Good for high-activity days and for
 *                   traders who already live in Bloomberg/TWS.
 *
 * Pure module — no React, no DOM — so the type can be imported by server
 * components, the reducer is unit-testable, and swapping localStorage for
 * a server round-trip later is a one-function change.
 */
export type ExecutionVariant = 'focus' | 'checkout' | 'terminal';

export const EXECUTION_VARIANTS: readonly ExecutionVariant[] = [
    'focus',
    'checkout',
    'terminal',
] as const;

export const DEFAULT_EXECUTION_VARIANT: ExecutionVariant = 'focus';

const STORAGE_KEY = 'pm-exec-variant';

/** Labels for the variant switcher row. */
export const EXECUTION_VARIANT_LABELS: Record<ExecutionVariant, string> = {
    focus: 'Focus',
    checkout: 'Checkout',
    terminal: 'Terminal',
};

/** Sub-labels (one-line pitch under the label in the switcher). */
export const EXECUTION_VARIANT_SUBS: Record<ExecutionVariant, string> = {
    focus: 'Form + blotter',
    checkout: 'Guided wizard',
    terminal: 'Pro palette',
};

/** Breadcrumb-ready capitalized name (`Execution · Focus`). */
export function variantCrumb(v: ExecutionVariant): string {
    return EXECUTION_VARIANT_LABELS[v];
}

/** Type guard so string casts from storage are safe. */
export function isExecutionVariant(v: unknown): v is ExecutionVariant {
    return typeof v === 'string' && (EXECUTION_VARIANTS as readonly string[]).includes(v);
}

/**
 * Read the persisted variant. Returns DEFAULT_EXECUTION_VARIANT on the
 * server, when localStorage is unavailable, or when the stored value is
 * missing/corrupt. Safe to call from a useEffect on mount.
 */
export function readExecutionVariant(): ExecutionVariant {
    if (typeof window === 'undefined') return DEFAULT_EXECUTION_VARIANT;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (isExecutionVariant(raw)) return raw;
    } catch {
        // localStorage access denied (private mode / sandboxed iframe) —
        // fall through to the default. Not worth surfacing.
    }
    return DEFAULT_EXECUTION_VARIANT;
}

/** Persist a variant choice. No-op on the server or when storage fails. */
export function writeExecutionVariant(v: ExecutionVariant): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
        // Same fallback as read — silently ignore.
    }
}
