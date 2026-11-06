import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { NO_USER_OVERLAP, type AlphaRadarUserOverlap } from '@/lib/alpha-radar/user-overlap';

import {
    DEFAULT_ALERT_PREFERENCES,
    MAX_CHANGES_PER_RULE,
    observeAccounts,
    planAlertFirings,
    type AlertableChange,
    type AlertPlanInput,
    type AlertPreferences,
    type PlannedRule,
} from './nightly-plan';

const SESSION = '2026-11-02';
const RULE_MADE = new Date('2026-10-01T00:00:00Z');

function rule(overrides: Partial<PlannedRule> = {}): PlannedRule {
    return {
        id: 'r-1',
        userId: 'u-1',
        name: 'AAPL above $200',
        metric: 'price',
        symbol: 'AAPL',
        comparator: 'gte',
        threshold: 200,
        rearm: 'daily',
        createdAt: RULE_MADE,
        lastTriggeredAt: null,
        ...overrides,
    };
}

/** What a user holds, watches and has an active thesis on, by ticker and with each company's names. */
function overlapOf(partial: Partial<Record<keyof AlphaRadarUserOverlap, readonly (string | [string, ...string[]])[]>>): AlphaRadarUserOverlap {
    const securities = (list: readonly (string | [string, ...string[]])[] = []) =>
        list.map((item) => (typeof item === 'string' ? { ticker: item, names: [] } : { ticker: item[0], names: item.slice(1) }));
    return { ...NO_USER_OVERLAP, portfolio: securities(partial.portfolio), watchlist: securities(partial.watchlist), thesis: securities(partial.thesis) };
}

function plan(overrides: Partial<AlertPlanInput>) {
    return planAlertFirings({
        rules: [],
        session: SESSION,
        closes: new Map([
            ['AAPL', [{ date: SESSION, close: 210 }, { date: '2026-10-30', close: 200 }]],
            ['MSFT', [{ date: '2026-10-30', close: 400 }, { date: '2026-10-29', close: 390 }]],
            ['KO', [{ date: '2026-10-01', close: 60 }]],
        ]),
        accounts: new Map(),
        overlap: new Map(),
        changes: [],
        preferences: new Map(),
        alphaRadarSince: null,
        notified: new Map(),
        runDate: '2026-11-02',
        ...overrides,
    });
}

describe('planAlertFirings: closes (launch item i57)', () => {
    test('a price rule fires on the session\'s close, once that session', () => {
        const [firing, ...rest] = plan({ rules: [rule()] });
        assert.equal(rest.length, 0);
        assert.deepEqual(firing, {
            ruleId: 'r-1',
            userId: 'u-1',
            occurrence: 'session:2026-11-02',
            ruleName: 'AAPL above $200',
            metric: 'price',
            symbol: 'AAPL',
            comparator: 'gte',
            threshold: 200,
            observedValue: 210,
            message: 'AAPL closed at $210.00 on Nov 2, at or above $200.00.',
            href: '/portfolios/detail/AAPL',
        });
    });

    test('a session the rule already raised (a rerun, or a market holiday) raises nothing more', () => {
        const notified = new Map([['r-1', new Set(['session:2026-11-02'])]]);
        assert.deepEqual(plan({ rules: [rule()], notified }), []);
        assert.equal(plan({ rules: [rule()], notified: new Map([['r-1', new Set(['session:2026-10-30'])]]) }).length, 1);
    });

    test('nothing fires when the condition doesn\'t hold', () => {
        assert.deepEqual(plan({ rules: [rule({ threshold: 211 }), rule({ id: 'r-2', comparator: 'lt', threshold: 210 })] }), []);
        assert.equal(plan({ rules: [rule({ comparator: 'eq', threshold: 210 })] }).length, 1);
    });

    test('a symbol without a close for the session raises nothing, so a stale close never repeats', () => {
        assert.deepEqual(plan({ rules: [rule({ symbol: 'MSFT', threshold: 1 })] }), []);
        assert.deepEqual(plan({ rules: [rule({ symbol: 'NOPE', threshold: 0 })] }), []);
        assert.deepEqual(plan({ rules: [rule()], session: null }), []);
    });

    test('a daily-change rule compares the session\'s close with the one before', () => {
        const [firing] = plan({ rules: [rule({ metric: 'price_change_pct', comparator: 'gte', threshold: 0.05, name: 'AAPL up 5%' })] });
        assert.equal(firing.observedValue, 0.05);
        assert.equal(firing.message, 'AAPL moved +5.00% on Nov 2, at or above +5.00%.');
        assert.deepEqual(plan({ rules: [rule({ metric: 'price_change_pct', threshold: 0.051 })] }), []);
        // MSFT's last move was an earlier session's: not tonight's news.
        assert.deepEqual(plan({ rules: [rule({ metric: 'price_change_pct', symbol: 'MSFT', comparator: 'gt', threshold: -1 })] }), []);
    });

    test('a fall reads with a minus sign', () => {
        const closes = new Map([['AAPL', [{ date: SESSION, close: 190 }, { date: '2026-10-30', close: 200 }]]]);
        const [firing] = plan({ closes, rules: [rule({ metric: 'price_change_pct', comparator: 'lte', threshold: -0.02 })] });
        assert.equal(firing.message, 'AAPL moved −5.00% on Nov 2, at or below −2.00%.');
    });
});

describe('planAlertFirings: your accounts', () => {
    const accounts = new Map([['u-1', {
        cash: 1000,
        positions: [
            { symbol: 'AAPL', quantity: 10, avgCost: 150 }, // 10 × 210 today, 10 × 200 before
            { symbol: 'MSFT', quantity: 2, avgCost: 300 }, // 2 × 400, an earlier close within the week
            { symbol: 'KO', quantity: 5, avgCost: 50 }, // a month-old close: at cost
            { symbol: 'PRIV', quantity: 1, avgCost: 70 }, // never priced: at cost
        ],
    }]]);

    test('values cash and holdings at their latest close, at cost without one in the last week', () => {
        const observed = observeAccounts(accounts.get('u-1')!, new Map([
            ['AAPL', [{ date: SESSION, close: 210 }, { date: '2026-10-30', close: 200 }]],
            ['MSFT', [{ date: '2026-10-30', close: 400 }]],
            ['KO', [{ date: '2026-10-01', close: 60 }]],
        ]), SESSION);
        assert.equal(observed.value, 1000 + 2100 + 800 + 250 + 70);
        assert.equal(observed.dayChangePct, Math.round((100 / 4120) * 1e6) / 1e6);
    });

    test('an accounts-value rule fires on that value', () => {
        const [firing] = plan({ accounts, rules: [rule({ metric: 'portfolio_value', symbol: null, comparator: 'gte', threshold: 4000, name: 'Over $4k' })] });
        assert.equal(firing.observedValue, 4220);
        assert.equal(firing.message, 'Your accounts were worth $4,220.00 at the Nov 2 close, at or above $4,000.00.');
        assert.equal(firing.href, '/portfolios/holdings');
        assert.equal(firing.occurrence, 'session:2026-11-02');
    });

    test('a day-change rule fires on the holdings priced that session', () => {
        const [firing] = plan({ accounts, rules: [rule({ metric: 'portfolio_day_change_pct', symbol: null, comparator: 'gt', threshold: 0.02 })] });
        assert.equal(firing.observedValue, 0.024272);
        assert.match(firing.message, /^Your accounts moved \+2\.43% on Nov 2, above \+2\.00%\.$/);
    });

    test('a day with nothing priced has no day change, and a user without accounts has no value', () => {
        const quiet = new Map([['u-1', { cash: 500, positions: [{ symbol: 'MSFT', quantity: 1, avgCost: 1 }] }]]);
        assert.deepEqual(plan({ accounts: quiet, rules: [rule({ metric: 'portfolio_day_change_pct', symbol: null, comparator: 'gte', threshold: -1 })] }), []);
        assert.deepEqual(plan({ rules: [rule({ metric: 'portfolio_value', symbol: null, comparator: 'gte', threshold: 0 })] }), []);
    });
});

describe('planAlertFirings: Alpha Radar', () => {
    const change = (overrides: Partial<AlertableChange> = {}): AlertableChange => ({
        trackedFilerId: 'f-1',
        filerName: 'Berkshire Hathaway',
        reportPeriod: '2026-Q3',
        currentFilingId: 'filing-q3',
        priorFilingId: 'filing-q2',
        cusip: '171232101',
        ticker: 'CB',
        issuerName: 'Chubb',
        changeType: 'new',
        materialityScore: 82,
        createdAt: new Date('2026-11-02T15:00:00Z'),
        ...overrides,
    });
    const radar = (overrides: Partial<PlannedRule> = {}) => rule({
        name: 'New positions', metric: 'alpha_radar_new_position', symbol: null, threshold: 50, rearm: 'always', ...overrides,
    });

    test('a change stored after the rule was made fires, with its filer and score', () => {
        const [firing] = plan({ rules: [radar()], changes: [change()] });
        assert.equal(firing.message, 'Berkshire Hathaway opened a new position in Chubb (CB) in 2026-Q3. Materiality 82/100.');
        assert.equal(firing.occurrence, 'change:f-1:2026-Q3:filing-q3:171232101:new');
        assert.equal(firing.href, '/research?tab=alpha-radar');
        assert.equal(firing.observedValue, 82);
    });

    test('changes seen before the rule, or at the last run, don\'t fire again', () => {
        assert.deepEqual(plan({ rules: [radar({ createdAt: new Date('2026-11-03T00:00:00Z') })], changes: [change()] }), []);
        assert.deepEqual(plan({ rules: [radar()], changes: [change()], alphaRadarSince: new Date('2026-11-02T22:30:00Z') }), []);
        assert.equal(plan({ rules: [radar()], changes: [change()], alphaRadarSince: new Date('2026-11-01T22:30:00Z') }).length, 1);
    });

    test('each metric matches its kind of change, above the threshold', () => {
        const changes = [
            change(),
            change({ cusip: 'X1', changeType: 'exited', ticker: 'OXY', issuerName: 'Occidental' }),
            change({ cusip: 'X2', changeType: 'increased', ticker: 'AAPL', issuerName: 'Apple', materialityScore: 40 }),
            change({ cusip: 'X3', changeType: 'decreased', ticker: 'BAC', issuerName: 'Bank of America' }),
        ];
        const fired = (metric: PlannedRule['metric'], threshold = 50) => plan({ rules: [radar({ metric, threshold })], changes }).map((f) => f.occurrence);
        assert.deepEqual(fired('alpha_radar_new_position'), ['change:f-1:2026-Q3:filing-q3:171232101:new']);
        assert.deepEqual(fired('alpha_radar_exit'), ['change:f-1:2026-Q3:filing-q3:X1:exited']);
        assert.deepEqual(fired('alpha_radar_large_add'), []);
        assert.deepEqual(fired('alpha_radar_large_add', 40), ['change:f-1:2026-Q3:filing-q3:X2:increased']);
        assert.deepEqual(fired('alpha_radar_large_trim'), ['change:f-1:2026-Q3:filing-q3:X3:decreased']);
    });

    test('overlap is the user\'s own: what they hold, watch or have an active thesis on, scored as Research scores it', () => {
        const changes = [change(), change({ cusip: 'X2', changeType: 'increased', ticker: 'AAPL', issuerName: 'Apple', materialityScore: 60 })];
        const overlapRule = radar({ metric: 'alpha_radar_user_overlap' });
        assert.deepEqual(plan({ rules: [overlapRule], changes }), []);
        const overlap = new Map([['u-1', overlapOf({ portfolio: ['AAPL'], watchlist: ['AAPL', 'CB'] })]]);
        const fired = plan({ rules: [overlapRule], changes, overlap });
        // The user's overlap adds to the stored score: 12 held, 7 watched, 7 with a thesis.
        assert.deepEqual(fired.map((f) => [f.observedValue, f.message]), [
            [89, 'Berkshire Hathaway opened a new position in Chubb (CB) in 2026-Q3. Materiality 89/100. It\'s on your watchlist.'],
            [79, 'Berkshire Hathaway added to Apple (AAPL) in 2026-Q3. Materiality 79/100. You hold it; It\'s on your watchlist.'],
        ]);
        // Another user's lists say nothing about this one's.
        assert.deepEqual(plan({ rules: [overlapRule], changes, overlap: new Map([['u-2', overlap.get('u-1')!]]) }), []);
    });

    test('regression: a 13F change without a ticker meets the user by company name', () => {
        // As SEC's refresh stores them: issuer names, no tickers.
        const changes = [
            change({ cusip: '037833100', ticker: null, issuerName: 'APPLE INC', changeType: 'increased', materialityScore: 60 }),
            change({ cusip: '03784Y200', ticker: null, issuerName: 'APPLE HOSPITALITY REIT INC', changeType: 'increased', materialityScore: 60 }),
        ];
        const overlap = new Map([['u-1', overlapOf({ portfolio: [['AAPL', 'Apple Inc.']] })]]);
        const fired = plan({ rules: [radar({ metric: 'alpha_radar_user_overlap' })], changes, overlap });
        assert.deepEqual(fired.map((f) => [f.occurrence.split(':')[4], f.observedValue, f.message]), [
            ['037833100', 72, 'Berkshire Hathaway added to APPLE INC (AAPL) in 2026-Q3. Materiality 72/100. You hold it.'],
        ]);
        // The delivery filters see the same overlap and the ticker it matched.
        const delivered = (alphaRadar: Partial<AlertPreferences['alphaRadar']>) => plan({
            rules: [radar({ metric: 'alpha_radar_large_add' })],
            changes,
            overlap,
            preferences: new Map([['u-1', { ...DEFAULT_ALERT_PREFERENCES, alphaRadar: { ...DEFAULT_ALERT_PREFERENCES.alphaRadar, ...alphaRadar } }]]),
        }).map((f) => f.occurrence.split(':')[4]);
        assert.deepEqual(delivered({ overlapOnly: true }), ['037833100']);
        assert.deepEqual(delivered({ tickerFilters: ['AAPL'] }), ['037833100']);
    });

    test('"daily" raises the most material new change once a day, "once" the most material change', () => {
        const changes = [change({ materialityScore: 60 }), change({ cusip: 'X9', ticker: 'V', issuerName: 'Visa', materialityScore: 90 })];
        const [daily, ...noMore] = plan({ rules: [radar({ rearm: 'daily' })], changes });
        assert.equal(noMore.length, 0);
        assert.equal(daily.occurrence, 'change:f-1:2026-Q3:filing-q3:X9:new');
        assert.match(daily.message, /Visa/);
        // Already raised: the next most material one.
        const notified = new Map([['r-1', new Set(['change:f-1:2026-Q3:filing-q3:X9:new'])]]);
        assert.deepEqual(plan({ rules: [radar({ rearm: 'daily' })], changes, notified }).map((f) => f.occurrence), ['change:f-1:2026-Q3:filing-q3:171232101:new']);
        // A rerun the evening it fired raises nothing more.
        assert.deepEqual(plan({ rules: [radar({ rearm: 'daily', lastTriggeredAt: new Date('2026-11-02T22:31:00Z') })], changes }), []);
        assert.equal(plan({ rules: [radar({ rearm: 'daily', lastTriggeredAt: new Date('2026-11-01T22:31:00Z') })], changes }).length, 1);
        const once = plan({ rules: [radar({ rearm: 'once' })], changes });
        assert.deepEqual(once.map((f) => f.occurrence), ['change:f-1:2026-Q3:filing-q3:X9:new']);
    });

    test('a change already raised isn\'t raised again when a refresh stores it anew; a later filing for the period is a new change', () => {
        const notified = new Map([['r-1', new Set(['change:f-1:2026-Q3:filing-q3:171232101:new'])]]);
        assert.deepEqual(plan({ rules: [radar()], changes: [change()], notified }), []);
        // Another rule hasn't raised it.
        assert.equal(plan({ rules: [radar({ id: 'r-2' })], changes: [change()], notified }).length, 1);
        const amended = plan({ rules: [radar()], changes: [change({ currentFilingId: 'filing-q3-amended' })], notified });
        assert.deepEqual(amended.map((f) => f.occurrence), ['change:f-1:2026-Q3:filing-q3-amended:171232101:new']);
        // An exit has no current filing: the prior one names it.
        const exited = plan({ rules: [radar({ metric: 'alpha_radar_exit' })], changes: [change({ changeType: 'exited', currentFilingId: null })] });
        assert.deepEqual(exited.map((f) => f.occurrence), ['change:f-1:2026-Q3:filing-q2:171232101:exited']);
    });

    test('"always" raises one per change, up to the cap', () => {
        const changes = Array.from({ length: MAX_CHANGES_PER_RULE + 5 }, (_, i) => change({ cusip: `C${i}` }));
        assert.equal(plan({ rules: [radar()], changes }).length, MAX_CHANGES_PER_RULE);
    });

    test('the delivery preferences filter what reaches the feed', () => {
        const changes = [change(), change({ cusip: 'X2', trackedFilerId: 'f-2', ticker: 'AAPL', issuerName: 'Apple', materialityScore: 55 })];
        const withDelivery = (alphaRadar: Partial<AlertPreferences['alphaRadar']>) => plan({
            rules: [radar()],
            changes,
            overlap: new Map([['u-1', overlapOf({ portfolio: ['AAPL'] })]]),
            preferences: new Map([['u-1', { ...DEFAULT_ALERT_PREFERENCES, alphaRadar: { ...DEFAULT_ALERT_PREFERENCES.alphaRadar, ...alphaRadar } }]]),
        }).map((f) => f.occurrence.split(':')[4]);
        assert.deepEqual(withDelivery({}), ['171232101', 'X2']);
        assert.deepEqual(withDelivery({ inApp: false }), []);
        assert.deepEqual(withDelivery({ overlapOnly: true }), ['X2']);
        // Apple's 55 is 67 with the holding: the score the user sees is the one filtered.
        assert.deepEqual(withDelivery({ minMaterialityScore: 60 }), ['171232101', 'X2']);
        assert.deepEqual(withDelivery({ minMaterialityScore: 70 }), ['171232101']);
        assert.deepEqual(withDelivery({ tickerFilters: ['AAPL'] }), ['X2']);
        assert.deepEqual(withDelivery({ trackedFilerIds: ['f-1'] }), ['171232101']);
    });
});

describe('planAlertFirings: notification settings', () => {
    test('Price Alerts, Portfolio Updates and Alpha Radar Signals each turn their kind off', () => {
        const accounts = new Map([['u-1', { cash: 10, positions: [] }]]);
        const rules = [
            rule(),
            rule({ id: 'r-2', metric: 'portfolio_value', symbol: null, threshold: 0 }),
            rule({ id: 'r-3', metric: 'alpha_radar_exit', symbol: null, threshold: 0, rearm: 'always' }),
        ];
        const changes: AlertableChange[] = [{
            trackedFilerId: 'f-1', filerName: 'Fund', reportPeriod: '2026-Q3', currentFilingId: null, priorFilingId: 'f-q2', cusip: 'C', ticker: null, issuerName: 'Issuer',
            changeType: 'exited', materialityScore: 10, createdAt: new Date('2026-11-02T00:00:00Z'),
        }];
        const fired = (preferences: Partial<AlertPreferences>) => plan({
            rules, accounts, changes, preferences: new Map([['u-1', { ...DEFAULT_ALERT_PREFERENCES, ...preferences }]]),
        }).map((f) => f.ruleId);
        assert.deepEqual(fired({}), ['r-1', 'r-2', 'r-3']);
        assert.deepEqual(fired({ priceAlerts: false }), ['r-2', 'r-3']);
        assert.deepEqual(fired({ portfolioUpdates: false }), ['r-1', 'r-3']);
        assert.deepEqual(fired({ alphaRadarSignals: false }), ['r-1', 'r-2']);
        // A change without a ticker reads without one.
        assert.equal(plan({ rules: [rules[2]], changes })[0].message, 'Fund exited Issuer in 2026-Q3. Materiality 10/100.');
    });
});
