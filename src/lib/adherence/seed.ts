/**
 * Seed adherence rules per strategy (AR-111).
 *
 * Each of the three seed strategies gets a small, sensible rule set.
 * The sets intentionally differ so the Strategies builder shows
 * something useful for every strategy the user clicks, and the
 * journal freeze produces a mix of passing and failing results for
 * the returns-comparison card.
 *
 * Keyed by `Strategy.id` from `src/lib/strategies/seed.ts`. Strategies
 * that don't exist in this map get an empty rule set — the editor
 * still lets the user add rules, and the live evaluator treats
 * empty = `100/100`.
 */

import type { AdherenceRule } from './rules';

export const SEED_ADHERENCE_RULES: Record<string, AdherenceRule[]> = {
    'strategy-momentum-value': [
        {
            id: 'ar-mv-pos',
            type: 'max_position_pct',
            params: { pct: 5 },
            severity: 'hard',
        },
        {
            id: 'ar-mv-stop',
            type: 'stop_loss_required',
            params: {},
            severity: 'soft',
        },
        {
            id: 'ar-mv-thesis',
            type: 'thesis_required',
            params: {},
            severity: 'hard',
        },
        {
            id: 'ar-mv-conv',
            type: 'min_conviction',
            params: { value: 6 },
            severity: 'soft',
        },
        {
            id: 'ar-mv-hours',
            type: 'allowed_hours',
            params: { fromHour: 9, toHour: 16 },
            severity: 'soft',
        },
    ],
    'strategy-mean-reversion': [
        {
            id: 'ar-mr-pos',
            type: 'max_position_pct',
            params: { pct: 3 },
            severity: 'hard',
        },
        {
            id: 'ar-mr-stop',
            type: 'stop_loss_required',
            params: {},
            severity: 'hard',
        },
        {
            id: 'ar-mr-earn',
            type: 'no_trade_near_earnings',
            params: { days: 3 },
            severity: 'soft',
        },
        {
            id: 'ar-mr-thesis',
            type: 'thesis_required',
            params: {},
            severity: 'soft',
        },
    ],
    'strategy-sector-rotation': [
        {
            id: 'ar-sr-pos',
            type: 'max_position_pct',
            params: { pct: 8 },
            severity: 'soft',
        },
        {
            id: 'ar-sr-tech',
            type: 'max_sector_pct',
            params: { sector: 'Technology', pct: 35 },
            severity: 'hard',
        },
        {
            id: 'ar-sr-fin',
            type: 'max_sector_pct',
            params: { sector: 'Financials', pct: 25 },
            severity: 'soft',
        },
        {
            id: 'ar-sr-thesis',
            type: 'thesis_required',
            params: {},
            severity: 'soft',
        },
        {
            id: 'ar-sr-conv',
            type: 'min_conviction',
            params: { value: 5 },
            severity: 'soft',
        },
    ],
};

/**
 * Sector lookup for the seed journal tickers. The seed strategies
 * reference "Technology" and "Financials" as sector caps; this map
 * lets the freeze step classify each seeded trade so the `max_sector_pct`
 * rule produces real pass/fail results. Matches the ticker universe in
 * `src/lib/journal/seed.ts`.
 *
 * Unknown tickers fall through to `null` (skipped by the evaluator).
 */
export const SEED_SECTOR_BY_TICKER: Record<string, string> = {
    AAPL: 'Technology',
    MSFT: 'Technology',
    GOOGL: 'Technology',
    AMZN: 'Consumer Discretionary',
    NVDA: 'Technology',
    META: 'Technology',
    AMD: 'Technology',
    TSLA: 'Consumer Discretionary',
    SMCI: 'Technology',
    PLTR: 'Technology',
    COIN: 'Financials',
    GME: 'Consumer Discretionary',
    AMC: 'Communication Services',
    MARA: 'Financials',
    RIOT: 'Financials',
    JPM: 'Financials',
    BAC: 'Financials',
    WFC: 'Financials',
    XOM: 'Energy',
    CVX: 'Energy',
    JNJ: 'Health Care',
    PFE: 'Health Care',
    KO: 'Consumer Staples',
    WMT: 'Consumer Staples',
    COST: 'Consumer Staples',
};

/** Default thesisId → strategy id mapping for the seed journal. Used
 *  by the freeze step to route an entry to the right rule set. Seeded
 *  thesis ids like `seed-nvda` live on `j-007`'s rationale; we assign
 *  them to strategies on a round-robin basis so all three strategies
 *  see some journal activity. */
export const SEED_THESIS_TO_STRATEGY: Record<string, string> = {
    'seed-aapl': 'strategy-momentum-value',
    'seed-msft': 'strategy-momentum-value',
    'seed-googl': 'strategy-mean-reversion',
    'seed-amzn': 'strategy-momentum-value',
    'seed-jpm': 'strategy-sector-rotation',
    'seed-nvda': 'strategy-momentum-value',
    'seed-meta': 'strategy-momentum-value',
    'seed-amd': 'strategy-momentum-value',
    'seed-tsla': 'strategy-mean-reversion',
    'seed-smci': 'strategy-momentum-value',
    'seed-plr': 'strategy-mean-reversion',
    'seed-coin': 'strategy-sector-rotation',
    'seed-gme': 'strategy-mean-reversion',
    'seed-amc': 'strategy-mean-reversion',
    'seed-mara': 'strategy-sector-rotation',
    'seed-riot': 'strategy-sector-rotation',
    'seed-bac': 'strategy-sector-rotation',
    'seed-wfc': 'strategy-sector-rotation',
    'seed-xom': 'strategy-sector-rotation',
    'seed-cvx': 'strategy-sector-rotation',
    'seed-jnj': 'strategy-mean-reversion',
    'seed-pfe': 'strategy-mean-reversion',
    'seed-ko': 'strategy-sector-rotation',
    'seed-wmt': 'strategy-sector-rotation',
    'seed-cost': 'strategy-sector-rotation',
};
