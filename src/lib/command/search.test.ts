import { test, describe } from 'node:test';
import assert from 'node:assert';
import { looksLikeQuestion, searchCommands } from './search';

const theses = [
    { ticker: 'NVDA', title: 'AI Infrastructure Dominance', status: 'active' },
    { ticker: 'META', title: 'Metaverse Pivot Risk', status: 'archived' },
];

describe('command search', () => {
    test('an empty query offers Ask Ledger first, then every destination', () => {
        const items = searchCommands('');
        assert.deepStrictEqual([items[0].group, items[0].label, items[0].ask], ['Ask', 'Ask Ledger', '']);
        assert.ok(items.slice(1).every((i) => i.group === 'Go to'));
        assert.ok(items.some((i) => i.label === 'Today' && i.href === '/'));
        assert.ok(items.some((i) => i.label === 'Portfolio › Activity' && i.href === '/portfolios/activity'));
    });

    test('matches destinations by title and description, label matches first', () => {
        const items = searchCommands('behav').filter((i) => i.group === 'Go to');
        assert.deepStrictEqual(items.map((i) => i.href), ['/performance/behaviour', '/performance', '/performance/attribution']);
        assert.ok(searchCommands('help').some((i) => i.href === '/help'));
        assert.strictEqual(searchCommands('activity')[0].href, '/portfolios/activity');
        assert.ok(searchCommands('guardrails').some((i) => i.href === '/settings'));
    });

    test('a ticker-shaped query offers the position and a draft order', () => {
        const items = searchCommands('nvda', { theses });
        const symbols = items.filter((i) => i.group === 'Symbols');
        assert.deepStrictEqual(symbols.map((i) => i.href), ['/portfolios/detail/NVDA', '/execution?symbol=NVDA']);
        assert.ok(items.some((i) => i.group === 'Theses' && i.href === '/research/thesis/NVDA'));
    });

    test('theses match on title words and flag archived ones', () => {
        const items = searchCommands('pivot', { theses }).filter((i) => i.group === 'Theses');
        assert.deepStrictEqual(items.map((i) => [i.label, i.hint]), [['META — Metaverse Pivot Risk', 'Archived thesis']]);
    });

    test('any query can be handed to Ask; questions put Ask first', () => {
        const nav = searchCommands('settings');
        assert.strictEqual(nav.at(-1)?.group, 'Ask');
        const q = searchCommands('Am I overexposed to AI?');
        assert.strictEqual(q[0].group, 'Ask');
        assert.strictEqual(q[0].ask, 'Am I overexposed to AI?');
    });

    test('multi-word or invalid input never produces symbol items', () => {
        assert.ok(!searchCommands('top holdings').some((i) => i.group === 'Symbols'));
        assert.ok(!searchCommands('<x>').some((i) => i.group === 'Symbols'));
    });

    const apple = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', held: false };
    const hospitality = { symbol: 'APLE', name: 'Apple Hospitality REIT, Inc.', exchange: 'NYSE', held: false };

    test('tickers found by company name open their position page', () => {
        const symbols = searchCommands('apple', { symbols: [apple, hospitality] }).filter((i) => i.group === 'Symbols');
        assert.deepStrictEqual(symbols.map((i) => [i.label, i.hint, i.href]), [
            ['AAPL — Apple Inc.', 'Nasdaq', '/portfolios/detail/AAPL'],
            ['APLE — Apple Hospitality REIT, Inc.', 'NYSE', '/portfolios/detail/APLE'],
            // "apple" could be a ticker search doesn't know: it can still be opened.
            ['Open APPLE', 'Position, quote, and thesis', '/portfolios/detail/APPLE'],
            ['Draft an order for APPLE', 'Trade', '/execution?symbol=APPLE'],
        ]);
    });

    test('the ticker typed comes first with its name and a draft order, once', () => {
        const held = { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B', exchange: 'NYSE', held: true };
        const symbols = searchCommands('brk-b', { symbols: [{ ...held, symbol: 'BRK.A', held: false }, held] })
            .filter((i) => i.group === 'Symbols');
        assert.deepStrictEqual(symbols.map((i) => [i.label, i.hint, i.href]), [
            ['BRK.B — Berkshire Hathaway Inc. Class B', 'In your accounts', '/portfolios/detail/BRK.B'],
            ['Draft an order for BRK.B', 'Trade', '/execution?symbol=BRK.B'],
            ['BRK.A — Berkshire Hathaway Inc. Class B', 'NYSE', '/portfolios/detail/BRK.A'],
        ]);
    });

    test('a word too long to be a ticker lists its matches but nothing as typed; without matches it can still be opened', () => {
        const brk = { symbol: 'BRK.B', name: 'BERKSHIRE HATHAWAY INC', exchange: 'NYSE', held: false };
        const symbols = searchCommands('berkshire', { symbols: [brk] }).filter((i) => i.group === 'Symbols');
        assert.deepStrictEqual(symbols.map((i) => i.label), ['BRK.B — BERKSHIRE HATHAWAY INC']);
        // No search (no database, or it failed): the old behaviour.
        assert.deepStrictEqual(
            searchCommands('berkshire').filter((i) => i.group === 'Symbols').map((i) => i.label),
            ['Open BERKSHIRE', 'Draft an order for BERKSHIRE'],
        );
        // A pair or class share is plausible however long.
        const btc = searchCommands('btc-usd', { symbols: [{ symbol: 'BTCS', name: 'BTCS Inc.', exchange: 'Nasdaq', held: false }] });
        assert.ok(btc.some((i) => i.label === 'Open BTC-USD'));
    });

    test('a long match list still leaves room for the ticker as typed', () => {
        const many = Array.from({ length: 8 }, (_, i) => ({ symbol: `NV${i}`, name: `Nova ${i}`, exchange: null, held: false }));
        const symbols = searchCommands('nv', { symbols: many }).filter((i) => i.group === 'Symbols');
        assert.equal(symbols.length, 7);
        assert.deepStrictEqual(symbols.slice(-2).map((i) => i.href), ['/portfolios/detail/NV', '/execution?symbol=NV']);
    });

    test('a company name of several words lists its matches but nothing as typed', () => {
        const bank = { symbol: 'BAC', name: 'BANK OF AMERICA CORP', exchange: 'NYSE', held: false };
        const symbols = searchCommands('bank of america', { symbols: [bank] }).filter((i) => i.group === 'Symbols');
        assert.deepStrictEqual(symbols.map((i) => i.href), ['/portfolios/detail/BAC']);
    });

    test('looksLikeQuestion', () => {
        assert.strictEqual(looksLikeQuestion('which holdings hurt my alpha'), true);
        assert.strictEqual(looksLikeQuestion('nvda?'), true);
        assert.strictEqual(looksLikeQuestion('show'), false);
        assert.strictEqual(looksLikeQuestion('settings'), false);
    });
});
