'use client';

/**
 * AR-115 — Global ⌘K / Ctrl+K shortcut that opens the Ask Ledger overlay.
 *
 * Mounted once in the root layout. When triggered it renders the
 * AskSheet inside a full-viewport backdrop. Escape, backdrop click, or
 * the X button closes the overlay.
 *
 * Design notes:
 *   - We don't use a portal — Next.js app-router SSR + a portal needs
 *     extra care around hydration. The overlay uses `position: fixed`
 *     so stacking against the sidebar/topbar is handled at the CSS
 *     level.
 *   - Keyboard handling: we only trap ⌘K/Ctrl+K at the global level and
 *     let focus-trap handle the rest when open.
 */
import { useCallback, useEffect, useState } from 'react';
import { AskSheet } from './AskSheet';

export function AskShortcut() {
    const [open, setOpen] = useState(false);

    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen((prev) => !prev), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Cmd+K (mac) or Ctrl+K (win/linux)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                // Don't hijack browser search on Ctrl+K — our overlay owns
                // this combo once mounted. If a textarea-inside-a-form wants
                // to keep its own handler it can stopPropagation() first.
                e.preventDefault();
                toggle();
                return;
            }
            if (e.key === 'Escape' && open) {
                e.preventDefault();
                close();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, toggle, close]);

    // Prevent body scroll while open.
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="pm-ask-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Ask Ledger"
            data-testid="ask-overlay"
            onClick={(e) => {
                // Close only when clicking the backdrop itself, not a child.
                if (e.target === e.currentTarget) close();
            }}
        >
            <AskSheet onClose={close} variant="sheet" />
        </div>
    );
}
