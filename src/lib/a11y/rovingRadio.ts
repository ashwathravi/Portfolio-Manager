import type { KeyboardEvent } from "react";

/**
 * Roving-radiogroup keyboard handler — implements ARIA 1.2 radio pattern.
 *
 *   ArrowRight / ArrowDown → next (wraps)
 *   ArrowLeft  / ArrowUp   → previous (wraps)
 *   Home                   → first
 *   End                    → last
 *
 * Focus is moved to the newly-selected sibling so only one element per group
 * is in the tab order (roving tabindex). Each button in the group should
 * render `tabIndex={active ? 0 : -1}` for this to be correct.
 *
 * Extracted from `AppearanceSettings.tsx` in AR-68 so the new floating
 * Tweaks panel can share the same a11y behavior without copy-paste drift.
 * Two call sites and growing — a shared helper beats duplicated logic.
 */
export function handleRovingRadioKey<T>(
    e: KeyboardEvent<HTMLElement>,
    order: readonly T[],
    current: T,
    onSelect: (next: T) => void
): void {
    const advance: Record<string, (i: number) => number> = {
        ArrowRight: (i) => (i + 1) % order.length,
        ArrowDown: (i) => (i + 1) % order.length,
        ArrowLeft: (i) => (i - 1 + order.length) % order.length,
        ArrowUp: (i) => (i - 1 + order.length) % order.length,
        Home: () => 0,
        End: () => order.length - 1,
    };
    const fn = advance[e.key];
    if (!fn) return;
    e.preventDefault();
    const currentIdx = order.indexOf(current);
    const nextIdx = fn(currentIdx < 0 ? 0 : currentIdx);
    const next = order[nextIdx];
    const parent = e.currentTarget.parentElement;
    onSelect(next);
    // React re-renders synchronously, but we need to wait for the
    // `tabIndex={active ? 0 : -1}` update to land before moving focus.
    requestAnimationFrame(() => {
        (parent?.children[nextIdx] as HTMLElement | undefined)?.focus();
    });
}
