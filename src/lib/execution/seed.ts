/**
 * Seed orders for the Phase 7 Execution surface (AR-84/85/86).
 *
 * Pure data — no React, no browser APIs. All three variants render from
 * the same seed so switching between Focus / Checkout / Terminal doesn't
 * surprise the user with a different row set.
 *
 * The orders intentionally cover all four statuses (working, filled,
 * rejected, cancelled) and both sides (buy / sell) so the status pills,
 * filter chips, and approval queue all have something to render on
 * first paint.
 */
import type { Order } from '@/types/execution';

// Live price hints for the ticker autocomplete — same numbers as the
// market data fixtures the rest of the app uses. Static snapshot for the
// mock layer; when the Execution surface wires up to the live quotes
// stream this will move to a hook.
export const LIVE_PRICES: Record<string, number> = {
    AAPL: 228.41,
    MSFT: 412.85,
    NVDA: 116.32,
    TSLA: 201.74,
    GOOGL: 172.06,
    AMZN: 189.25,
    META: 503.18,
    AMD: 145.64,
    JPM: 209.11,
    XOM: 117.43,
};

export const BUYING_POWER_USD = 48_250.0;
export const COMMISSION_PER_TRADE_USD = 0.0; // Commission-free broker
export const COMMISSION_PER_SHARE_USD = 0.0;

// `now` is captured at module load. The orders pretend to have been placed
// across the last 6 hours so the blotter looks lived-in without anything
// actually happening.
const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60 * 1000);

export const SEED_ORDERS: Order[] = [
    {
        id: 'o-1001',
        portfolioId: 'p-growth',
        ticker: 'TSLA',
        side: 'buy',
        type: 'limit',
        quantity: 50,
        limitPrice: 200.5,
        status: 'working',
        filledQuantity: 0,
        timeInForce: 'day',
        placedAt: minsAgo(12),
        updatedAt: minsAgo(12),
    },
    {
        id: 'o-1002',
        portfolioId: 'p-growth',
        ticker: 'AAPL',
        side: 'sell',
        type: 'stop',
        quantity: 100,
        stopPrice: 220.0,
        status: 'working',
        filledQuantity: 0,
        timeInForce: 'gtc',
        placedAt: minsAgo(45),
        updatedAt: minsAgo(45),
    },
    {
        id: 'o-1003',
        portfolioId: 'p-growth',
        ticker: 'NVDA',
        side: 'buy',
        type: 'limit',
        quantity: 300,
        limitPrice: 118.0,
        status: 'working',
        filledQuantity: 0,
        timeInForce: 'day',
        placedAt: minsAgo(4),
        updatedAt: minsAgo(4),
    },
    {
        id: 'o-1004',
        portfolioId: 'p-growth',
        ticker: 'MSFT',
        side: 'buy',
        type: 'market',
        quantity: 25,
        status: 'filled',
        filledQuantity: 25,
        averageFillPrice: 412.6,
        timeInForce: 'ioc',
        placedAt: minsAgo(180),
        updatedAt: minsAgo(180),
    },
    {
        id: 'o-1005',
        portfolioId: 'p-growth',
        ticker: 'GOOGL',
        side: 'buy',
        type: 'limit',
        quantity: 40,
        limitPrice: 170.0,
        status: 'filled',
        filledQuantity: 40,
        averageFillPrice: 169.88,
        timeInForce: 'day',
        placedAt: minsAgo(220),
        updatedAt: minsAgo(220),
    },
    {
        id: 'o-1006',
        portfolioId: 'p-growth',
        ticker: 'META',
        side: 'sell',
        type: 'limit',
        quantity: 20,
        limitPrice: 540.0,
        status: 'rejected',
        filledQuantity: 0,
        timeInForce: 'day',
        placedAt: minsAgo(330),
        updatedAt: minsAgo(330),
    },
];

/**
 * Held-position snapshot used by the "Position after" preview row. Just
 * a frozen lookup so submitting a buy order against AAPL shows the
 * right delta. When the live portfolio store wires in, this is what
 * gets replaced.
 */
export const CURRENT_POSITIONS: Record<string, { qty: number; avgCost: number }> = {
    AAPL: { qty: 125, avgCost: 201.45 },
    MSFT: { qty: 65, avgCost: 385.1 },
    NVDA: { qty: 180, avgCost: 104.85 },
    GOOGL: { qty: 40, avgCost: 169.88 },
    JPM: { qty: 200, avgCost: 195.12 },
};

// Note: the approval threshold used to live here as a constant. It now
// comes from `useSettingsStore.guardrails.approvalThresholdUsd` (AR-89)
// so the user can tune it from Settings › Guardrails. The default
// (25_000) is preserved in `defaultGuardrails` in settingsStore.ts.
