import { test, describe } from 'node:test';
import assert from 'node:assert';

import { resolveTheme } from './ThemeProvider';

describe('ThemeProvider helpers', () => {
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
