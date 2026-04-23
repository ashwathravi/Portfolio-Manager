import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
    chooseAccentForeground,
    darken,
    isValidHex,
    resolveTheme,
    withAlpha,
} from './ThemeProvider';

describe('ThemeProvider helpers', () => {
    describe('darken', () => {
        test('darkens a hex by the exact expected amount', () => {
            // Forest green #17cf54 at 18% darker is the value we seed into
            // --pm-accent-dark in globals.css. If this drifts the SSR paint
            // and the post-hydration paint will disagree.
            assert.strictEqual(darken('#17cf54', 0.18), '#13aa45');
        });

        test('darkens to black at amount=1', () => {
            assert.strictEqual(darken('#ffffff', 1), '#000000');
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

    describe('isValidHex', () => {
        test('accepts 6-char hex with and without leading #', () => {
            assert.strictEqual(isValidHex('#17cf54'), true);
            assert.strictEqual(isValidHex('17cf54'), true);
            assert.strictEqual(isValidHex('#ABCDEF'), true);
        });

        test('rejects 3-char hex, 8-char hex-with-alpha, and non-hex', () => {
            assert.strictEqual(isValidHex('#fff'), false);
            assert.strictEqual(isValidHex('#17cf54ff'), false);
            assert.strictEqual(isValidHex('rgb(0,0,0)'), false);
            assert.strictEqual(isValidHex('url(//evil.com)'), false);
            assert.strictEqual(isValidHex(''), false);
        });
    });

    describe('chooseAccentForeground', () => {
        // WCAG-strict targets per preset. White-on-Forest and white-on-Amber
        // are both below 3:1 contrast — both have to flip to dark text.
        // Indigo and Slate are dark enough that white reads. Teal lands just
        // over the 0.22 luminance threshold and also picks dark.
        test('picks dark foreground for bright accents (Forest, Amber, Teal)', () => {
            assert.strictEqual(chooseAccentForeground('#17cf54'), '#0d1812'); // Forest
            assert.strictEqual(chooseAccentForeground('#f59e0b'), '#0d1812'); // Amber
            assert.strictEqual(chooseAccentForeground('#0d9488'), '#0d1812'); // Teal
        });

        test('picks white foreground for dark accents (Indigo, Slate)', () => {
            assert.strictEqual(chooseAccentForeground('#6366f1'), '#ffffff'); // Indigo
            assert.strictEqual(chooseAccentForeground('#334155'), '#ffffff'); // Slate
        });

        test('picks white at the two extremes (pure black, pure white ceiling)', () => {
            // Black background → white text.
            assert.strictEqual(chooseAccentForeground('#000000'), '#ffffff');
            // White background exceeds the threshold → dark text.
            assert.strictEqual(chooseAccentForeground('#ffffff'), '#0d1812');
        });

        test('defaults to white on malformed input', () => {
            assert.strictEqual(chooseAccentForeground('not-a-color'), '#ffffff');
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
