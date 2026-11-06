/**
 * Comparing an observation with a rule's threshold, and describing a rule.
 * The nightly alerts job evaluates rules (./nightly-plan.ts).
 */

import type {
    AlertComparator,
    AlertRule,
} from './types';

function isAlphaRadarMetric(metric: AlertRule['metric']): boolean {
    return metric.startsWith('alpha_radar_');
}

/**
 * Returns true if `value` satisfies the given comparator against `threshold`.
 * Equality uses a small epsilon so floating-point drift doesn't suppress
 * legitimate '=' rules on prices.
 */
export function compare(value: number, comparator: AlertComparator, threshold: number): boolean {
    const EQ_EPSILON = 1e-6;
    switch (comparator) {
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'gt':  return value > threshold;
        case 'lt':  return value < threshold;
        case 'eq':  return Math.abs(value - threshold) < EQ_EPSILON;
    }
}

// --------------------------------------------------------------------------
// UI helpers
// --------------------------------------------------------------------------

const COMPARATOR_LABELS: Record<AlertComparator, string> = {
    gte: '≥',
    lte: '≤',
    gt: '>',
    lt: '<',
    eq: '=',
};

const METRIC_LABELS: Record<AlertRule['metric'], string> = {
    price: 'Price',
    price_change_pct: 'Daily % change',
    portfolio_value: 'Portfolio value',
    portfolio_day_change_pct: 'Portfolio day change',
    alpha_radar_new_position: 'Alpha Radar new position score',
    alpha_radar_exit: 'Alpha Radar exit score',
    alpha_radar_large_add: 'Alpha Radar large add score',
    alpha_radar_large_trim: 'Alpha Radar large trim score',
    alpha_radar_user_overlap: 'Alpha Radar user-overlap score',
};

export function describeRule(rule: Pick<AlertRule, 'metric' | 'symbol' | 'comparator' | 'threshold'>): string {
    const metric = METRIC_LABELS[rule.metric];
    const cmp = COMPARATOR_LABELS[rule.comparator];
    const subject = !isAlphaRadarMetric(rule.metric) && rule.symbol
        ? `${rule.symbol.toUpperCase()} ${metric.toLowerCase()}`
        : metric;
    const threshold = formatThreshold(rule.metric, rule.threshold);
    return `${subject} ${cmp} ${threshold}`;
}

function formatThreshold(metric: AlertRule['metric'], value: number): string {
    if (isAlphaRadarMetric(metric)) {
        return `${Math.round(value)}/100`;
    }
    if (metric === 'price' || metric === 'portfolio_value') {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const sign = value > 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
}
