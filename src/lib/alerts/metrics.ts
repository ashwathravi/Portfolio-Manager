import type {
    AlertMetric,
    AlphaRadarAlertMetric,
    MarketAlertMetric,
} from './types';

const ALPHA_RADAR_PREFIX = 'alpha_radar_';

export function isAlphaRadarAlertMetric(metric: AlertMetric): metric is AlphaRadarAlertMetric {
    return metric.startsWith(ALPHA_RADAR_PREFIX);
}

export function isMarketAlertMetric(metric: AlertMetric): metric is MarketAlertMetric {
    return !isAlphaRadarAlertMetric(metric);
}

/** What the link to an alert's page says, in the bell and in the alerts email (launch item i58). */
export function alertLinkLabel(metric: AlertMetric, symbol?: string | null): string {
    if (isAlphaRadarAlertMetric(metric)) return 'Open Alpha Radar';
    return symbol ? `Open ${symbol}` : 'Open holdings';
}
