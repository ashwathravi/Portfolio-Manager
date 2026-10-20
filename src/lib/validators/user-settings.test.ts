import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FIRST_SAVED_SETTINGS_VERSION, SETTINGS_VERSION } from '@/lib/settings/document';
import { defaultPersistedSettings } from '@/lib/stores/settingsStore';

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
    test('accepts a document with every persisted slice, or with none', () => {
        assert.equal(accepts(body(defaultPersistedSettings())), true);
        assert.equal(accepts(body({})), true);
    });

    test('regression: refuses a mistyped optional field the defaults leave out', () => {
        // The Codex finding on PR #143: normalizing kept it, and the Today
        // page's risk policy crashed on it until settings were reset.
        const defaults = defaultPersistedSettings();
        const settings = {
            riskPolicy: { ...defaults.riskPolicy, employerStockPlan: { ...defaults.riskPolicy.employerStockPlan, nextActionDate: {} } },
        };
        const result = settingsDocumentSchema.safeParse(body(settings));

        assert.equal(result.success, false);
        assert.deepEqual(result.error?.issues[0]?.path, ['settings', 'riskPolicy', 'employerStockPlan', 'nextActionDate']);
        assert.equal(result.error?.issues[0]?.message, 'settings.riskPolicy.employerStockPlan.nextActionDate must be a date (YYYY-MM-DD)');
    });

    test('a slice at the current version has every field', () => {
        assert.equal(message(body({ demo: {} })), 'settings.demo.showSampleData is missing');
    });

    test('regression: refuses versions no browser saves, whose fields went unchecked', () => {
        // Browsers migrate before saving, so nothing older than the first saved version arrives.
        assert.equal(
            message(body({ profile: { fullName: 'Jane', apiKey: 'secret' } }, { version: FIRST_SAVED_SETTINGS_VERSION - 1 })),
            `version must be at least ${FIRST_SAVED_SETTINGS_VERSION}`,
        );
    });

    test('version must be a whole number from the first saved version to the current one', () => {
        assert.equal(message(body({}, { version: '15' })), 'version must be a number');
        assert.equal(message(body({}, { version: 15.5 })), 'version must be a whole number');
        assert.equal(message(body({}, { version: 1 })), `version must be at least ${FIRST_SAVED_SETTINGS_VERSION}`);
        assert.equal(message(body({}, { version: SETTINGS_VERSION + 1 })), `version must be at most ${SETTINGS_VERSION}`);
        assert.equal(accepts(body({}, { version: FIRST_SAVED_SETTINGS_VERSION })), true);
    });

    test('rejects slices that are not persisted, such as API keys', () => {
        assert.equal(message(body({ apiKeys: { polygon: 'pk' } })), 'settings has an unknown field "apiKeys"');
        assert.equal(message(body({ security: {} })), 'settings has an unknown field "security"');
    });

    test('regression: list items are objects, so an account like null is refused', () => {
        const account = {
            id: 'plaid-1', name: 'Brokerage', type: 'Brokerage', accountMask: '****0000', holdings: 1,
            accountValue: 1, lastSynced: 'Oct 19, 2026', status: 'reconciled',
        };
        assert.equal(message(body({ accounts: [null] })), 'settings.accounts[0] must be an object');
        assert.equal(accepts(body({ tags: ['x'] })), false);
        assert.equal(accepts(body({ accounts: [account] })), true);
    });

    test('regression: account and tag items need an id and a name', () => {
        assert.equal(message(body({ accounts: [{}] })), 'settings.accounts[0].id is missing');
        assert.equal(message(body({ tags: [{ id: 't1' }] })), 'settings.tags[0].name is missing');
        assert.equal(message(body({ accounts: [{ id: '', name: 'x' }] })), 'settings.accounts[0].id must not be empty');
    });

    test('lists stay lists and every other slice is an object', () => {
        assert.equal(message(body({ tags: {} })), 'settings.tags must be a list');
        assert.equal(message(body({ profile: [] })), 'settings.profile must be an object');
        assert.equal(accepts(body({ demo: 'off' })), false);
        assert.equal(message(body([])), 'settings must be an object');
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

    test('loads without the settings store, so the route never runs client code', () => {
        // A fresh process that refuses to resolve the store or Zustand.
        const script = `
            import { registerHooks } from 'node:module';
            registerHooks({
                resolve(specifier, context, next) {
                    if (/zustand|settingsStore/.test(specifier)) throw new Error('loaded ' + specifier);
                    return next(specifier, context);
                },
            });
            await import(${JSON.stringify(join(__dirname, 'user-settings.ts'))});
        `;
        const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
    });
});
