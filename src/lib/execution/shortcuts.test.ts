import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveTicketShortcut, TICKET_SHORTCUTS } from './shortcuts';

const key = (k: string, extra: Partial<Parameters<typeof resolveTicketShortcut>[0]> = {}) =>
    resolveTicketShortcut({ key: k, inEditable: false, ...extra });

describe('resolveTicketShortcut', () => {
    test('letters switch side and order type, case-insensitively', () => {
        assert.deepStrictEqual(key('b'), { kind: 'side', side: 'buy' });
        assert.deepStrictEqual(key('S'), { kind: 'side', side: 'sell' });
        assert.deepStrictEqual(key('m'), { kind: 'orderType', orderType: 'market' });
        assert.deepStrictEqual(key('L'), { kind: 'orderType', orderType: 'limit' });
    });

    test('t and q jump to the ticker and quantity fields; ? opens the sheet', () => {
        assert.deepStrictEqual(key('t'), { kind: 'focus', field: 'ticker' });
        assert.deepStrictEqual(key('q'), { kind: 'focus', field: 'quantity' });
        assert.deepStrictEqual(key('?'), { kind: 'help' });
    });

    test('regression: typing in a field never flips the side', () => {
        assert.strictEqual(key('b', { inEditable: true }), null);
        assert.strictEqual(key('s', { inEditable: true }), null);
    });

    test('⌘/Ctrl+Enter reviews from anywhere, including inside a field', () => {
        assert.deepStrictEqual(key('Enter', { metaKey: true, inEditable: true }), { kind: 'submit' });
        assert.deepStrictEqual(key('Enter', { ctrlKey: true }), { kind: 'submit' });
        assert.strictEqual(key('Enter'), null);
        assert.strictEqual(key('Enter', { metaKey: true, altKey: true }), null);
    });

    test('regression: a held ⌘↵ (auto-repeat) reviews only once', () => {
        assert.deepStrictEqual(key('Enter', { metaKey: true }), { kind: 'submit' });
        assert.strictEqual(key('Enter', { metaKey: true, repeat: true }), null);
    });

    test('Escape is always available; modified letters are left to the browser', () => {
        assert.deepStrictEqual(key('Escape', { inEditable: true }), { kind: 'escape' });
        assert.strictEqual(key('b', { metaKey: true }), null);
        assert.strictEqual(key('s', { ctrlKey: true }), null);
        assert.strictEqual(key('l', { altKey: true }), null);
    });

    test('an open overlay (⌘K, Ask) owns the keyboard', () => {
        assert.strictEqual(key('b', { overlayOpen: true }), null);
        assert.strictEqual(key('Enter', { metaKey: true, overlayOpen: true }), null);
    });

    test('unbound keys do nothing', () => {
        assert.strictEqual(key('x'), null);
        assert.strictEqual(key('ArrowUp'), null);
    });

    test('the cheat sheet lists every bound letter', () => {
        const listed = new Set(TICKET_SHORTCUTS.flatMap((s) => s.keys.map((k) => k.toLowerCase())));
        for (const letter of ['b', 's', 't', 'q', 'm', 'l', '?']) assert.ok(listed.has(letter), letter);
    });
});
