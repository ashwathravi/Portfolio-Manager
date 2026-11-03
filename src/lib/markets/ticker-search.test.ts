import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchTextAsTicker, tickerMatchHint } from './ticker-search';

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

test('tickerMatchHint - the user\'s own holdings say so, others say where they list', () => {
    assert.equal(tickerMatchHint({ held: true, exchange: 'Nasdaq' }), 'In your accounts');
    assert.equal(tickerMatchHint({ held: false, exchange: 'NYSE' }), 'NYSE');
    assert.equal(tickerMatchHint({ held: false, exchange: null }), null);
});
