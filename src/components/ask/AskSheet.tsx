'use client';

/**
 * AR-115 — Ask Ledger main UI.
 *
 * Used by two callsites:
 *   - `/ask` page (full bleed)
 *   - ⌘K overlay (`CommandCenter`, ask mode)
 *
 * Owns the conversation state: it reads from `storage.getStore()` on
 * mount (hydration-safe), appends new turns via `saveMessage`, and
 * routes submissions through `runAsk`. The pure data layer makes the
 * UI tiny — the heavy lifting (intent detection, tool calls, markdown)
 * happens in `src/lib/ask/*`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { AskMessage, AskStoreShape } from '@/lib/ask/types';
import { runAsk, buildDefaultContext } from '@/lib/ask/run';
import {
    clearHistory,
    getStore,
    incrementDayCount,
    isRateLimited,
    saveMessage,
    DAILY_LIMIT,
} from '@/lib/ask/storage';
import { DEFAULT_SUGGESTIONS } from '@/lib/ask/suggestions';
import { AskMessageList } from './AskMessageList';
import { AskInput } from './AskInput';

/** Shape of the sheet's controls. Both variants render the same body. */
export interface AskSheetProps {
    /** Called when the user hits X/Escape — ⌘K overlay uses this to close. */
    onClose?: () => void;
    /** Tweaks the header copy + rendering for the page variant. */
    variant?: 'sheet' | 'page';
    /** Question handed over from the ⌘K palette; asked once after mount. */
    initialQuestion?: string | null;
}

const EMPTY_SHEET_STORE: AskStoreShape = { history: [], dayBucket: '', dayCount: 0 };

// A worked example for the empty state, computed once from the same
// deterministic tool layer (frozen clock so SSR and hydration agree).
const EXAMPLE = (() => {
    const question = 'Am I overexposed to AI?';
    const text = runAsk(question, buildDefaultContext(Date.UTC(2026, 0, 15))).text;
    const firstPara = text.split(/\n\n/)[0] ?? text;
    return { question, answer: firstPara.length > 260 ? `${firstPara.slice(0, 257).trimEnd()}…` : firstPara };
})();

function uuid(): string {
    // crypto.randomUUID is in every evergreen browser; fallback for SSR /
    // test harness just in case.
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AskSheet({ onClose, variant = 'sheet', initialQuestion = null }: AskSheetProps) {
    const [mounted, setMounted] = useState(false);
    const [store, setStore] = useState<AskStoreShape>(EMPTY_SHEET_STORE);
    const endRef = useRef<HTMLDivElement>(null);
    const messages = store.history;
    const dayCount = store.dayCount;

    // Keep the first server/client render identical, then hydrate from
    // localStorage after mount so persisted history does not cause a
    // React hydration mismatch.
    useEffect(() => {
        const next = getStore();
        queueMicrotask(() => {
            setStore(next);
            setMounted(true);
        });
    }, []);

    // Auto-scroll to the bottom when messages change.
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages]);

    const handleSubmit = useCallback((question: string) => {
        if (isRateLimited()) return;

        const now = Date.now();
        const userMsg: AskMessage = {
            id: uuid(),
            role: 'user',
            content: question,
            ts: now,
        };
        const after = saveMessage(userMsg);
        setStore(after);
        incrementDayCount();

        // Synchronously compute the answer. The tool layer is pure and
        // sub-millisecond on the seed, so a fake-typing delay would only
        // add jitter without any value on this path.
        const answer = runAsk(question, buildDefaultContext(now));
        const asstMsg: AskMessage = {
            id: uuid(),
            role: 'assistant',
            content: answer.text,
            citations: answer.citations,
            toolRuns: answer.toolRuns,
            ts: Date.now(),
        };
        const after2 = saveMessage(asstMsg);
        setStore(after2);
    }, []);

    // Ask the palette's question once, after history has hydrated.
    const askedSeed = useRef(false);
    useEffect(() => {
        if (!mounted || askedSeed.current || !initialQuestion) return;
        askedSeed.current = true;
        // Deferred like the history hydration above so it runs after paint.
        queueMicrotask(() => handleSubmit(initialQuestion));
    }, [mounted, initialQuestion, handleSubmit]);

    const handleClear = () => {
        setStore(clearHistory());
    };

    // The daily cap is a safety net, not a feature — it is only mentioned
    // once it is actually hit (no "N of 30 left" counter).
    const limited = dayCount >= DAILY_LIMIT;
    const rateLimitMessage = limited
        ? `You've hit today's limit of ${DAILY_LIMIT} questions. Resets at midnight.`
        : undefined;

    return (
        <section
            className="pm-ask-sheet"
            data-variant={variant}
            data-testid="ask-sheet"
            aria-label="Ask Ledger"
        >
            <header className="pm-ask-head">
                <div className="pm-ask-head-main">
                    <p className="pm-ask-eyebrow">Ask Ledger</p>
                    <h2 className="pm-ask-title">
                        {variant === 'page'
                            ? 'Ask anything about your portfolio'
                            : 'What do you want to know?'}
                    </h2>
                    <p className="pm-ask-sub">
                        Answers cite the tools they ran over your holdings, journal, and performance
                        (example data until an account is connected).
                    </p>
                </div>
                <div className="pm-ask-head-actions">
                    {messages.length > 0 && (
                        <button
                            type="button"
                            className="pm-ask-head-btn"
                            onClick={handleClear}
                            aria-label="Clear conversation"
                            data-testid="ask-clear"
                            title="Clear conversation"
                        >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                    {variant === 'sheet' && onClose && (
                        <button
                            type="button"
                            className="pm-ask-head-btn"
                            onClick={onClose}
                            aria-label="Close Ask Ledger"
                            data-testid="ask-close"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                </div>
            </header>

            <div className="pm-ask-body">
                {mounted && messages.length === 0 && (
                    <div className="pm-ask-empty" data-testid="ask-empty">
                        <p className="pm-ask-empty-title">Ask about your book in plain words.</p>
                        <div className="pm-ask-example" data-testid="ask-example">
                            <p className="pm-ask-example-q">
                                <span className="pm-sample-tag">Example</span> {EXAMPLE.question}
                            </p>
                            <p className="pm-ask-example-a">{EXAMPLE.answer}</p>
                        </div>
                        <p className="pm-ask-empty-sub">Pick a prompt below or type your own.</p>
                    </div>
                )}
                <AskMessageList messages={messages} />
                <div ref={endRef} />
            </div>

            <footer className="pm-ask-foot">
                <AskInput
                    onSubmit={handleSubmit}
                    disabled={!mounted || limited}
                    showSuggestions={messages.length === 0}
                    suggestions={DEFAULT_SUGGESTIONS}
                    rateLimitMessage={rateLimitMessage}
                />
            </footer>
        </section>
    );
}
