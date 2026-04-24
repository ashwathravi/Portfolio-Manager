/**
 * Pre-trade rationale types (AR-109 / JournalPlus Integration).
 *
 * The "why" capture that sits between order review and submit. Every
 * field is a controlled input in `PreTradeRationale`; the whole shape
 * persists onto `Order.rationale` so downstream surfaces (journal,
 * analytics, weekly review) can read it without a second round-trip.
 *
 * Kept deliberately narrow. No free-form mood tags, no essay-length
 * justification, no auto-populated fields. The friction is the point —
 * we want the user to slow down and articulate intent, not to fill out
 * a form on autopilot. Edits after submit are explicitly out of scope
 * (see AR-109 acceptance) so the captured thought stays honest.
 */

/**
 * Emotional state at the moment of decision. The set is curated:
 * three "ok to trade" states (calm/focused/neutral), three that are
 * historically predictive of worse outcomes (frustrated/fomo/revenge).
 * Keeping the palette small means the user can pick by feel in under a
 * second — wider palettes push this toward a real questionnaire.
 */
export type Mood =
    | 'calm'
    | 'focused'
    | 'neutral'
    | 'frustrated'
    | 'fomo'
    | 'revenge';

/**
 * What kind of trade this is. Used by analytics to slice P&L by setup
 * and by the rules engine to check adherence (AR-111). `other` is an
 * intentional escape hatch — most trades should fit one of the five
 * canonical setups, and a spike in `other` is itself a signal.
 */
export type SetupType =
    | 'conviction_add'
    | 'breakout'
    | 'mean_reversion'
    | 'rebalance'
    | 'dividend_capture'
    | 'other';

/**
 * The captured pre-trade snapshot. Shipped alongside the order on
 * submit; read-only after that.
 *
 * `thesisId` is always a real research-store id. If the user creates a
 * thesis inline from the rationale chip row, the store generates the
 * id synchronously and the rationale is linked to it on the same tick
 * — no temp-id placeholders, no later reconciliation.
 *
 * `conviction` is a float on a 1.0–10.0 scale, step 0.1. A float (not
 * an integer) because users consistently say things like "7.5, not an
 * 8" when asked to self-rate — quantizing to whole numbers throws away
 * that signal.
 *
 * `timeToDecisionMs` is the delta from when `<PreTradeRationale>`
 * rendered to when Submit was pressed. Sub-second values are the
 * interesting tail — they correlate with FOMO trades.
 */
export interface TradeRationale {
    thesisId: string;
    setupType: SetupType;
    conviction: number;
    mood: Mood;
    rationale: string;
    capturedAt: string;
    timeToDecisionMs: number;
}

// --------------------------------------------------------------------- //
// Presentation-layer constants
// --------------------------------------------------------------------- //

/**
 * Display metadata for moods. Emoji ships as part of the label so the
 * chip row reads at a glance — the goal is for the user to pick one
 * without reading the text. Order is deliberate: ok-to-trade states
 * first, caution states last, with a visual break between.
 */
export const MOOD_META: ReadonlyArray<{
    value: Mood;
    emoji: string;
    label: string;
    /** `ok` states are safe, `caution` states trigger the amber pattern in analytics. */
    tone: 'ok' | 'caution';
}> = [
    { value: 'calm',       emoji: '😌', label: 'Calm',       tone: 'ok' },
    { value: 'focused',    emoji: '🎯', label: 'Focused',    tone: 'ok' },
    { value: 'neutral',    emoji: '😐', label: 'Neutral',    tone: 'ok' },
    { value: 'frustrated', emoji: '😤', label: 'Frustrated', tone: 'caution' },
    { value: 'fomo',       emoji: '😱', label: 'FOMO',       tone: 'caution' },
    { value: 'revenge',    emoji: '😡', label: 'Revenge',    tone: 'caution' },
];

/** Display metadata for setups. */
export const SETUP_META: ReadonlyArray<{
    value: SetupType;
    label: string;
    desc: string;
}> = [
    {
        value: 'conviction_add',
        label: 'Conviction add',
        desc: 'Increasing size in an existing thesis',
    },
    {
        value: 'breakout',
        label: 'Breakout',
        desc: 'Price or news breaking a defined level',
    },
    {
        value: 'mean_reversion',
        label: 'Mean reversion',
        desc: 'Fade an overreaction back to fair value',
    },
    {
        value: 'rebalance',
        label: 'Rebalance',
        desc: 'Bringing allocation back toward target',
    },
    {
        value: 'dividend_capture',
        label: 'Dividend capture',
        desc: 'Entry timed around ex-dividend',
    },
    {
        value: 'other',
        label: 'Other',
        desc: 'None of the above fits',
    },
];

/** Upper bound for the free-text `rationale` field. */
export const RATIONALE_MAX_CHARS = 240;

/** Float bounds for the conviction slider. */
export const CONVICTION_MIN = 1.0;
export const CONVICTION_MAX = 10.0;
export const CONVICTION_STEP = 0.1;
export const CONVICTION_DEFAULT = 5.0;

// --------------------------------------------------------------------- //
// Validation
// --------------------------------------------------------------------- //

/**
 * Input shape accepted by `isRationaleComplete`. Deliberately looser
 * than `Partial<TradeRationale>` — the caller commonly holds a draft
 * where `setupType` and `mood` carry empty-string sentinels ("not yet
 * picked") rather than `undefined`. The runtime check handles both.
 */
export interface RationaleDraftLike {
    thesisId?: string;
    setupType?: SetupType | '' | null;
    mood?: Mood | '' | null;
    conviction?: number;
    rationale?: string;
}

/**
 * Returns true if the in-progress rationale has every required field
 * filled in. Used by the Focus variant to gate Submit.
 *
 * We treat a whitespace-only rationale as empty — the UX requires the
 * user to actually articulate something, and `.trim().length > 0`
 * catches accidental padding copy/pastes.
 */
export function isRationaleComplete(draft: RationaleDraftLike | null | undefined): boolean {
    if (!draft) return false;
    if (!draft.thesisId) return false;
    if (!draft.setupType) return false;
    if (!draft.mood) return false;
    if (
        typeof draft.conviction !== 'number' ||
        !Number.isFinite(draft.conviction) ||
        draft.conviction < CONVICTION_MIN ||
        draft.conviction > CONVICTION_MAX
    ) {
        return false;
    }
    if (
        typeof draft.rationale !== 'string' ||
        draft.rationale.trim().length === 0 ||
        draft.rationale.length > RATIONALE_MAX_CHARS
    ) {
        return false;
    }
    return true;
}

// --------------------------------------------------------------------- //
// Journal entries (AR-110)
// --------------------------------------------------------------------- //

/**
 * A closed round-trip trade with its captured rationale. Where
 * `TradeRationale` is the "what was I thinking" snapshot, `JournalEntry`
 * is the "what happened" bookend — realized P&L once the position is
 * unwound, holding period, and the rationale that went in with it.
 *
 * Emitted into the journal at the moment a position closes (the fill
 * that brings quantity back to zero, or a manual close). The rationale
 * is copied in verbatim from the entry order — never reconstructed,
 * never edited after the fact. That immutability is the whole point of
 * JournalPlus: you grade the thesis against what you wrote, not a
 * sanitized retelling.
 *
 * `holdingPeriodDays` is a convenience — it's just
 * `(closedAt - openedAt) / 86_400_000` — but we precompute it so the
 * analytics surfaces don't repeat the arithmetic on every render.
 */
export interface JournalEntry {
    id: string;
    /** Source order id if the trade originated inside the app. Optional
     *  because imported brokerage history won't always carry one. */
    orderId?: string;
    ticker: string;
    side: 'buy' | 'sell';
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    /** Notional USD at entry (quantity × entryPrice). Stored so the
     *  analytics don't need to re-multiply on every aggregation pass. */
    notionalUsd: number;
    /** Realized P&L in USD, net of fees. Positive = win. */
    realizedPnlUsd: number;
    /** Elapsed days between open and close, float. Fractional values
     *  are meaningful (0.04 = ~1 hour); do not round. */
    holdingPeriodDays: number;
    openedAt: string;
    closedAt: string;
    /** The pre-trade snapshot captured at entry. Required on journal
     *  entries — if a trade didn't have a rationale captured, it won't
     *  appear in the journal (the execution flow handles the skipped
     *  case via analytics events, not by synthesizing a placeholder). */
    rationale: TradeRationale;
}
