import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ALERT_PREFERENCES } from '@/lib/alerts/nightly-plan';

import { storedAlertPreferences } from './alert-preferences';
import { SETTINGS_VERSION } from './document';

describe('storedAlertPreferences (launch item i57)', () => {
    test('without stored settings: every kind of alert, in the app, Alpha Radar from a score of 75 (the delivery default)', () => {
        const expected = { ...DEFAULT_ALERT_PREFERENCES, alphaRadar: { ...DEFAULT_ALERT_PREFERENCES.alphaRadar, minMaterialityScore: 75 } };
        assert.deepEqual(storedAlertPreferences(null), expected);
        assert.deepEqual(storedAlertPreferences({ version: SETTINGS_VERSION, settings: { demo: { showSampleData: false } } }), expected);
    });

    test('reads the notification switches and the Alpha Radar delivery preferences', () => {
        const preferences = storedAlertPreferences({
            version: SETTINGS_VERSION,
            settings: {
                notifications: {
                    portfolioUpdates: false, priceAlerts: true, alphaRadarSignals: false,
                    strategySignals: false, accountSync: true, weeklySummary: true,
                },
                alphaRadarDelivery: {
                    enabled: true,
                    channels: { inApp: false, email: true, slack: false, telegram: false },
                    failureSummaries: true,
                    overlapOnly: true,
                    minMaterialityScore: 70,
                    tickerFilters: ['aapl'],
                    fundStyleFilters: [],
                    trackedFilerIds: ['f-1'],
                },
            },
        });
        assert.deepEqual(preferences, {
            priceAlerts: true,
            portfolioUpdates: false,
            alphaRadarSignals: false,
            alphaRadar: { inApp: false, overlapOnly: true, minMaterialityScore: 70, tickerFilters: ['AAPL'], trackedFilerIds: ['f-1'] },
        });
    });

    test('settings saved before Alpha Radar Signals existed get it on', () => {
        const preferences = storedAlertPreferences({
            version: 5,
            settings: { notifications: { portfolioUpdates: true, priceAlerts: false, strategySignals: false, accountSync: true, weeklySummary: true } },
        });
        assert.equal(preferences.priceAlerts, false);
        assert.equal(preferences.alphaRadarSignals, true);
        assert.equal(preferences.alphaRadar.inApp, true);
    });
});
