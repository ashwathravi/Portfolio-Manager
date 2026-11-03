'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { useTickerSearch } from '@/lib/api/market-data/queries';
import { searchTextAsTicker, tickerMatchHint } from '@/lib/markets/ticker-search';
import { cn } from '@/lib/utils';
import type { TickerMatch } from '@/types/market-data';

interface TickerSearchInputProps {
    id?: string;
    value: string;
    onChange: (value: string) => void;
    /** A match was chosen from the list. */
    onPick: (match: TickerMatch) => void;
    placeholder?: string;
    className?: string;
    maxLength?: number;
    /** Which edge of the field the suggestions line up with; "end" for a field in a right-hand column. */
    listAlign?: 'start' | 'end';
    'aria-label'?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
}

/**
 * A ticker field that suggests matches by ticker or company name as you
 * type (launch item i35). Whatever is typed still counts on its own: Enter
 * picks a suggestion only when one is highlighted, which happens by itself
 * only for the exact ticker typed, so a ticker missing from the directory is
 * never swapped for a longer one that starts the same way.
 */
export function TickerSearchInput({
    id,
    value,
    onChange,
    onPick,
    placeholder,
    className,
    maxLength = 40,
    listAlign = 'start',
    ...aria
}: TickerSearchInputProps) {
    const listId = useId();
    const [open, setOpen] = useState(false);
    /** The suggestion moved to with the arrows or the pointer; null follows the typing. */
    const [cursor, setCursor] = useState<string | null>(null);
    const { matches } = useTickerSearch(value, { enabled: open });

    const shown = open && value.trim().length > 0 && matches.length > 0;
    const typed = searchTextAsTicker(value);
    const highlighted = cursor !== null && matches.some((m) => m.symbol === cursor)
        ? cursor
        : matches.find((m) => m.symbol === typed)?.symbol ?? null;
    const index = matches.findIndex((m) => m.symbol === highlighted);

    const pick = (match: TickerMatch) => {
        setOpen(false);
        setCursor(null);
        onPick(match);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!shown) {
                setOpen(true);
                return;
            }
            e.preventDefault();
            const next = e.key === 'ArrowDown' ? Math.min(matches.length - 1, index + 1) : index - 1;
            setCursor(next >= 0 ? matches[next].symbol : null);
        } else if (e.key === 'Enter' && shown && index >= 0) {
            e.preventDefault();
            pick(matches[index]);
        } else if (e.key === 'Escape' && shown) {
            // Closes the list, not the dialog it sits in.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
        }
    };

    return (
        <div className={cn('pm-ticker-search', className)}>
            <input
                id={id}
                className="pm-exec-input"
                value={value}
                maxLength={maxLength}
                placeholder={placeholder}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={shown}
                aria-controls={listId}
                aria-activedescendant={shown && index >= 0 ? `${listId}-${index}` : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                    onChange(e.target.value);
                    setCursor(null);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={onKeyDown}
                {...aria}
            />
            <ul
                id={listId}
                role="listbox"
                aria-label="Matching tickers"
                className="pm-ticker-search-list"
                data-align={listAlign}
                hidden={!shown}
            >
                {shown && matches.map((match, i) => {
                    const hint = tickerMatchHint(match);
                    return (
                        <li
                            key={match.symbol}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === index}
                            className={cn('pm-ticker-search-option', i === index && 'is-active')}
                            // Keeps focus in the field, so the list stays open until the click lands.
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setCursor(match.symbol)}
                            onClick={() => pick(match)}
                        >
                            <span className="pm-ticker-search-symbol">{match.symbol}</span>
                            <span className="pm-ticker-search-name">{match.name}</span>
                            {hint && <span className="pm-ticker-search-hint">{hint}</span>}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
