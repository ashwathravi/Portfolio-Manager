'use client';

/**
 * AR-115 — Ask Ledger main UI.
 *
 * Used by two callsites:
 *   - `/ask` page (full bleed)
 *   - ⌘K overlay (`CommandCenter`, ask mode)
 *
 * The server answers every question from the user's own data (launch item
 * i56, POST /api/ask). With a database the conversation and the daily
 * count live in the account too (GET and DELETE /api/ask); without one,
 * this browser keeps them (`storage.ts`). A transcript a browser kept
 * before answers came from the user's data was about example data, so it
 * goes once the account keeps the conversation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useAccountStorage } from '@/components/providers/IdentityProvider';
import type { AskMessage } from '@/lib/ask/types';
import {
    ASK_STORAGE_KEY,
    clearHistory,
    getStore,
    incrementDayCount,
    saveMessage,
    DAILY_LIMIT,
} from '@/lib/ask/storage';
import { browserLocalStorage, removeUserValue } from '@/lib/storage/user-scope';
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

/** A worked example for the empty state, labelled as one. */
const EXAMPLE = {
    question: 'Am I overexposed to AI?',
    answer: 'Current sector exposure is led by Tech at 87.2% of NAV.',
};

interface Conversation {
    messages: AskMessage[];
    questionsToday: number;
    limit: number;
}

interface AskReply {
    data?: { messages: AskMessage[]; questionsToday: number; limit: number; stored: boolean };
    error?: string;
    code?: string;
}

function uuid(): string {
    // crypto.randomUUID is in every evergreen browser; fallback for SSR /
    // test harness just in case.
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** An answer that couldn't be had, shown in place of one and never kept. */
function notice(content: string): AskMessage {
    return { id: `notice-${uuid()}`, role: 'assistant', content, ts: Date.now() };
}

export function AskSheet({ onClose, variant = 'sheet', initialQuestion = null }: AskSheetProps) {
    const inAccount = useAccountStorage();
    const [loaded, setLoaded] = useState(false);
    const [pending, setPending] = useState(false);
    const [conversation, setConversation] = useState<Conversation>({ messages: [], questionsToday: 0, limit: DAILY_LIMIT });
    const endRef = useRef<HTMLDivElement>(null);
    const { messages, questionsToday, limit } = conversation;

    // Keep the first server/client render identical, then load the
    // conversation after mount: from the account, or from this browser.
    useEffect(() => {
        let cancelled = false;
        const finish = (next: Conversation) => {
            if (cancelled) return;
            setConversation(next);
            setLoaded(true);
        };
        if (!inAccount) {
            const local = getStore();
            queueMicrotask(() => finish({ messages: local.history, questionsToday: local.dayCount, limit: DAILY_LIMIT }));
            return () => { cancelled = true; };
        }
        removeUserValue(browserLocalStorage(), ASK_STORAGE_KEY);
        fetch('/api/ask', { cache: 'no-store' })
            .then(async (response) => {
                const body = (await response.json()) as AskReply;
                if (!response.ok || !body.data) throw new Error(body.error ?? 'Ask history unavailable');
                finish({ messages: body.data.messages, questionsToday: body.data.questionsToday, limit: body.data.limit });
            })
            .catch(() => finish({
                messages: [notice("Your earlier questions couldn't be loaded. New ones are still answered.")],
                questionsToday: 0,
                limit: DAILY_LIMIT,
            }));
        return () => { cancelled = true; };
    }, [inAccount]);

    // Auto-scroll to the bottom when messages change.
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages]);

    const handleSubmit = useCallback(async (question: string) => {
        if (pending || questionsToday >= limit) return;
        const asked: AskMessage = { id: uuid(), role: 'user', content: question, ts: Date.now() };
        setPending(true);
        setConversation((current) => ({ ...current, messages: [...current.messages, asked] }));
        const without = (current: Conversation) => current.messages.filter((message) => message.id !== asked.id);
        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
            });
            const body = (await response.json().catch(() => ({}))) as AskReply;
            if (response.status === 429) {
                setConversation((current) => ({ ...current, messages: without(current), questionsToday: current.limit }));
                return;
            }
            if (!response.ok || !body.data) {
                setConversation((current) => ({
                    ...current,
                    messages: [...current.messages, notice(body.error && response.status === 400
                        ? body.error
                        : "I couldn't load your data to answer that. Try again in a moment.")],
                }));
                return;
            }
            const data = body.data;
            if (!data.stored) {
                // No database: this browser keeps the conversation and the count.
                for (const message of data.messages) saveMessage(message);
                const count = incrementDayCount();
                setConversation((current) => ({ ...current, messages: [...without(current), ...data.messages], questionsToday: count }));
                return;
            }
            setConversation((current) => ({
                messages: [...without(current), ...data.messages],
                questionsToday: data.questionsToday,
                limit: data.limit,
            }));
        } catch {
            setConversation((current) => ({
                ...current,
                messages: [...current.messages, notice("I couldn't reach the server to answer that. Try again in a moment.")],
            }));
        } finally {
            setPending(false);
        }
    }, [pending, questionsToday, limit]);

    // Ask the palette's question once, after the conversation has loaded.
    const askedSeed = useRef(false);
    useEffect(() => {
        if (!loaded || askedSeed.current || !initialQuestion) return;
        askedSeed.current = true;
        // Deferred like the history hydration above so it runs after paint.
        queueMicrotask(() => void handleSubmit(initialQuestion));
    }, [loaded, initialQuestion, handleSubmit]);

    const handleClear = async () => {
        if (!inAccount) {
            const fresh = clearHistory();
            setConversation({ messages: fresh.history, questionsToday: fresh.dayCount, limit: DAILY_LIMIT });
            return;
        }
        const response = await fetch('/api/ask', { method: 'DELETE' }).catch(() => null);
        // The day's questions still count: clearing isn't a way round the limit.
        if (response?.ok) setConversation((current) => ({ ...current, messages: [] }));
    };

    // The daily cap is a safety net, not a feature — it is only mentioned
    // once it is actually hit (no "N of 30 left" counter).
    const limited = questionsToday >= limit;
    const rateLimitMessage = limited
        ? inAccount
            ? `You've asked ${limit} questions in the last 24 hours. Try again later.`
            : `You've hit today's limit of ${limit} questions. Resets at midnight.`
        : undefined;
    const mounted = loaded;

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
                        Answers come from your own holdings, trades, theses and risk policy, and cite
                        the tools they ran.
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
                {pending && (
                    <p className="pm-ask-pending" data-testid="ask-pending" role="status">
                        Looking at your data…
                    </p>
                )}
                <div ref={endRef} />
            </div>

            <footer className="pm-ask-foot">
                <AskInput
                    onSubmit={(question) => void handleSubmit(question)}
                    disabled={!mounted || limited || pending}
                    showSuggestions={messages.length === 0}
                    suggestions={DEFAULT_SUGGESTIONS}
                    rateLimitMessage={rateLimitMessage}
                />
            </footer>
        </section>
    );
}
