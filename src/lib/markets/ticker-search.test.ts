import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TickerMatch } from '@/types/market-data';

import { matchesStillTyped, matchRank, parseTickerQuery, searchTextAsTicker, tickerMatchHint } from './ticker-search';

const match = (symbol: string, name: string): TickerMatch => ({ symbol, name, exchange: 'Nasdaq', held: false });

test('searchTextAsTicker - a class share however it is typed', () => {
    for (const typed of ['brk b', 'BRK-B', 'brk/b', 'BRK.B', '  brk   b ']) {
        assert.equal(searchTextAsTicker(typed), 'BRK.B', typed);
    }
});

test('searchTextAsTicker - plain tickers and pairs as typed, uppercased', () => {
    assert.equal(searchTextAsTicker('nvda'), 'NVDA');
    assert.equal(searchTextAsTicker('btc-usd'), 'BTC-USD');
});

test('searchTextAsTicker - regression: a company name is not read as a ticker', () => {
    assert.equal(searchTextAsTicker('apple inc'), null);
    assert.equal(searchTextAsTicker('bank of america'), null);
    assert.equal(searchTextAsTicker('<x>'), null);
    assert.equal(searchTextAsTicker('ABCDEFGHIJK'), null);
    assert.equal(searchTextAsTicker(''), null);
});

test('parseTickerQuery - read as text and, when it can be one, as a ticker', () => {
    assert.deepEqual(parseTickerQuery('  Apple   Inc '), { text: 'apple inc', symbol: null });
    assert.deepEqual(parseTickerQuery('brk b'), { text: 'brk b', symbol: 'BRK.B' });
    assert.deepEqual(parseTickerQuery('BRK-B'), { text: 'brk-b', symbol: 'BRK.B' });
    assert.deepEqual(parseTickerQuery('nvda'), { text: 'nvda', symbol: 'NVDA' });
    assert.equal(parseTickerQuery('   '), null);
});

test('matchRank - the ticker itself, then tickers starting with it, then names by how they start', () => {
    const q = parseTickerQuery('app')!;
    assert.equal(matchRank(match('APP', 'AppLovin Corp'), q), 0);
    assert.equal(matchRank(match('APPF', 'AppFolio Inc'), q), 1);
    assert.equal(matchRank(match('AAPL', 'Apple Inc.'), q), 2);
    assert.equal(matchRank(match('XYZ', 'Big Apple Corp'), q), 3);
    assert.equal(matchRank(match('SNAP', 'Snapple Holdings'), q), 4);
    assert.equal(matchRank(match('MSFT', 'Microsoft Corp'), q), null);
});

test('matchesStillTyped - regression: an earlier search\'s match for something no longer typed is dropped', () => {
    const forApple = [match('AAPL', 'Apple Inc.'), match('APLE', 'Apple Hospitality REIT, Inc.')];
    // Replacing "apple" with "msft": AAPL was first, and Enter would have opened it.
    assert.deepEqual(matchesStillTyped(forApple, 'msft'), []);
    // Typing on: what still fits stays up while the next search runs.
    assert.deepEqual(matchesStillTyped(forApple, 'apple h').map((m) => m.symbol), ['APLE']);
    assert.deepEqual(matchesStillTyped(forApple, 'aapl').map((m) => m.symbol), ['AAPL']);
    assert.deepEqual(matchesStillTyped(forApple, '  '), []);
});

test('tickerMatchHint - the user\'s own holdings say so, others say where they list', () => {
    assert.equal(tickerMatchHint({ held: true, exchange: 'Nasdaq' }), 'In your accounts');
    assert.equal(tickerMatchHint({ held: false, exchange: 'NYSE' }), 'NYSE');
    assert.equal(tickerMatchHint({ held: false, exchange: null }), null);
});
