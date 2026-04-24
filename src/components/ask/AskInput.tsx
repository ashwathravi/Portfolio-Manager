'use client';

/**
 * AR-115 — Ask Ledger input bar.
 *
 * Handles the typing UX + enter-to-submit + suggested-prompt pills.
 * Pure presentational: the parent supplies `onSubmit` + `suggestions`
 * and owns the conversation state.
 */
import { useState, useRef, type KeyboardEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import type { AskSuggestion } from '@/lib/ask/suggestions';

export interface AskInputProps {
    onSubmit: (question: string) => void;
    disabled?: boolean;
    /** Placeholder override. Defaults to a generic prompt. */
    placeholder?: string;
    /** Suggestions rendered as pills above the textarea when `showSuggestions`. */
    suggestions?: AskSuggestion[];
    /** Hide the suggestion pills when true (e.g. after first message). */
    showSuggestions?: boolean;
    /** Shown in a small banner above the input when rate-limited. */
    rateLimitMessage?: string;
}

export function AskInput({
    onSubmit,
    disabled,
    placeholder = 'Ask about your portfolio… e.g. "What hurt my alpha this year?"',
    suggestions = [],
    showSuggestions = true,
    rateLimitMessage,
}: AskInputProps) {
    const [value, setValue] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const submit = (q: string) => {
        const trimmed = q.trim();
        if (!trimmed || disabled) return;
        onSubmit(trimmed);
        setValue('');
        // Re-focus so the user can keep typing without tabbing.
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter submits; Shift+Enter inserts a newline (handled natively).
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(value);
        }
    };

    return (
        <div className="pm-ask-inputwrap" data-testid="ask-input-wrap">
            {rateLimitMessage && (
                <p className="pm-ask-ratelimit" role="status" data-testid="ask-ratelimit">
                    {rateLimitMessage}
                </p>
            )}
            {showSuggestions && suggestions.length > 0 && (
                <div className="pm-ask-suggestions" data-testid="ask-suggestions">
                    <span className="pm-ask-suggestions-label">
                        <Sparkles className="pm-ask-suggestions-icon" aria-hidden="true" />
                        Try asking
                    </span>
                    <div className="pm-ask-suggestion-pills">
                        {suggestions.map((s) => (
                            <button
                                key={s.label}
                                type="button"
                                className="pm-ask-suggestion-pill"
                                onClick={() => submit(s.prompt)}
                                disabled={disabled}
                                data-testid="ask-suggestion"
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className="pm-ask-inputrow">
                <textarea
                    ref={textareaRef}
                    className="pm-ask-input"
                    rows={1}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={disabled}
                    aria-label="Ask Ledger a question"
                    data-testid="ask-input"
                />
                <button
                    type="button"
                    onClick={() => submit(value)}
                    className="pm-ask-send"
                    disabled={disabled || !value.trim()}
                    aria-label="Send question"
                    data-testid="ask-send"
                >
                    <Send className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
