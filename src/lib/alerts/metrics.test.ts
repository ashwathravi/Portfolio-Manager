import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { alertLinkLabel, isAlphaRadarAlertMetric, isMarketAlertMetric } from './metrics';

describe('alert metrics', () => {
    test('Alpha Radar metrics are told apart from market ones', () => {
        assert.equal(isAlphaRadarAlertMetric('alpha_radar_exit'), true);
        assert.equal(isMarketAlertMetric('alpha_radar_exit'), false);
        assert.equal(isMarketAlertMetric('portfolio_value'), true);
    });

    test('a link to an alert names where it goes: the ticker, holdings or Alpha Radar (launch item i58)', () => {
        assert.equal(alertLinkLabel('price', 'AAPL'), 'Open AAPL');
        assert.equal(alertLinkLabel('portfolio_value', null), 'Open holdings');
        assert.equal(alertLinkLabel('portfolio_day_change_pct'), 'Open holdings');
        assert.equal(alertLinkLabel('alpha_radar_new_position', 'CB'), 'Open Alpha Radar');
    });
});
