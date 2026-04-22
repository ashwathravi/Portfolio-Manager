import { test, describe } from 'node:test';
import assert from 'node:assert';

import { darken, resolveTheme, withAlpha } from './ThemeProvider';

describe('ThemeProvider helpers', () => {
    describe('darken', () => {
        test('darkens a hex by the given fraction', () => {
            // Forest green #17cf54 → roughly #0E8833 at 18% darker (the default the
            // provider writes to --pm-accent-dark).
            const darker = darken('#17cf54', 0.18);
            assert.match(darker, /^#[0-9a-f]{6}$/);
            assert.notStrictEqual(darker, '#17cf54');
        });

        test('returns the input unchanged on malformed hex', () => {
            assert.strictEqual(darken('not-a-color', 0.3), 'not-a-color');
        });

        test('clamps negative amounts to zero (no-op)', () => {
            assert.strictEqual(darken('#ffffff', -1), '#ffffff');
        });
    });

    describe('withAlpha', () => {
        test('emits valid rgba for a hex + alpha', () => {
            assert.strictEqual(withAlpha('#17cf54', 0.1), 'rgba(23, 207, 84, 0.1)');
        });

        test('clamps alpha to 0..1', () => {
            assert.strictEqual(withAlpha('#000000', 2), 'rgba(0, 0, 0, 1)');
            assert.strictEqual(withAlpha('#000000', -1), 'rgba(0, 0, 0, 0)');
        });

        test('returns input on malformed hex', () => {
            assert.strictEqual(withAlpha('oops', 0.5), 'oops');
        });
    });

    describe('resolveTheme', () => {
        test('passes through explicit modes', () => {
            assert.strictEqual(resolveTheme('light', false), 'light');
            assert.strictEqual(resolveTheme('dim', true), 'dim');
            assert.strictEqual(resolveTheme('dark', false), 'dark');
        });

        test('resolves system to light when prefers-light', () => {
            assert.strictEqual(resolveTheme('system', false), 'light');
        });

        test('resolves system to dark when prefers-dark', () => {
            assert.strictEqual(resolveTheme('system', true), 'dark');
        });
    });
});
