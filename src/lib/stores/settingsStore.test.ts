import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';

// Zustand persist middleware needs localStorage; provide a minimal shim.
const kvStore = new Map<string, string>();
// @ts-expect-error — intentional minimal mock
globalThis.localStorage = {
    getItem: (key: string) => kvStore.get(key) ?? null,
    setItem: (key: string, value: string) => { kvStore.set(key, value); },
    removeItem: (key: string) => { kvStore.delete(key); },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let useSettingsStore: any;

describe('settingsStore', () => {
    before(async () => {
        // Dynamic import must happen after localStorage shim is in place
        const mod = await import('./settingsStore');
        useSettingsStore = mod.useSettingsStore;
    });

    beforeEach(() => {
        useSettingsStore.getState().resetSettings();
    });

    // -----------------------------------------------------------------------
    // Profile
    // -----------------------------------------------------------------------

    describe('updateProfile', () => {
        test('should merge partial updates without clobbering other fields', () => {
            useSettingsStore.getState().updateProfile({ fullName: 'Jane Smith' });
            const profile = useSettingsStore.getState().profile;
            assert.strictEqual(profile.fullName, 'Jane Smith');
            assert.strictEqual(profile.email, 'john@example.com');  // unchanged
            assert.strictEqual(profile.phone, '+1 (555) 123-4567'); // unchanged
        });

        test('should update multiple fields at once', () => {
            useSettingsStore.getState().updateProfile({ email: 'jane@test.com', phone: '9999999999' });
            const profile = useSettingsStore.getState().profile;
            assert.strictEqual(profile.email, 'jane@test.com');
            assert.strictEqual(profile.phone, '9999999999');
        });
    });

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------

    describe('updateNotification', () => {
        test('should toggle a single notification setting', () => {
            const before = useSettingsStore.getState().notifications.strategySignals;
            assert.strictEqual(before, false);
            useSettingsStore.getState().updateNotification('strategySignals', true);
            assert.strictEqual(useSettingsStore.getState().notifications.strategySignals, true);
        });

        test('should leave other notification settings unchanged', () => {
            useSettingsStore.getState().updateNotification('priceAlerts', false);
            const n = useSettingsStore.getState().notifications;
            assert.strictEqual(n.priceAlerts, false);
            assert.strictEqual(n.portfolioUpdates, true); // default
        });
    });

    // -----------------------------------------------------------------------
    // Security
    // -----------------------------------------------------------------------

    describe('toggleTwoFactor', () => {
        test('should flip twoFactorEnabled on each call', () => {
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, false);
            useSettingsStore.getState().toggleTwoFactor();
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, true);
            useSettingsStore.getState().toggleTwoFactor();
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, false);
        });
    });

    // -----------------------------------------------------------------------
    // Appearance
    // -----------------------------------------------------------------------

    describe('setTheme', () => {
        test('should set theme to dark', () => {
            useSettingsStore.getState().setTheme('dark');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'dark');
        });

        test('should set theme to system', () => {
            useSettingsStore.getState().setTheme('system');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'system');
        });

        test('should set theme to dim (AR-63)', () => {
            useSettingsStore.getState().setTheme('dim');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'dim');
        });
    });

    describe('toggleCompactMode', () => {
        test('should flip compactMode', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, false);
            useSettingsStore.getState().toggleCompactMode();
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, true);
        });
    });

    describe('toggleAnimations', () => {
        test('should flip animationsEnabled', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.animationsEnabled, true);
            useSettingsStore.getState().toggleAnimations();
            assert.strictEqual(useSettingsStore.getState().appearance.animationsEnabled, false);
        });
    });

    // -----------------------------------------------------------------------
    // Tags CRUD
    // -----------------------------------------------------------------------

    describe('addTag', () => {
        test('should append a tag with a unique id', () => {
            const before = useSettingsStore.getState().tags.length;
            useSettingsStore.getState().addTag({ name: 'NewTag', color: '#abcdef' });
            const tags = useSettingsStore.getState().tags;
            assert.strictEqual(tags.length, before + 1);
            const added = tags[tags.length - 1];
            assert.strictEqual(added.name, 'NewTag');
            assert.strictEqual(added.color, '#abcdef');
            assert.ok(added.id, 'Tag should have an id');
        });

        test('should generate unique ids for different tags', () => {
            useSettingsStore.getState().addTag({ name: 'A', color: '#111111' });
            useSettingsStore.getState().addTag({ name: 'B', color: '#222222' });
            const tags = useSettingsStore.getState().tags;
            const ids = tags.map((t: any) => t.id);
            const unique = new Set(ids);
            assert.strictEqual(unique.size, ids.length, 'All tag IDs should be unique');
        });
    });

    describe('updateTag', () => {
        test('should update only specified fields of a known tag', () => {
            const tags = useSettingsStore.getState().tags;
            const target = tags[0]; // 'Growth'
            useSettingsStore.getState().updateTag(target.id, { name: 'Renamed' });
            const updated = useSettingsStore.getState().tags.find((t: any) => t.id === target.id);
            assert.ok(updated);
            assert.strictEqual(updated!.name, 'Renamed');
            assert.strictEqual(updated!.color, target.color); // unchanged
        });

        test('should leave list unchanged for unknown id', () => {
            const before = JSON.stringify(useSettingsStore.getState().tags);
            useSettingsStore.getState().updateTag('nonexistent-id', { name: 'Ghost' });
            const after = JSON.stringify(useSettingsStore.getState().tags);
            assert.strictEqual(before, after);
        });
    });

    describe('deleteTag', () => {
        test('should remove a tag by id', () => {
            const tags = useSettingsStore.getState().tags;
            const target = tags[0];
            const before = tags.length;
            useSettingsStore.getState().deleteTag(target.id);
            assert.strictEqual(useSettingsStore.getState().tags.length, before - 1);
            assert.ok(!useSettingsStore.getState().tags.find((t: any) => t.id === target.id));
        });

        test('should leave list unchanged for unknown id', () => {
            const before = useSettingsStore.getState().tags.length;
            useSettingsStore.getState().deleteTag('nonexistent-id');
            assert.strictEqual(useSettingsStore.getState().tags.length, before);
        });
    });

    // -----------------------------------------------------------------------
    // Accounts
    // -----------------------------------------------------------------------

    describe('syncAccount', () => {
        test('should update lastSynced for the given account id', () => {
            const before = useSettingsStore.getState().accounts.find((a: any) => a.id === 'fidelity')!.lastSynced;
            useSettingsStore.getState().syncAccount('fidelity');
            const after = useSettingsStore.getState().accounts.find((a: any) => a.id === 'fidelity')!.lastSynced;
            assert.notStrictEqual(before, after, 'lastSynced should have changed');
        });

        test('should not modify other accounts', () => {
            const vanguardBefore = useSettingsStore.getState().accounts.find((a: any) => a.id === 'vanguard')!.lastSynced;
            useSettingsStore.getState().syncAccount('fidelity');
            const vanguardAfter = useSettingsStore.getState().accounts.find((a: any) => a.id === 'vanguard')!.lastSynced;
            assert.strictEqual(vanguardBefore, vanguardAfter);
        });
    });

    describe('reconnectAccount', () => {
        test('should set status to reconciled and clear errorMessage', () => {
            // ibkr starts with status 'needs-review' and an errorMessage
            const before = useSettingsStore.getState().accounts.find((a: any) => a.id === 'ibkr')!;
            assert.strictEqual(before.status, 'needs-review');
            assert.ok(before.errorMessage);

            useSettingsStore.getState().reconnectAccount('ibkr');
            const after = useSettingsStore.getState().accounts.find((a: any) => a.id === 'ibkr')!;
            assert.strictEqual(after.status, 'reconciled');
            assert.strictEqual(after.errorMessage, undefined);
        });
    });

    describe('removeAccount', () => {
        test('should remove an account by id', () => {
            const before = useSettingsStore.getState().accounts.length;
            useSettingsStore.getState().removeAccount('ibkr');
            const after = useSettingsStore.getState().accounts;
            assert.strictEqual(after.length, before - 1);
            assert.ok(!after.find((a: any) => a.id === 'ibkr'));
        });

        test('should leave list unchanged for unknown id', () => {
            const before = useSettingsStore.getState().accounts.length;
            useSettingsStore.getState().removeAccount('unknown');
            assert.strictEqual(useSettingsStore.getState().accounts.length, before);
        });
    });

    // -----------------------------------------------------------------------
    // API Keys
    // -----------------------------------------------------------------------

    describe('setProviderKey', () => {
        test('should set a provider key without touching others', () => {
            useSettingsStore.getState().setProviderKey('polygon', 'poly-abc-123');
            const keys = useSettingsStore.getState().apiKeys;
            assert.strictEqual(keys.polygon, 'poly-abc-123');
            assert.strictEqual(keys.alphaVantage, '');
            assert.strictEqual(keys.schwab, '');
        });

        test('should overwrite an existing key for the same provider', () => {
            useSettingsStore.getState().setProviderKey('alphaVantage', 'first');
            useSettingsStore.getState().setProviderKey('alphaVantage', 'second');
            assert.strictEqual(useSettingsStore.getState().apiKeys.alphaVantage, 'second');
        });
    });

    describe('clearProviderKey', () => {
        test('should reset a provider key to empty string', () => {
            useSettingsStore.getState().setProviderKey('polygon', 'poly-abc-123');
            useSettingsStore.getState().clearProviderKey('polygon');
            assert.strictEqual(useSettingsStore.getState().apiKeys.polygon, '');
        });
    });

    // -----------------------------------------------------------------------
    // Preferences
    // -----------------------------------------------------------------------

    describe('updatePreferences', () => {
        test('should merge partial preference updates', () => {
            useSettingsStore.getState().updatePreferences({ baseCurrency: 'EUR' });
            const prefs = useSettingsStore.getState().preferences;
            assert.strictEqual(prefs.baseCurrency, 'EUR');
            assert.strictEqual(prefs.dateFormat, 'MM/DD/YYYY'); // default preserved
            assert.strictEqual(prefs.marketDataRefreshSeconds, 60); // default preserved
        });

        test('should update multiple preference fields at once', () => {
            useSettingsStore.getState().updatePreferences({
                dateFormat: 'YYYY-MM-DD',
                numberFormat: 'de-DE',
                marketDataRefreshSeconds: 30,
            });
            const prefs = useSettingsStore.getState().preferences;
            assert.strictEqual(prefs.dateFormat, 'YYYY-MM-DD');
            assert.strictEqual(prefs.numberFormat, 'de-DE');
            assert.strictEqual(prefs.marketDataRefreshSeconds, 30);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------

    describe('resetSettings', () => {
        test('should restore all slices to their defaults', () => {
            // Mutate every slice
            useSettingsStore.getState().updateProfile({ fullName: 'Changed' });
            useSettingsStore.getState().updateNotification('portfolioUpdates', false);
            useSettingsStore.getState().toggleTwoFactor();
            useSettingsStore.getState().setTheme('dark');
            useSettingsStore.getState().setProviderKey('polygon', 'secret');
            useSettingsStore.getState().updatePreferences({ baseCurrency: 'EUR' });
            useSettingsStore.getState().deleteTag(useSettingsStore.getState().tags[0].id);
            useSettingsStore.getState().removeAccount('fidelity');

            // Reset
            useSettingsStore.getState().resetSettings();

            const state = useSettingsStore.getState();
            assert.strictEqual(state.profile.fullName, 'John Doe');
            assert.strictEqual(state.notifications.portfolioUpdates, true);
            assert.strictEqual(state.security.twoFactorEnabled, false);
            assert.strictEqual(state.appearance.theme, 'light');
            assert.strictEqual(state.apiKeys.polygon, '');
            assert.strictEqual(state.preferences.baseCurrency, 'USD');
            assert.strictEqual(state.tags.length, 3);
            assert.strictEqual(state.accounts.length, 3);
        });
    });
});
