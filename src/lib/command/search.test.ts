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
        assert.deepStrictEqual(items.map((i) => i.href), ['/performance/behaviour', '/performance']);
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

    test('looksLikeQuestion', () => {
        assert.strictEqual(looksLikeQuestion('which holdings hurt my alpha'), true);
        assert.strictEqual(looksLikeQuestion('nvda?'), true);
        assert.strictEqual(looksLikeQuestion('show'), false);
        assert.strictEqual(looksLikeQuestion('settings'), false);
    });
});
