"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
    CONVICTION_DEFAULT,
    CONVICTION_MAX,
    CONVICTION_MIN,
    CONVICTION_STEP,
    MOOD_META,
    RATIONALE_MAX_CHARS,
    SETUP_META,
    type Mood,
    type SetupType,
    type TradeRationale,
} from "@/types/trade";
import { useThesisStore } from "@/lib/research/useThesisStore";

/**
 * Pre-trade rationale panel (AR-109).
 *
 * Sits between the order review and the Submit button on the Focus
 * variant. Captures:
 *
 *   1. Thesis      — active thesis linkage (inline-create supported)
 *   2. Setup       — conviction_add / breakout / mean_reversion / …
 *   3. Conviction  — 1.0–10.0 slider, step 0.1, default 5.0
 *   4. Mood        — calm / focused / neutral / frustrated / fomo / revenge
 *   5. Rationale   — 240-char free-text box with live counter
 *
 * Fully controlled — the Focus variant owns the `draft` and gates the
 * Submit button on `isRationaleComplete`. This component is
 * deliberately unaware of the settings store: if the user has turned
 * the capture off, the parent simply doesn't render us. That keeps the
 * render path predictable and the test matrix shallow.
 *
 * A11y notes:
 *   - Chip groups use `<button aria-pressed>` rather than
 *     `role="radio"`. `radio` advertises arrow-key navigation the chip
 *     list doesn't implement (no roving tabindex), so a screen-reader
 *     user would try Up/Down arrows and get nothing. `aria-pressed`
 *     matches real behavior: a toggle list where Tab moves between
 *     options and Space/Enter activates.
 *   - The conviction slider is a native `<input type="range">` so
 *     keyboard users get arrow-key nudges for free.
 *   - The char counter lives in an `aria-live="polite"` region so it
 *     doesn't spam announcements every keystroke, but updates are
 *     still reachable.
 */

export interface RationaleDraft {
    thesisId: string;
    setupType: SetupType | '';
    conviction: number;
    mood: Mood | '';
    rationale: string;
    /** ISO timestamp when the panel first rendered for this order.
     *  Owned by the panel (set on mount). Parent reads it to compute
     *  `timeToDecisionMs` at submit. */
    capturedAt: string;
}

export interface PreTradeRationaleProps {
    /** The order's ticker — used to pre-filter the thesis picker so
     *  the user usually only needs one click. */
    ticker: string;
    /** Controlled draft state owned by the parent. */
    value: RationaleDraft;
    onChange: (next: RationaleDraft) => void;
}

/**
 * Factory used by the parent to initialize a fresh draft. Sets
 * `capturedAt` to the current wall-clock and seeds conviction to the
 * UX default so the slider has a position from render one.
 */
export function createRationaleDraft(): RationaleDraft {
    return {
        thesisId: '',
        setupType: '',
        conviction: CONVICTION_DEFAULT,
        mood: '',
        rationale: '',
        capturedAt: new Date().toISOString(),
    };
}

/**
 * Finalize a complete draft into a `TradeRationale`. Throws if the
 * draft is missing any required field — callers should always guard
 * with `isRationaleComplete` from `@/types/trade` first. Defense in
 * depth: even with the gate in place, we don't want to ship a trade
 * tagged to an empty thesis if a future refactor moves the check.
 */
export function finalizeRationale(draft: RationaleDraft): TradeRationale {
    if (!draft.thesisId || !draft.setupType || !draft.mood) {
        throw new Error('finalizeRationale called on incomplete draft');
    }
    return {
        thesisId: draft.thesisId,
        setupType: draft.setupType,
        conviction: draft.conviction,
        mood: draft.mood,
        rationale: draft.rationale.trim(),
        capturedAt: draft.capturedAt,
        timeToDecisionMs: Date.now() - Date.parse(draft.capturedAt),
    };
}

// --------------------------------------------------------------------- //
// Component
// --------------------------------------------------------------------- //

export function PreTradeRationale({ ticker, value, onChange }: PreTradeRationaleProps) {
    const { active: activeTheses, create: createThesisInStore, hydrated } = useThesisStore();

    // Inline thesis creator state. When the user clicks "Create thesis
    // for TICKER" we flip into a micro-form right inside the chip row
    // rather than opening a modal — keeps the execution flow visible.
    const [inlineOpen, setInlineOpen] = useState(false);
    const [inlineTitle, setInlineTitle] = useState('');

    const groupId = useId();

    const tickerUpper = ticker.toUpperCase();

    // Preferred thesis set: those matching the current ticker first,
    // then any other actives. Exposed sorted so the ticker's own
    // thesis is always at the front. Memoized so click handlers don't
    // trigger re-sorting — active theses change rarely.
    const orderedTheses = useMemo(() => {
        const matches: typeof activeTheses = [];
        const others: typeof activeTheses = [];
        for (const t of activeTheses) {
            if (t.ticker.toUpperCase() === tickerUpper) matches.push(t);
            else others.push(t);
        }
        return [...matches, ...others];
    }, [activeTheses, tickerUpper]);

    // If the user switches tickers after picking a thesis, clear the
    // link so they don't accidentally ship a trade on AAPL tagged to
    // an MSFT thesis. Deps are narrowed to the thesis id + the sorted
    // list — re-running on every keystroke in the rationale textarea
    // would be wasted work. `onChange` is expected to be stable from
    // the parent (FocusVariant hands us its state setter directly).
    useEffect(() => {
        if (!value.thesisId) return;
        const stillValid = orderedTheses.some((t) => t.id === value.thesisId);
        if (!stillValid) {
            onChange({ ...value, thesisId: '' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderedTheses, value.thesisId]);

    const handleInlineCreate = () => {
        const title = inlineTitle.trim();
        if (!title) return;
        // Create the thesis in the research store and immediately link
        // the rationale to the real id the store returns. No temp-id
        // round-trip — `createThesisInStore` synchronously produces the
        // final id, so the audit trail is a live pointer from turn one.
        const newId = createThesisInStore({
            ticker: tickerUpper,
            companyName: tickerUpper,
            title,
            description: title,
            type: 'bull',
            conviction: 'MEDIUM',
            targetPrice: 0,
            timeHorizon: '6mo',
        });
        onChange({ ...value, thesisId: newId });
        setInlineTitle('');
        setInlineOpen(false);
    };

    const charCount = value.rationale.length;
    const overMax = charCount > RATIONALE_MAX_CHARS;

    return (
        <section
            className="pm-rat"
            aria-labelledby={`${groupId}-head`}
            data-testid="pre-trade-rationale"
        >
            <header className="pm-rat-head">
                <h3 id={`${groupId}-head`} className="pm-rat-title">
                    Why this trade?
                </h3>
                <p className="pm-rat-sub">
                    Tell future-you in one breath. No edits after submit.
                </p>
            </header>

            {/* ---- Thesis ---- */}
            <div
                className="pm-rat-field"
                role="group"
                aria-label="Thesis linkage"
            >
                <div className="pm-rat-label">Thesis</div>
                <div className="pm-rat-chips">
                    {!hydrated && (
                        <span className="pm-rat-empty">Loading theses…</span>
                    )}
                    {hydrated && orderedTheses.length === 0 && !inlineOpen && (
                        <span className="pm-rat-empty">
                            No active theses. Create one to continue.
                        </span>
                    )}
                    {orderedTheses.map((t) => {
                        const selected = value.thesisId === t.id;
                        const matches = t.ticker.toUpperCase() === tickerUpper;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                aria-pressed={selected}
                                className={`pm-rat-chip${selected ? ' is-on' : ''}${matches ? ' is-match' : ''}`}
                                onClick={() => onChange({ ...value, thesisId: t.id })}
                            >
                                <span className="pm-rat-chip-ticker">{t.ticker}</span>
                                <span className="pm-rat-chip-title">{t.title}</span>
                            </button>
                        );
                    })}
                    {!inlineOpen && (
                        <button
                            type="button"
                            className="pm-rat-chip pm-rat-chip-add"
                            onClick={() => setInlineOpen(true)}
                        >
                            + New thesis for {tickerUpper}
                        </button>
                    )}
                </div>
                {inlineOpen && (
                    <div className="pm-rat-inline" role="group" aria-label="Create new thesis">
                        <input
                            type="text"
                            className="pm-rat-inline-input"
                            placeholder={`Why buy ${tickerUpper}? (e.g. "Margin expansion 2026")`}
                            value={inlineTitle}
                            onChange={(e) => setInlineTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleInlineCreate();
                                } else if (e.key === 'Escape') {
                                    setInlineOpen(false);
                                    setInlineTitle('');
                                }
                            }}
                            autoFocus
                            maxLength={120}
                        />
                        <button
                            type="button"
                            className="pm-btn pm-btn-primary pm-rat-inline-save"
                            onClick={handleInlineCreate}
                            disabled={!inlineTitle.trim()}
                        >
                            Create
                        </button>
                        <button
                            type="button"
                            className="pm-btn pm-btn-ghost pm-rat-inline-cancel"
                            onClick={() => {
                                setInlineOpen(false);
                                setInlineTitle('');
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            {/* ---- Setup ---- */}
            <div
                className="pm-rat-field"
                role="group"
                aria-label="Trade setup"
            >
                <div className="pm-rat-label">Setup</div>
                <div className="pm-rat-chips">
                    {SETUP_META.map((s) => {
                        const selected = value.setupType === s.value;
                        return (
                            <button
                                key={s.value}
                                type="button"
                                aria-pressed={selected}
                                title={s.desc}
                                className={`pm-rat-chip${selected ? ' is-on' : ''}`}
                                onClick={() => onChange({ ...value, setupType: s.value })}
                            >
                                {s.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ---- Conviction ---- */}
            <div className="pm-rat-field">
                <div className="pm-rat-label pm-rat-label-row">
                    <span>Conviction</span>
                    <span className="pm-rat-conv-value num">
                        {value.conviction.toFixed(1)}
                        <span className="pm-rat-conv-scale">/10</span>
                    </span>
                </div>
                <input
                    type="range"
                    className="pm-rat-slider"
                    min={CONVICTION_MIN}
                    max={CONVICTION_MAX}
                    step={CONVICTION_STEP}
                    value={value.conviction}
                    aria-label="Conviction (1 to 10)"
                    aria-valuemin={CONVICTION_MIN}
                    aria-valuemax={CONVICTION_MAX}
                    aria-valuenow={value.conviction}
                    onChange={(e) =>
                        onChange({ ...value, conviction: Number(e.target.value) })
                    }
                />
                <div className="pm-rat-slider-marks" aria-hidden="true">
                    <span>1</span>
                    <span>5</span>
                    <span>10</span>
                </div>
            </div>

            {/* ---- Mood ---- */}
            <div
                className="pm-rat-field"
                role="group"
                aria-label="Emotional state"
            >
                <div className="pm-rat-label">Mood</div>
                <div className="pm-rat-chips pm-rat-chips-mood">
                    {MOOD_META.map((m) => {
                        const selected = value.mood === m.value;
                        return (
                            <button
                                key={m.value}
                                type="button"
                                aria-pressed={selected}
                                data-mood={m.value}
                                data-tone={m.tone}
                                className={`pm-rat-chip pm-rat-chip-mood${selected ? ' is-on' : ''}`}
                                onClick={() => onChange({ ...value, mood: m.value })}
                            >
                                <span aria-hidden="true" className="pm-rat-chip-emoji">
                                    {m.emoji}
                                </span>
                                <span className="pm-rat-chip-mood-label">{m.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ---- Rationale text ---- */}
            <div className="pm-rat-field">
                <label className="pm-rat-label" htmlFor={`${groupId}-why`}>
                    Rationale
                </label>
                <textarea
                    id={`${groupId}-why`}
                    className={`pm-rat-textarea${overMax ? ' is-over' : ''}`}
                    value={value.rationale}
                    onChange={(e) =>
                        onChange({ ...value, rationale: e.target.value })
                    }
                    placeholder="One breath. What specifically is the edge right now?"
                    rows={2}
                    maxLength={RATIONALE_MAX_CHARS + 20 /* let them overshoot; we gate submit */}
                />
                <div
                    className={`pm-rat-counter${overMax ? ' is-over' : ''}`}
                    aria-live="polite"
                >
                    {charCount} / {RATIONALE_MAX_CHARS}
                </div>
            </div>
        </section>
    );
}
