import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PERSISTED_SETTINGS_SLICES, SETTINGS_VERSION } from '@/lib/settings/document';

import { settingsDocumentSchema } from './user-settings';

/** A first save of `settings`; override any field. */
function body(settings: unknown, overrides: Record<string, unknown> = {}) {
    return { version: SETTINGS_VERSION, settings, baseUpdatedAt: null, ...overrides };
}

function accepts(input: unknown): boolean {
    return settingsDocumentSchema.safeParse(input).success;
}

function message(input: unknown): string | undefined {
    const result = settingsDocumentSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('settingsDocumentSchema', () => {
    test('accepts a document with every persisted slice', () => {
        const settings = Object.fromEntries(
            PERSISTED_SETTINGS_SLICES.map((slice) => [slice, slice === 'tags' || slice === 'accounts' ? [] : {}]),
        );
        assert.equal(accepts(body(settings)), true);
    });

    test('accepts a partial document from an older version', () => {
        assert.equal(accepts(body({ appearance: { theme: 'dark' } }, { version: 1 })), true);
    });

    test('version must be a whole number from 1 to the current version', () => {
        assert.equal(message(body({}, { version: '15' })), 'version must be a number');
        assert.equal(message(body({}, { version: 2.5 })), 'version must be a whole number');
        assert.equal(message(body({}, { version: 0 })), 'version must be at least 1');
        assert.equal(message(body({}, { version: SETTINGS_VERSION + 1 })), `version must be at most ${SETTINGS_VERSION}`);
    });

    test('rejects slices that are not persisted, such as API keys', () => {
        assert.equal(accepts(body({ apiKeys: { polygon: 'pk' } })), false);
        assert.equal(accepts(body({ security: {} })), false);
    });

    test('lists stay lists and every other slice is an object', () => {
        assert.equal(accepts(body({ tags: {} })), false);
        assert.equal(accepts(body({ profile: [] })), false);
        assert.equal(accepts(body({ demo: 'off' })), false);
    });

    test('baseUpdatedAt is the stored version stamp, or null for a first save', () => {
        assert.equal(accepts(body({}, { baseUpdatedAt: '2026-10-19T08:00:00.000Z' })), true);
        assert.equal(message(body({}, { baseUpdatedAt: 'yesterday' })), 'baseUpdatedAt must be an ISO date-time');
        assert.equal(accepts({ version: SETTINGS_VERSION, settings: {} }), false);
    });

    test('rejects extra top-level fields and a missing settings object', () => {
        assert.equal(accepts(body({}, { userId: 'someone-else' })), false);
        assert.equal(accepts({ version: SETTINGS_VERSION, baseUpdatedAt: null }), false);
    });
});
