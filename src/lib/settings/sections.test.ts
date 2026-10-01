import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SETTINGS_SECTIONS, sectionForTab } from './sections';

describe('settings sections', () => {
    test('section ids are unique', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        assert.strictEqual(new Set(ids).size, ids.length);
    });

    test('every legacy ?tab= slug maps to an existing section', () => {
        const ids = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));
        for (const tab of ['profile', 'security', 'accounts', 'data', 'notifications', 'alerts', 'preferences', 'appearance', 'tags', 'api-keys']) {
            const id = sectionForTab(tab);
            assert.ok(id && ids.has(id), `${tab} → ${id}`);
        }
    });

    test('unknown or missing tabs map to nothing', () => {
        assert.strictEqual(sectionForTab('nope'), null);
        assert.strictEqual(sectionForTab(null), null);
    });

    test('connected accounts live at #accounts (the target of every "Connect an account" link)', () => {
        assert.ok(SETTINGS_SECTIONS.some((s) => s.id === 'accounts'));
    });
});
