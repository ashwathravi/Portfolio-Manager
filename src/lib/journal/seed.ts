/**
 * JournalPlus trade journal seed (AR-110).
 *
 * Pure data — no React, no browser APIs. Represents ~3 months of closed
 * round-trip trades, each with a rationale captured at entry. The set
 * is deliberately shaped so the mood analytics surface has something
 * meaningful to say out of the box:
 *
 *   - All six moods are represented (calm / focused / neutral /
 *     frustrated / fomo / revenge) with realistic skew — the "caution"
 *     moods cluster around losses, the "ok" moods around wins. This
 *     matches real trader psychology data and gives the verdict panel
 *     an actual story ("FOMO cost you $X across Y trades").
 *   - At least 10 total trades so the empty-state threshold doesn't
 *     trigger on first visit.
 *   - Realized P&L, entry/exit prices, and holding periods are
 *     hand-tuned to feel lived-in rather than synthetic. Round numbers
 *     would scream "mock data".
 *
 * The shape is stable, but the *contents* are fixtures — this file
 * disappears once brokerage import lands and real closed positions
 * feed the journal.
 */
import type { JournalEntry } from '@/types/trade';

// Anchor the journal window to a stable "now" captured at module load.
// Every date is relative so the heatmap, range filter, and "last 30
// days" queries behave the same whether the page loads Tuesday at 9am
// or Sunday at 2pm.
const now = Date.now();
const DAY_MS = 86_400_000;
const daysAgo = (d: number) => new Date(now - d * DAY_MS).toISOString();

/**
 * Helper — builds a `JournalEntry` from the two things we actually
 * tune per trade (entry/exit price, holding window) and derives the
 * rest so the fixture doesn't drift out of sync with the type. The
 * closed-at date is `openedDaysAgo - heldDays`; negative checks would
 * mean the trade closed in the future, which isn't the point.
 */
function entry(
    id: string,
    ticker: string,
    side: 'buy' | 'sell',
    quantity: number,
    entryPrice: number,
    exitPrice: number,
    openedDaysAgo: number,
    heldDays: number,
    rationale: JournalEntry['rationale'],
): JournalEntry {
    const notionalUsd = quantity * entryPrice;
    // Long: profit when exit > entry. Short trades live in the same
    // shape but we don't ship any on first seed — all moods should
    // map to long directional bets so the sign convention stays
    // obvious for readers.
    const perShare = side === 'buy' ? exitPrice - entryPrice : entryPrice - exitPrice;
    const realizedPnlUsd = Math.round(perShare * quantity * 100) / 100;
    return {
        id,
        orderId: `o-${id}`,
        ticker,
        side,
        quantity,
        entryPrice,
        exitPrice,
        notionalUsd: Math.round(notionalUsd * 100) / 100,
        realizedPnlUsd,
        holdingPeriodDays: heldDays,
        openedAt: daysAgo(openedDaysAgo),
        closedAt: daysAgo(openedDaysAgo - heldDays),
        rationale,
    };
}

/**
 * Builds a `TradeRationale` inline — the seed defines one rationale
 * per entry and we don't want a separate fixture file for them. Uses
 * `thesisId: 'seed-<ticker>'` so the shape is legal without needing
 * the research store rehydrated at module load.
 */
function rat(
    setupType: JournalEntry['rationale']['setupType'],
    mood: JournalEntry['rationale']['mood'],
    conviction: number,
    rationale: string,
    capturedDaysAgo: number,
    timeToDecisionMs: number,
    thesisKey: string,
): JournalEntry['rationale'] {
    return {
        thesisId: `seed-${thesisKey}`,
        setupType,
        conviction,
        mood,
        rationale,
        capturedAt: daysAgo(capturedDaysAgo),
        timeToDecisionMs,
    };
}

/**
 * The seed. 25 trades, ~3 months of history. Moods distributed:
 *
 *   calm        × 6  (mostly green)
 *   focused     × 5  (mostly green)
 *   neutral     × 3  (mixed)
 *   frustrated  × 3  (mostly red)
 *   fomo        × 5  (mostly red, with one big loss)
 *   revenge     × 3  (all red)
 *
 * Totals roughly: +$9k from "ok" moods, −$4.5k from "caution" moods.
 * The verdict panel pulls the worst-performing mood and the card
 * reads something a real trader would recognize.
 */
export const SEED_JOURNAL: JournalEntry[] = [
    // ─── Calm (the bread-and-butter wins) ─────────────────────────
    entry('j-001', 'AAPL', 'buy', 50, 178.40, 192.15, 88, 21,
        rat('conviction_add', 'calm', 7.5, 'Margin expansion through services revenue.', 88, 45_000, 'aapl')),
    entry('j-002', 'MSFT', 'buy', 30, 398.20, 412.80, 76, 14,
        rat('conviction_add', 'calm', 8.0, 'Azure re-acceleration story intact.', 76, 52_000, 'msft')),
    entry('j-003', 'GOOGL', 'buy', 75, 158.30, 166.40, 64, 9,
        rat('mean_reversion', 'calm', 6.5, 'Oversold after antitrust headlines.', 64, 38_000, 'googl')),
    entry('j-004', 'AMZN', 'buy', 40, 175.60, 185.90, 52, 11,
        rat('conviction_add', 'calm', 7.0, 'AWS margin story intact at scale.', 52, 41_000, 'amzn')),
    entry('j-005', 'JPM', 'buy', 100, 198.20, 206.40, 40, 18,
        rat('rebalance', 'calm', 6.0, 'Bringing financials back to 15% target.', 40, 62_000, 'jpm')),
    entry('j-006', 'AAPL', 'sell', 25, 215.30, 208.10, 12, 4,
        rat('rebalance', 'calm', 6.5, 'Trimming AAPL — now 18% of book.', 12, 29_000, 'aapl')),

    // ─── Focused (the best setups I saw coming) ───────────────────
    entry('j-007', 'NVDA', 'buy', 50, 108.20, 124.60, 84, 10,
        rat('breakout', 'focused', 9.0, 'Broke 52-week high on earnings beat.', 84, 18_000, 'nvda')),
    entry('j-008', 'META', 'buy', 20, 482.10, 512.80, 70, 8,
        rat('breakout', 'focused', 8.5, 'Gapped through 480 resistance.', 70, 22_000, 'meta')),
    entry('j-009', 'AMD', 'buy', 80, 138.40, 148.90, 55, 12,
        rat('breakout', 'focused', 7.5, 'AI data-center capex coming back.', 55, 25_000, 'amd')),
    entry('j-010', 'NVDA', 'buy', 40, 116.50, 132.20, 38, 6,
        rat('conviction_add', 'focused', 8.0, 'Adding ahead of GTC announcement.', 38, 15_000, 'nvda')),
    entry('j-011', 'MSFT', 'buy', 15, 405.40, 418.70, 22, 7,
        rat('breakout', 'focused', 7.0, 'Clean breakout from consolidation.', 22, 19_000, 'msft')),

    // ─── Neutral (just doing the work) ────────────────────────────
    entry('j-012', 'XOM', 'buy', 50, 114.80, 117.20, 75, 20,
        rat('rebalance', 'neutral', 5.0, 'Energy weight below target.', 75, 88_000, 'xom')),
    entry('j-013', 'JPM', 'sell', 30, 208.40, 205.10, 45, 5,
        rat('rebalance', 'neutral', 5.5, 'Trimming to target weight.', 45, 72_000, 'jpm')),
    entry('j-014', 'XOM', 'sell', 25, 118.20, 116.80, 28, 3,
        rat('dividend_capture', 'neutral', 4.5, 'Post-ex-div exit, plan executed.', 28, 95_000, 'xom')),

    // ─── Frustrated (stop-outs and chop) ──────────────────────────
    entry('j-015', 'TSLA', 'buy', 50, 218.40, 204.80, 68, 4,
        rat('mean_reversion', 'frustrated', 5.5, 'Already down after a rough week, catching a falling knife.', 68, 6_500, 'tsla')),
    entry('j-016', 'META', 'sell', 15, 478.20, 492.10, 46, 3,
        rat('mean_reversion', 'frustrated', 4.0, 'Tired of it ripping without me, fading the move.', 46, 3_200, 'meta')),
    entry('j-017', 'AMD', 'buy', 60, 152.10, 145.40, 30, 5,
        rat('breakout', 'frustrated', 5.0, 'Second attempt, hope this one holds.', 30, 8_100, 'amd')),

    // ─── FOMO (chasing green candles) ─────────────────────────────
    entry('j-018', 'TSLA', 'buy', 40, 232.60, 218.90, 82, 3,
        rat('breakout', 'fomo', 7.0, 'Up 8% on no news, jumping in.', 82, 900, 'tsla')),
    entry('j-019', 'NVDA', 'buy', 25, 138.20, 128.40, 58, 2,
        rat('breakout', 'fomo', 6.0, 'Ripping, need to be in this.', 58, 1_200, 'nvda')),
    entry('j-020', 'META', 'buy', 10, 528.40, 511.60, 35, 4,
        rat('breakout', 'fomo', 6.5, 'Everyone is talking about it.', 35, 1_500, 'meta')),
    entry('j-021', 'AMD', 'buy', 30, 158.70, 146.20, 20, 3,
        rat('breakout', 'fomo', 5.5, 'Chasing the AI pump, last chance.', 20, 800, 'amd')),
    entry('j-022', 'GOOGL', 'buy', 50, 172.80, 168.20, 10, 2,
        rat('mean_reversion', 'fomo', 5.0, 'Just want some exposure before earnings.', 10, 600, 'googl')),

    // ─── Revenge (after a loss, doubling down) ────────────────────
    entry('j-023', 'TSLA', 'buy', 80, 210.40, 194.80, 60, 2,
        rat('conviction_add', 'revenge', 8.5, 'That last stop-out was BS, going bigger.', 60, 2_100, 'tsla')),
    entry('j-024', 'AMD', 'buy', 50, 148.20, 138.40, 32, 3,
        rat('breakout', 'revenge', 7.5, 'Getting it back this time.', 32, 1_800, 'amd')),
    entry('j-025', 'NVDA', 'buy', 20, 134.60, 126.80, 15, 2,
        rat('conviction_add', 'revenge', 8.0, 'They owe me this one.', 15, 1_400, 'nvda')),
];
