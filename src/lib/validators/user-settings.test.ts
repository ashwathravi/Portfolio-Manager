import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PERSISTED_SETTINGS_SLICES, SETTINGS_VERSION } from '@/lib/settings/document';

import { settingsDocumentSchema } from './user-settings';

function message(input: unknown): string | undefined {
    const result = settingsDocumentSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('settingsDocumentSchema', () => {
    test('accepts a document with every persisted slice', () => {
        const settings = Object.fromEntries(
            PERSISTED_SETTINGS_SLICES.map((slice) => [slice, slice === 'tags' || slice === 'accounts' ? [] : {}]),
        );
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings }).success, true);
    });

    test('accepts a partial document from an older version', () => {
        assert.equal(settingsDocumentSchema.safeParse({ version: 1, settings: { appearance: { theme: 'dark' } } }).success, true);
    });

    test('version must be a whole number from 1 to the current version', () => {
        assert.equal(message({ version: '15', settings: {} }), 'version must be a number');
        assert.equal(message({ version: 2.5, settings: {} }), 'version must be a whole number');
        assert.equal(message({ version: 0, settings: {} }), 'version must be at least 1');
        assert.equal(message({ version: SETTINGS_VERSION + 1, settings: {} }), `version must be at most ${SETTINGS_VERSION}`);
    });

    test('rejects slices that are not persisted, such as API keys', () => {
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: { apiKeys: { polygon: 'pk' } } }).success, false);
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: { security: {} } }).success, false);
    });

    test('lists stay lists and every other slice is an object', () => {
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: { tags: {} } }).success, false);
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: { profile: [] } }).success, false);
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: { demo: 'off' } }).success, false);
    });

    test('rejects extra top-level fields and a missing settings object', () => {
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION, settings: {}, userId: 'someone-else' }).success, false);
        assert.equal(settingsDocumentSchema.safeParse({ version: SETTINGS_VERSION }).success, false);
    });
});
