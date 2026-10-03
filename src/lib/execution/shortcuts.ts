/**
 * Trade ticket keyboard mode — the "one ticket with an expert keyboard
 * mode" from the design review (it replaced the separate Terminal layout).
 *
 * Single-letter keys only act when focus is not in a text field, so typing
 * a ticker like "BLS" never flips the side. ⌘/Ctrl+Enter reviews the order
 * from anywhere, including inside a field. Nothing here bypasses the
 * ticket's own gates (rationale, cooldown, guardrails): `submit` calls the
 * same handler as the button, which still refuses when it is disabled.
 */
import type { OrderSide, OrderType } from "@/types/execution";

export type TicketShortcut =
    | { kind: "side"; side: OrderSide }
    | { kind: "orderType"; orderType: OrderType }
    | { kind: "focus"; field: "ticker" | "quantity" }
    | { kind: "submit" }
    | { kind: "help" }
    | { kind: "escape" };

export interface ShortcutKeyEvent {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    /** Keyboard auto-repeat from a held key. */
    repeat?: boolean;
    /** True when focus is in an input, textarea, select, or contenteditable. */
    inEditable: boolean;
    /** True when a modal (⌘K palette, Ask) owns the keyboard. */
    overlayOpen?: boolean;
}

const LETTERS: Record<string, TicketShortcut> = {
    b: { kind: "side", side: "buy" },
    s: { kind: "side", side: "sell" },
    m: { kind: "orderType", orderType: "market" },
    l: { kind: "orderType", orderType: "limit" },
    t: { kind: "focus", field: "ticker" },
    q: { kind: "focus", field: "quantity" },
    "?": { kind: "help" },
};

export function resolveTicketShortcut(e: ShortcutKeyEvent): TicketShortcut | null {
    if (e.overlayOpen) return null;
    // A held ⌘↵ auto-repeats; only the first press may review the order.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "Enter") return e.repeat ? null : { kind: "submit" };
    if (e.key === "Escape") return { kind: "escape" };
    if (e.inEditable || e.metaKey || e.ctrlKey || e.altKey) return null;
    return LETTERS[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? null;
}

/** The cheat sheet, in the order it is shown. */
export const TICKET_SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; label: string }> = [
    { keys: ["B"], label: "Buy" },
    { keys: ["S"], label: "Sell" },
    { keys: ["T"], label: "Ticker" },
    { keys: ["Q"], label: "Quantity" },
    { keys: ["M"], label: "Market order" },
    { keys: ["L"], label: "Limit order" },
    { keys: ["⌘", "Enter"], label: "Review order" },
    { keys: ["Esc"], label: "Leave field" },
    { keys: ["?"], label: "Show shortcuts" },
];

/** Whether a DOM element is somewhere the user types. */
export function isEditableElement(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type;
        return !["button", "checkbox", "radio", "submit", "reset", "range", "color"].includes(type);
    }
    return (el as HTMLElement).isContentEditable === true;
}
