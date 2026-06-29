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
