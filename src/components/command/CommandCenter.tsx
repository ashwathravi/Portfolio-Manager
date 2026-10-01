'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { useUiStore } from '@/lib/stores/uiStore';
import { useThesisStore } from '@/lib/research/useThesisStore';
import { searchCommands, type CommandItem } from '@/lib/command/search';
import { AskSheet } from '@/components/ask/AskSheet';

/**
 * ⌘K / Ctrl+K command center, mounted once in AppFrame.
 *
 * Opens a search palette (also reachable from the top bar's "Search or
 * jump to…" box, which used to do nothing): jump to any page or view,
 * open a ticker or thesis, draft an order, or hand the query to Ask
 * Ledger, which opens in the same overlay with the question asked.
 */
export function CommandCenter() {
    const open = useUiStore((s) => s.commandOpen);
    const mode = useUiStore((s) => s.commandMode);
    const askSeed = useUiStore((s) => s.askSeed);
    const toggle = useUiStore((s) => s.toggleCommand);
    const close = useUiStore((s) => s.closeCommand);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                toggle();
            } else if (e.key === 'Escape' && useUiStore.getState().commandOpen) {
                e.preventDefault();
                close();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggle, close]);

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
            aria-label={mode === 'ask' ? 'Ask Ledger' : 'Search or jump to'}
            data-testid={mode === 'ask' ? 'ask-overlay' : 'command-palette'}
            onClick={(e) => {
                if (e.target === e.currentTarget) close();
            }}
        >
            {mode === 'ask' ? <AskSheet onClose={close} variant="sheet" initialQuestion={askSeed} /> : <CommandPalette />}
        </div>
    );
}

function CommandPalette() {
    const router = useRouter();
    const close = useUiStore((s) => s.closeCommand);
    const openAsk = useUiStore((s) => s.openAsk);
    const { theses } = useThesisStore();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const items = useMemo(() => searchCommands(query, { theses }), [query, theses]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const choose = useCallback(
        (item: CommandItem | undefined) => {
            if (!item) return;
            if (item.ask !== undefined) {
                openAsk(item.ask);
                return;
            }
            if (item.href) {
                close();
                router.push(item.href);
            }
        },
        [close, openAsk, router],
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(items.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(items[active]);
        }
    };

    return (
        <section className="pm-cmd" aria-label="Command palette">
            <div className="pm-cmd-input-row">
                <Search size={16} aria-hidden="true" />
                <input
                    ref={inputRef}
                    id="pm-cmd-input"
                    className="pm-cmd-input"
                    placeholder="Search pages, tickers, theses — or ask a question"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="pm-cmd-list"
                    aria-activedescendant={items[active] ? `pm-cmd-${active}` : undefined}
                    aria-label="Search or jump to"
                    autoComplete="off"
                    spellCheck={false}
                />
                <kbd className="pm-topbar-kbd">Esc</kbd>
            </div>
            <ul id="pm-cmd-list" className="pm-cmd-list" role="listbox" aria-label="Results">
                {items.length === 0 && <li className="pm-cmd-empty">No matches.</li>}
                {items.map((item, index) => {
                    const header = index === 0 || items[index - 1].group !== item.group ? item.group : null;
                    return (
                        <li key={item.id} role="presentation">
                            {header && <p className="pm-cmd-group">{header}</p>}
                            <button
                                type="button"
                                id={`pm-cmd-${index}`}
                                role="option"
                                aria-selected={index === active}
                                className={`pm-cmd-item${index === active ? ' is-active' : ''}`}
                                data-testid="command-item"
                                onMouseEnter={() => setActive(index)}
                                onClick={() => choose(item)}
                            >
                                {item.ask !== undefined ? <Sparkles size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
                                <span className="pm-cmd-label">{item.label}</span>
                                {item.hint && <span className="pm-cmd-hint">{item.hint}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
