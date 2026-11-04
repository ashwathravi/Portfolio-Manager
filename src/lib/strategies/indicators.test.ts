import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    indicatorLabel,
    indicatorSeries,
    lookback,
    parseIndicator,
    parseOperand,
    parseRuleNumber,
    TRADING_DAYS_PER_MONTH,
} from './indicators';

const bars = (closes: number[], volume = 100) => closes.map((close) => ({ close, volume }));

describe('parsing what a rule compares', () => {
    test('indicators within their periods, case-insensitive', () => {
        assert.deepEqual(parseIndicator('Close'), { kind: 'close', period: 0 });
        assert.deepEqual(parseIndicator(' sma(50) '), { kind: 'sma', period: 50 });
        assert.deepEqual(parseIndicator('Mom(6M)'), { kind: 'mom', period: 6 });
        assert.deepEqual(parseIndicator('RSI(14)'), { kind: 'rsi', period: 14 });
        assert.equal(indicatorLabel(parseIndicator('ema(20)')!), 'EMA(20)');
        assert.equal(indicatorLabel(parseIndicator('mom(12m)')!), 'Mom(12M)');
    });

    test('regression: fundamentals and out-of-range periods are refused, not guessed', () => {
        for (const text of ['P/E', 'MomScore(6M)', 'SMA(1)', 'SMA(251)', 'RSI(101)', 'Mom(13M)', 'Mom(0M)', 'ADV(0)', 'SMA()', '']) {
            assert.equal(parseIndicator(text), null, text);
        }
    });

    test('numbers as people write them in a rule', () => {
        assert.equal(parseRuleNumber('30'), 30);
        assert.equal(parseRuleNumber('-2.5'), -2.5);
        assert.equal(parseRuleNumber('10%'), 10);
        assert.equal(parseRuleNumber('$5M'), 5_000_000);
        assert.equal(parseRuleNumber('2.5b'), 2_500_000_000);
        assert.equal(parseRuleNumber('1,000'), 1000);
        for (const text of ['', 'abc', '1,00', '5MM', '$', '1e9']) assert.equal(parseRuleNumber(text), null, text);
    });

    test('an operand is an indicator or a number', () => {
        assert.deepEqual(parseOperand('SMA(10)'), { kind: 'indicator', indicator: { kind: 'sma', period: 10 } });
        assert.deepEqual(parseOperand('0.7'), { kind: 'number', value: 0.7 });
        assert.equal(parseOperand('SPX RS'), null);
    });

    test('lookback is the earlier bars each indicator needs', () => {
        assert.equal(lookback({ kind: 'close', period: 0 }), 0);
        assert.equal(lookback({ kind: 'sma', period: 50 }), 49);
        assert.equal(lookback({ kind: 'rsi', period: 14 }), 14);
        assert.equal(lookback({ kind: 'mom', period: 6 }), 6 * TRADING_DAYS_PER_MONTH);
    });
});

describe('indicator series', () => {
    test('SMA and EMA wait for their period; EMA starts from the simple average', () => {
        assert.deepEqual(indicatorSeries(bars([1, 2, 3, 4, 5]), { kind: 'sma', period: 3 }), [null, null, 2, 3, 4]);
        // k = 2 / (3 + 1) = 0.5: 2, then 4·0.5 + 2·0.5 = 3, then 5·0.5 + 3·0.5 = 4.
        assert.deepEqual(indicatorSeries(bars([1, 2, 3, 4, 5]), { kind: 'ema', period: 3 }), [null, null, 2, 3, 4]);
        // k = 2/3: 1.5, then 6·2/3 + 1.5·1/3 = 4.5.
        const ema2 = indicatorSeries(bars([1, 2, 6]), { kind: 'ema', period: 2 });
        assert.equal(ema2[1], 1.5);
        assert.ok(Math.abs(ema2[2]! - 4.5) < 1e-9);
    });

    test('RSI uses Wilder smoothing: 100 without losses, 50 without moves', () => {
        // Changes +1, +1, −1 with n = 2: gains 1 then 0.5, losses 0 then 0.5.
        assert.deepEqual(indicatorSeries(bars([1, 2, 3, 2]), { kind: 'rsi', period: 2 }), [null, null, 100, 50]);
        assert.deepEqual(indicatorSeries(bars([5, 5, 5]), { kind: 'rsi', period: 2 }), [null, null, 50]);
    });

    test('momentum is the % change over 21 sessions a month; ADV is close × volume averaged', () => {
        const closes = Array.from({ length: 22 }, (_, i) => (i === 21 ? 110 : 100));
        const mom = indicatorSeries(bars(closes), { kind: 'mom', period: 1 });
        assert.equal(mom[20], null);
        assert.ok(Math.abs(mom[21]! - 10) < 1e-9);
        assert.deepEqual(indicatorSeries([{ close: 10, volume: 100 }, { close: 20, volume: 100 }], { kind: 'adv', period: 2 }), [null, 1500]);
    });
});
